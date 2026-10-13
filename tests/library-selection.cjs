const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});const page=await browser.newPage();let issued=[],cancelled=false;
  try{
    await page.route('**/api/games',r=>r.fulfill({json:{games:[{id:'fixture',folder:'Fixture',build:1}]}}));
    await page.route('**/api/catalog',r=>r.fulfill({json:{job:'catalog-fixture'}}));
    await page.route('**/api/jobs/catalog-fixture',r=>r.fulfill({json:{status:'done',message:'Ready',result:{ships:['A','B'].map(name=>({ShipCode:name+'123',LocalizedName:name,Tier:1,Nation:'일본',ShipClass:'순양함',Supported:true}))}}}));
    await page.route('**/api/ship-icon/**',r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=','base64')}));
    await page.route('**/api/preparations',r=>r.fulfill({json:{jobs:issued.length?[{id:'extract-fixture',game:'fixture',code:'B123',name:'B',status:cancelled?'cancelled':'running',percent:null}]:[]}}));
    await page.route('**/api/ship-model',r=>{issued.push(r.request().postDataJSON().code);return r.fulfill({json:{job:'extract-fixture'}});});
    await page.route('**/api/jobs/extract-fixture',r=>r.fulfill({json:{status:cancelled?'cancelled':'running',message:cancelled?'함선 준비를 취소했어요.':'Preparing',percent:null,started:Date.now()/1000}}));
    await page.route('**/api/cancel-preparation',r=>{cancelled=true;return r.fulfill({json:{status:'cancelled'}});});
    await page.addInitScript(()=>{if(!['ko','en'].includes(localStorage.getItem('workshop.language')))localStorage.setItem('workshop.language','ko');});await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8767');await page.locator('#open-model').click();await page.locator('.ship-card').first().click();await page.locator('.ship-card').nth(1).click();assert.deepEqual(issued,[],'Card clicks only select');
    assert.equal(await page.locator('.ship-card[aria-pressed=true]').getAttribute('data-code'),'B123');await page.locator('#open-selected-ship').click();await page.locator('#cancel-ship-preparation:not(:disabled)').waitFor();assert.deepEqual(issued,['B123']);await page.locator('#cancel-ship-preparation').click();await page.waitForFunction(()=>document.querySelector('#ship-preparation').hidden);assert(await page.locator('#model-dialog').isVisible());assert(await page.locator('#open-selected-ship').isEnabled());assert.equal(await page.evaluate(()=>workshop.state.source),null,'Cancelled preparation never replaces model');
    console.log('PASS accidental click prevention / explicit Open / cancel active preparation / keep dialog and current model');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
