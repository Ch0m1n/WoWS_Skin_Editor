const {chromium}=require('playwright');const assert=require('node:assert/strict');
const base=process.env.WORKSHOP_URL||'http://127.0.0.1:8767';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(base);await page.locator('#open-model').click();await page.locator('.local-model-options summary').click();await page.locator('.model-card').filter({hasText:'Ōta'}).click();
    await page.waitForFunction(()=>workshop.state.meshes.length&&document.querySelector('#busy').hidden,null,{timeout:90000});
    const before=await page.evaluate(()=>workshop.state.source.id);let issued=[],jobs=[];
    await page.route('**/api/preparations',r=>r.fulfill({json:{jobs}}));
    await page.route('**/api/ship-model',async r=>{const payload=r.request().postDataJSON();issued.push(payload.code);jobs.push({id:'queue-'+issued.length,game:payload.game,code:payload.code,name:payload.code,status:'queued',percent:null});await r.fulfill({json:{job:jobs.at(-1).id}});});
    await page.locator('#open-model').click();await page.waitForFunction(()=>document.querySelectorAll('.preselect-ship:not(:disabled)').length>2);
    await page.locator('.preselect-ship:not(:disabled)').nth(0).check();await page.locator('.preselect-ship:not(:disabled)').nth(1).check();await page.locator('#prepare-selected').click();
    await page.waitForFunction(()=>document.querySelector('#catalog-status').textContent.includes('2척을 대기열'));
    assert.equal(issued.length,2);assert.equal(new Set(issued).size,2);assert.equal(await page.evaluate(()=>workshop.state.source.id),before,'Background preparation keeps the current ship');
    assert((await page.locator('#preparation-summary').innerText()).includes('2척'));await page.locator('#model-dialog [data-close]').click();
    const file=await page.evaluate(()=>{const d=workshop.state.docs.get(workshop.state.activeDoc),c=document.createElement('canvas');c.width=d.base.width;c.height=d.base.height;const ctx=c.getContext('2d');ctx.fillStyle='rgba(255,0,0,.25)';ctx.fillRect(0,0,c.width,c.height);return {name:d.name,data:c.toDataURL().split(',')[1]};});
    await page.locator('input[type=file][accept=".png,.dds"]').setInputFiles({name:file.name,mimeType:'image/png',buffer:Buffer.from(file.data,'base64')});
    await page.locator('#texture-import-dialog').waitFor({state:'visible'});assert(await page.locator('#texture-import-rows select').inputValue());await page.locator('#apply-texture-import').click();
    await page.waitForFunction(()=>workshop.state.docs.get(workshop.state.activeDoc).layers.some(l=>l.blend==='copy'));
    const pixels=await page.evaluate(async()=>{const D=await import('/document.js'),doc=workshop.state.docs.get(workshop.state.activeDoc),c=D.composite(doc),row=doc.layers.at(-1);return{alpha:c.getContext('2d').getImageData(0,0,1,1).data[3],blend:row.blend,kind:row.kind};});assert.equal(pixels.alpha,64);assert.equal(pixels.kind,'paint');
    await page.locator('#undo').click();assert.equal(await page.evaluate(()=>workshop.state.docs.get(workshop.state.activeDoc).layers.length),0,'External texture import is undoable');
    assert.deepEqual(errors,[]);console.log('PASS two-ship background queue UI / current ship preserved / filename texture matching / editable external PNG / original alpha / undo');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
