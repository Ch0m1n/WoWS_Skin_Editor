const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8766');await page.locator('#open-model').click();await page.locator('.local-model-options summary').click();await page.locator('.model-card').filter({hasText:'Ōta'}).click();
    await page.waitForFunction(()=>workshop.state.meshes.length&&document.querySelector('#busy').hidden,null,{timeout:90000});
    await page.waitForFunction(()=>workshop.state.docs.get(workshop.state.activeDoc).preview?.width===2048);
    assert.equal(await page.locator('#texture-canvas').getAttribute('width'),'4096');
    assert(await page.locator('#material-groups summary').filter({hasText:'선체'}).count());assert(await page.locator('#material-groups summary').filter({hasText:'대공포'}).count());
    for(const name of ['광택','금속성','거칠기','노멀 X','노멀 Y']){
      await page.locator('#channel-tabs button').filter({hasText:name,exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('재질 채널 미리보기'));
      assert(await page.locator('[data-tool=brush]').isDisabled());
    }
    await page.locator('#channel-tabs button').filter({hasText:'색상',exact:true}).click();assert(await page.locator('[data-tool=brush]').isEnabled());
    const before=await page.evaluate(()=>workshop.renderer.info.render.frame);await page.waitForTimeout(700);const after=await page.evaluate(()=>workshop.renderer.info.render.frame);assert(after-before<5,'Idle viewport should stop rendering');
    const quat=await page.evaluate(()=>workshop.camera.quaternion.toArray());
    const point=await page.evaluate(()=>{const c=document.querySelector('#axis-gizmo'),r=c.getBoundingClientRect(),p=c.axisPoints.find(p=>p.label==='Y');return {x:r.x+p.x*r.width/100,y:r.y+p.y*r.height/100};});await page.mouse.click(point.x,point.y);
    assert.notDeepEqual(await page.evaluate(()=>workshop.camera.quaternion.toArray()),quat,'Axis gizmo changes camera');
    for(const axis of ['X','Y','Z']){
      await page.locator('#home-view').click();await page.waitForTimeout(150);
      const dot=await page.evaluate(axis=>{const c=document.querySelector('#axis-gizmo'),r=c.getBoundingClientRect(),p=c.axisPoints.find(p=>p.label===axis);return{x:r.x+p.x*r.width/100,y:r.y+p.y*r.height/100};},axis);
      await page.mouse.dblclick(dot.x,dot.y,{delay:100});await page.waitForTimeout(150);
      const direction=await page.evaluate(()=>{const v=workshop.camera.position.clone();workshop.camera.getWorldDirection(v);return v.toArray();});
      assert(direction['XYZ'.indexOf(axis)]<-.99999,`${axis} double click must align the camera exactly`);
    }
    await page.locator('#home-view').click();await page.screenshot({path:path.join(__dirname,'output','editor-materials.png')});
    assert.deepEqual(errors,[]);console.log('PASS material groups / real texture channel previews / full-res editing with 2K preview / idle rendering / clickable axis gizmo');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
