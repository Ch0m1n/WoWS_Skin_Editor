const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
try{for(const language of ['ko','en']){
  const page=await browser.newPage();await page.addInitScript(value=>localStorage.setItem('workshop.language',value),language);
  let calls=[],accept=false,remaining=2,confirmation='';
  await page.route('**/api/cache',r=>r.fulfill({json:{models:Array.from({length:remaining},(_,i)=>({id:'fixture-'+i,name:'Fixture '+i,folder:'/cache/'+(i?'other':'open'),build:123,bytes:1024,ready:true}))}}));
  await page.route('**/api/cache-control',r=>{calls.push(r.request().postDataJSON());remaining=1;return r.fulfill({json:{deleted:1,protected:1,bytes:1024}});});
  page.on('dialog',d=>{confirmation=d.message();return accept?d.accept():d.dismiss();});
  await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8771');await page.evaluate(()=>workshop.state.source={folder:'/cache/open'});
  await page.locator('#workshop-tools').click();await page.locator('.management-tabs button').nth(1).click();
  await page.locator('#clear-model-cache').click();assert.equal(calls.length,0,'Cancel never submits a deletion');
  assert.match(confirmation,language==='ko'?/모델과 텍스처 파일도 함께 삭제/:/deletes extracted ship models and textures/);
  accept=true;await page.locator('#clear-model-cache').click();await page.waitForFunction(()=>document.querySelector('#management-content [role=status]'));
  assert.deepEqual(calls,[{action:'clear',protected:'/cache/open'}]);
  console.log('PASS '+language+' cache deletion confirmation / cancel / open model protection');await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
