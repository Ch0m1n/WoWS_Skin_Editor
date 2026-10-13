const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
 try{for(const language of ['en','ko']){
  const page=await browser.newPage({viewport:{width:1600,height:1000}});const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.addInitScript(lang=>localStorage.setItem('workshop.language',lang),language);
  let prepared={READY:'ready',STALE:'stale'};
  await page.route('**/api/games',r=>r.fulfill({json:{games:[{id:'test',folder:'D:/Game',build:'10'}]}}));
  await page.route('**/api/catalog',r=>r.fulfill({json:{job:'catalog'}}));
  await page.route('**/api/jobs/catalog',r=>r.fulfill({json:{status:'done',message:'Ready',result:{ships:['READY','STALE','NEW'].map(code=>({ShipCode:code,LocalizedName:code,Supported:true,Nation:'프랑스',ShipClass:'전함',Tier:8}))}}}));
  await page.route('**/api/prepared-ships/test',r=>r.fulfill({json:{ships:prepared}}));
  await page.route('**/api/preparations',r=>r.fulfill({json:{jobs:[]}}));
  await page.route('**/api/ship-icon/**',r=>r.fulfill({status:404,body:''}));
  await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8784');await page.waitForFunction(()=>window.workshop);
  await page.locator('#error-log-toggle').click();assert.match(await page.locator('#error-log-list').innerText(),language==='en'?/No errors/:/오류가 없/);await page.locator('#error-log-close').click();
  await page.locator('#open-model').click();try{await page.locator('.ship-card[data-code="READY"]').waitFor({timeout:10000});}catch(error){console.log(await page.locator('#catalog-status').innerText(),await page.locator('#status').innerText(),failures);throw error;}
  assert.match(await page.locator('[data-code="READY"] .ship-prepared').innerText(),language==='en'?/Prepared/:/추출 완료/);
  assert.match(await page.locator('[data-code="STALE"] .ship-prepared').innerText(),language==='en'?/refresh needed/:/재준비 필요/);
  assert.equal(await page.locator('[data-code="NEW"] .ship-prepared').innerText(),'');
  await page.locator('#ship-prepared-only').check();assert.equal(await page.locator('.ship-card').count(),1);await page.locator('#ship-prepared-only').uncheck();
  await page.route('**/api/game-folder',r=>r.fulfill({status:400,json:{error:'모델 폴더를 찾을 수 없어요.'}}));
  await page.locator('#game-folder').fill('missing');await page.locator('#set-game-folder').click();await page.locator('#error-notice').waitFor({state:'visible'});
  assert.match(await page.locator('#error-notice-text').innerText(),language==='en'?/model folder could not be found/:/모델 폴더/);
  await page.locator('#error-notice-open').click();await page.locator('#error-log-list summary').click();assert.match(await page.locator('#error-log-list pre').innerText(),language==='en'?/model folder could not be found/:/모델 폴더를 찾을 수 없어요/);
  if(language==='en')assert.doesNotMatch(await page.locator('#error-log-list').innerText(),/[가-힣]/);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#error-log-list article > button').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),language==='en'?/model folder could not be found/:/모델 폴더를 찾을 수 없어요/);
  await page.screenshot({path:`tests/output/error-log-${language}.png`});
  await page.keyboard.press('Escape');assert(await page.locator('#model-dialog').isVisible());
  await page.evaluate(()=>document.getElementById('error-log-toggle').click());
  await page.locator('#error-log-clear').click();assert.equal(await page.locator('#error-log-list article').count(),0);await page.locator('#error-log-close').click();
  await page.locator('#model-dialog [data-close]').click();
  await page.evaluate(async()=>{const {errorDescription}=await import('/error-log.js');window.testUnknownError=errorDescription('번역되지 않은 새로운 오류예요');});
  assert.match(await page.evaluate(()=>window.testUnknownError),language==='en'?/operation could not be completed/:/번역되지/);
  prepared.NEW='ready';await page.locator('#open-model').click();await page.waitForFunction(()=>document.querySelector('[data-code="NEW"] .ship-prepared')?.dataset.cache==='ready');
  await page.locator('#model-dialog [data-close]').click();
  await page.locator('#error-log-toggle').click();
  assert.deepEqual(failures,[]);await page.close();
 }console.log('PASS bilingual errors, original log, modal notification, cache badges, filter and refresh');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
