const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');
const base=process.env.WORKSHOP_URL||'http://127.0.0.1:8766';
async function api(route,payload){const r=await fetch(base+'/api/'+route,payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;}
async function wait(job){for(let i=0;i<600;i++){const j=await api('jobs/'+job);if(j.status==='done')return j.result;if(j.status==='error')throw Error(j.message);await new Promise(r=>setTimeout(r,500));}throw Error('Extraction timeout');}
(async()=>{
  const games=(await api('games')).games;assert(games.length);const game=games[0].id;
  const ko=await wait((await api('catalog',{game,language:'ko'})).job);
  const en=await wait((await api('catalog',{game,language:'en'})).job);
  assert(ko.ships.length>1000);assert.equal(ko.ships.length,en.ships.length);
  assert(ko.translation.includes('/ko/')||ko.translation.includes('\\ko\\'));assert(en.translation.includes('/en/')||en.translation.includes('\\en\\'));
  assert(ko.ships.some(s=>s.LocalizedName!==en.ships.find(e=>e.ShipCode===s.ShipCode)?.LocalizedName));
  const icon=await fetch(base+`/api/ship-icon/${game}/PJSC769`);assert(icon.ok);assert.equal(icon.headers.get('content-type'),'image/png');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  try{
    await page.goto(base);await page.locator('#open-model').click();await page.waitForFunction(()=>document.querySelectorAll('.ship-card').length>20);
    await page.locator('#nation-tabs button').filter({hasText:'일본'}).click();assert(await page.locator('.ship-card').count());
    await page.locator('#ship-search').fill('PJSC769');assert.equal(await page.locator('.ship-card').count(),1);
    await page.waitForFunction(()=>[...document.querySelectorAll('.ship-card img')].every(img=>img.complete&&img.naturalWidth>0));
    await page.screenshot({path:path.join(__dirname,'output','ship-library-ko.png')});
    await page.locator('#model-dialog [data-close]').click();await page.locator('#ui-language').selectOption('en');await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>document.documentElement.lang==='en');await page.locator('#open-model').click();await page.waitForFunction(()=>document.querySelector('#catalog-status').textContent.includes('ships from game packages'));
    await page.locator('#nation-tabs button').filter({hasText:'Japan',exact:true}).click();await page.locator('#ship-search').fill('PJSC769');assert.equal(await page.locator('.ship-card').count(),1);
    assert.equal(await page.locator('.ship-card strong').innerText(),en.ships.find(s=>s.ShipCode==='PJSC769').LocalizedName);
    assert.equal(await page.locator('#open-model').innerText(),'Open ship');
    await page.waitForFunction(()=>[...document.querySelectorAll('.ship-card img')].every(img=>img.complete&&img.naturalWidth>0));
    await page.screenshot({path:path.join(__dirname,'output','ship-library-en.png')});
    console.log('PASS installed game / package icon / nation filter / Korean and English global.mo / localized UI');
    if(process.env.TEST_EXTRACTION==='1'){
      console.log('Preparing PJSC769 with the included engine…');
      const job=(await api('ship-model',{game,code:'PJSC769',language:'en'})).job;const result=await wait(job);const source=await api('job-model',{job});assert(source.folder===result.folder);
      console.log('PASS standalone package-to-editable-model extraction',source.folder);
      if(process.env.CHECK_TOOLBOX_ABSENT==='1')assert.equal((await api('library')).models.length,0,'No installed Toolbox export library is available');
      await page.locator('.ship-card').click();await page.waitForFunction(()=>workshop.state.meshes.length>10&&document.querySelector('#busy').hidden,null,{timeout:90000});
      assert.equal(await page.locator('#texture-canvas').getAttribute('width'),'4096');
      await page.screenshot({path:path.join(__dirname,'output','portable-package-model.png')});
      console.log('PASS package-extracted model opens in the editor with full-resolution textures');
    }
    if(process.env.TEST_EXTRACTION!=='1'){
      await page.route('**/api/ship-model',route=>route.fulfill({json:{job:'test-progress'}}));
      let measured=false;
      await page.route('**/api/jobs/test-progress',route=>route.fulfill({json:{status:'running',message:'Preparing full-resolution textures and editable parts…',started:Date.now()/1000-10,percent:measured?54:null,estimated_total_seconds:50}}));
      await page.locator('.ship-card').click();await page.waitForFunction(()=>document.querySelector('#ship-progress-details').textContent.includes('Elapsed 10s'));
      assert(await page.locator('#ship-preparation').isVisible());assert.equal(await page.locator('#ship-progress').getAttribute('value'),null);
      assert((await page.locator('#ship-progress-details').innerText()).includes('About 40s'));
      measured=true;await page.waitForFunction(()=>document.querySelector('#ship-progress').value===54);
      assert((await page.locator('#ship-progress-details').innerText()).includes('Editable conversion 54%'));
      console.log('PASS indeterminate extraction / measured conversion / elapsed time / previous-run ETA / English progress UI');
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
