const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1050,height:800}});await page.addInitScript(()=>{if(!['ko','en'].includes(localStorage.getItem('workshop.language')))localStorage.setItem('workshop.language','ko');});await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8770');
    await page.locator('#brush-settings-open').click();
    assert(await page.locator('#brush-settings-dialog').isVisible());
    assert(await page.evaluate(()=>{const d=document.getElementById('brush-settings-dialog'),r=d.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&d.scrollHeight<=d.clientHeight;}),'Settings fit without nested scrolling');
    for(const id of ['brush-hardness','brush-opacity','brush-spacing'])assert(await page.locator('#'+id).isVisible());
    await page.locator('#brush-settings-dialog .dialog-heading button').click();
    const result=await page.evaluate(async()=>{
      const T=await import('/vendor/three/build/three.module.js'),{createSurfaceBrush}=await import('/surface-brush.js');
      const camera=new T.OrthographicCamera(-1.5,1.5,1.5,-1.5,.1,10);camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld();
      const positions=[],uvs=[];for(const [x0,x1,z0,z1,u0,u1] of [[-1,0,0,0,.03,.3],[0,.2,0,.3,.4,.6],[.2,1,.3,.3,.7,.97]]){
        positions.push(x0,-1,z0,x1,-1,z1,x1,1,z1,x0,-1,z0,x1,1,z1,x0,1,z0);uvs.push(u0,.1,u1,.1,u1,.9,u0,.1,u1,.9,u0,.9);
      }
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
      const material=new T.MeshBasicMaterial();material.userData.docKey='fixture';const mesh=new T.Mesh(geometry,material);mesh.updateMatrixWorld();
      const raster=document.createElement('canvas');raster.width=raster.height=512;const doc={key:'fixture',base:raster,flipY:true,meshes:new Set([mesh])},row={raster};
      const ray=new T.Raycaster(),pick=e=>{ray.setFromCamera(new T.Vector2(e.clientX/256-1,1-e.clientY/256),camera);return ray.intersectObject(mesh)[0];};
      const renderer={domElement:{getBoundingClientRect:()=>({left:0,top:0,width:512,height:512})}};
      const brush=createSurfaceBrush({camera,renderer,pick,commit:(_,patch,r)=>raster.getContext('2d').drawImage(patch,r.x,r.y)});
      const start={x:110,y:290},end={x:410,y:220};const size=brush.start(pick({clientX:start.x,clientY:start.y}),doc,36);
      const before=performance.now();brush.paint(row,doc,start,end,{color:'#000000',hardness:1,opacity:1,spacing:.15});const elapsed=performance.now()-before;
      const ctx=raster.getContext('2d'),read=(x,y)=>{const h=pick({clientX:x,clientY:y});return h?ctx.getImageData(Math.floor(h.uv.x*512),Math.floor((1-h.uv.y)*512),1,1).data[3]:null;};
      const points=[140,230,266,282,325,390];const coverage=points.map(x=>{const y=start.y+(x-start.x)*(end.y-start.y)/(end.x-start.x);return [read(x,y),read(x,y+size*.25),read(x,y+size)];});
      const gaps=[.35,.65].map(u=>ctx.getImageData(Math.floor(u*512),256,1,1).data[3]);
      return {coverage,gaps,elapsed};
    });
    assert(result.coverage.every(([center,inside,outside])=>center>0&&inside>0&&outside===0),'One screen footprint covers flat and steep surfaces with consistent width');
    assert.deepEqual(result.gaps,[0,0],'Separate UV islands remain separate');console.log('PASS stepped surface footprint / UV gaps / unclipped brush settings',result.elapsed.toFixed(1)+'ms');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
