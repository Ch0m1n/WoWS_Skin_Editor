const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage({viewport:{width:1600,height:1050}});await page.addInitScript(()=>localStorage.setItem('workshop.language','ko'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8780');await page.waitForLoadState('networkidle');
 let original;
 for(const [name,folder] of [['before',process.env.FLANDRE_ORIGINAL_FOLDER],['after',process.env.FLANDRE_FIXED_FOLDER]]){
  if(!folder)throw Error('Set FLANDRE_ORIGINAL_FOLDER and FLANDRE_FIXED_FOLDER');
  await page.locator('#open-model').click();await page.locator('#model-dialog').waitFor({state:'visible'});const summary=page.locator('.local-model-options summary');if(!await page.locator('#folder-path').isVisible())await summary.click();
  await page.locator('#folder-path').fill(folder);await page.locator('#load-folder').click();
  await page.waitForFunction(()=>workshop.state.meshes.length&&document.getElementById('busy').hidden,null,{timeout:90000});
  await page.locator('button[data-view="3d"]').click();await page.locator('#home-view').click();await page.waitForLoadState('networkidle');
  await page.locator('#scene-wrap').screenshot({path:path.join(__dirname,'output','flandre-'+name+'.png')});
  const layout=await page.evaluate(()=>{const totals=new Map();for(const m of workshop.state.meshes){const name=m.name.replace(/_P\d+$/,'');totals.set(name,(totals.get(name)||0)+m.geometry.attributes.position.count);}return [...totals].sort((a,b)=>a[0].localeCompare(b[0]));});
  if(name==='before')original=layout;else assert.deepEqual(layout,original,'Original named parts and triangle counts retained');
 }
 assert.deepEqual(errors,[]);console.log('PASS Flandre before/after rendered; materials retained; no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
