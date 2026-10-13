const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function embeddedGLB(png) {
  const positions = Buffer.from(new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]).buffer);
  const uvs = Buffer.from(new Float32Array([0,0, 1,0, .5,1]).buffer);
  const binRaw = Buffer.concat([positions,uvs,png]);
  const bin = Buffer.concat([binRaw,Buffer.alloc((4-binRaw.length%4)%4)]);
  const gltf = {asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0,name:'Test hull'}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}],
    materials:[{name:'Embedded hull',doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0}}],
    textures:[{source:0}], images:[{bufferView:2,mimeType:'image/png'}], buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:png.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'}]};
  const raw = Buffer.from(JSON.stringify(gltf)); const json = Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
  const header=Buffer.alloc(12), jh=Buffer.alloc(8), bh=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4); header.writeUInt32LE(28+json.length+bin.length,8);
  jh.writeUInt32LE(json.length,0); jh.writeUInt32LE(0x4e4f534a,4); bh.writeUInt32LE(bin.length,0); bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jh,json,bh,bin]);
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({acceptDownloads:true}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  try {
    await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8766');
    const png=await page.evaluate(()=>{const c=document.createElement('canvas'); c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='#678abc';x.fillRect(0,0,32,32);return c.toDataURL().split(',')[1];});
    await page.locator('#glb-file').setInputFiles({name:'embedded.glb',mimeType:'model/gltf-binary',buffer:embeddedGLB(Buffer.from(png,'base64'))});
    await page.waitForFunction(()=>workshop.state.meshes.length===1&&document.querySelector('#busy').hidden);
    assert.equal(await page.locator('#texture-canvas').getAttribute('width'),'32');
    await page.locator('#text-tool').click(); await page.locator('#text-value').fill('GLB'); await page.locator('#add-text').click();
    const dl=page.waitForEvent('download');await page.locator('#save-project').click(); const project=await dl;
    const projectPath=path.join(__dirname,'output','embedded.wowskin'); await project.saveAs(projectPath);
    const saved=JSON.parse(await fs.readFile(projectPath)); assert.equal(saved.source.format,'glb-file');assert(saved.source.data);
    const key=saved.documents[0].key;
    await page.locator('#project-file').setInputFiles(projectPath);
    await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='프로젝트 복원됨');
    assert.equal(await page.evaluate(()=>workshop.state.activeDoc),key);
    assert.equal(await page.evaluate(()=>workshop.state.docs.get(workshop.state.activeDoc).layers[0].name),'GLB');
    assert.deepEqual(errors,[]); console.log('PASS embedded GLB import / texture / stable project restore');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
