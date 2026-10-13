const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const out = path.join(__dirname, 'output'); await fs.mkdir(out, {recursive: true});
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args: ['--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}, acceptDownloads: true});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    await page.goto(process.env.WORKSHOP_URL || 'http://127.0.0.1:8765'); await page.waitForLoadState('networkidle');
    await page.locator('#open-model').click();
    await page.locator('#model-dialog').waitFor({state: 'visible'});
    await page.locator('.local-model-options summary').click();
    const ota = page.locator('.model-card').filter({hasText: 'Ōta'});
    assert.equal(await ota.count(), 1, 'Existing real WoWS Toolbox model is available');
    await ota.click();
    await page.waitForFunction(() => window.workshop?.state.meshes.length > 0 && document.querySelector('#busy').hidden, null, {timeout: 90000});
    const info = await page.evaluate(() => ({parts: workshop.state.meshes.length, textures: workshop.state.docs.size, width: document.querySelector('#texture-canvas').width, first: workshop.state.activeDoc}));
    assert(info.parts > 10); assert(info.textures > 5); assert(info.width > 512);
    console.log('REAL_MODEL', JSON.stringify(info));
    await page.locator('#uv-overlay').uncheck();
    await page.screenshot({path: path.join(out, 'workshop-real-model.png')});
    // Paint a real texture using the rendered UI and verify a changed pixel.
    await page.locator('[data-tool=brush]').click();
    const rect = await page.locator('#texture-canvas').boundingBox();
    const pixelBefore = await page.evaluate(() => {const c = document.querySelector('#texture-canvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width * .53),Math.floor(c.height * .48),1,1).data];});
    const x = rect.x + rect.width * .53, y = rect.y + rect.height * .48;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 8, {steps: 8}); await page.mouse.up();
    const pixelAfter = await page.evaluate(() => {const c = document.querySelector('#texture-canvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width * .53),Math.floor(c.height * .48),1,1).data];});
    assert.notDeepEqual(pixelAfter, pixelBefore, 'Brush edits texture pixels');
    await page.locator('#undo').click(); await page.waitForFunction(() => workshop.state.redo.length === 1);
    const pixelUndo = await page.evaluate(() => {const c = document.querySelector('#texture-canvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width * .53),Math.floor(c.height * .48),1,1).data];});
    assert.deepEqual(pixelUndo, pixelBefore, 'Undo restores original pixels');
    await page.locator('#redo').click(); await page.waitForFunction(() => workshop.state.undo.length === 1);
    // Text is a transformable image layer, with editable placement and visibility.
    await page.locator('#text-tool').click(); await page.locator('#text-value').fill('삼촌의 함선'); await page.locator('#add-text').click();
    assert.equal(await page.locator('.layer-row.selected .layer-label').innerText(), '삼촌의 함선');
    await page.locator('#layer-rotation').fill('25'); await page.locator('#layer-rotation').dispatchEvent('change');
    assert.equal(await page.evaluate(() => workshop.state.docs.get(workshop.state.activeDoc).layers.at(-1).rotation), 25);
    // Export must use final edited pixels even while comparing against the original.
    await page.locator('#compare').check();
    await page.locator('#export').click(); await page.locator('#export-format').selectOption('dds');
    const exportDownload = page.waitForEvent('download', {timeout: 90000}); await page.locator('#download-export').click();
    const exportFile = await exportDownload; await exportFile.saveAs(path.join(out, 'real-model-export.zip'));
    await page.waitForFunction(() => document.querySelector('#busy').hidden); await page.locator('#compare').uncheck();
    const saveDownload = page.waitForEvent('download'); await page.locator('#save-project').click();
    const project = await saveDownload; const projectPath = path.join(out, 'real-model.wowskin'); await project.saveAs(projectPath);
    const saved = JSON.parse(await fs.readFile(projectPath)); assert.equal(saved.schema, 'wows-skin-workshop/v1'); assert.equal(saved.documents[0].layers.length, 2);
    await page.locator('#project-file').setInputFiles(projectPath);
    await page.waitForFunction(() => document.querySelector('#save-state').textContent === '프로젝트 복원됨', null, {timeout: 90000});
    assert.equal(await page.evaluate(() => workshop.state.docs.get(workshop.state.activeDoc).layers.length), 2);
    // XML color editing preserves the fourth component and unrelated definitions.
    const xml = '<data><colorschemes.xml><colorScheme><name>test</name><color0>0.1 0.2 0.3 9.0</color0><color1>0 0 0 1</color1><color2>0 1 0 1</color2><color3>0 0 1 1</color3></colorScheme></colorschemes.xml><shipgroups.xml><group>UNCHANGED</group></shipgroups.xml></data>';
    await page.locator('#camo-open').click(); await page.locator('#xml-file').setInputFiles({name: 'camouflages.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)});
    await page.locator('[aria-label="위장 색상 0"]').fill('#ff0000'); await page.locator('[aria-label="위장 색상 0"]').dispatchEvent('input');
    assert.equal(await page.evaluate(() => workshop.state.xml.querySelector('color0').textContent), '1.0000 0.0000 0.0000 9.0000');
    assert.equal(await page.evaluate(() => workshop.state.xml.querySelector('group').textContent), 'UNCHANGED');
    await page.locator('#camo-dialog [data-close]').click();
    await page.screenshot({path: path.join(out, 'workshop-edited.png')});
    // Bake an image through an actual 3D pointer event, then inspect the baked raster.
    const png = await page.evaluate(() => {const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d'); ctx.fillStyle = '#fd4270'; ctx.fillRect(0,0,64,64); return c.toDataURL().split(',')[1];});
    await page.locator('#image-file').setInputFiles({name: 'stamp.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    await page.waitForFunction(() => workshop.state.tool === 'image');
    await page.locator('[data-axis=side]').click();
    const hitPoint = await page.evaluate(async () => {
      const T = await import('/vendor/three/build/three.module.js'); const ray = new T.Raycaster();
      const rect = workshop.renderer.domElement.getBoundingClientRect();
      for (let y = .45; y < .85; y += .015) for (let x = .25; x < .75; x += .025) {
        ray.setFromCamera(new T.Vector2(x * 2 - 1, 1 - y * 2), workshop.camera);
        const hit = ray.intersectObjects(workshop.state.meshes, false)[0];
        if (hit && /1944_albedo/.test([].concat(hit.object.material)[hit.face.materialIndex].userData.docKey)) return {x: rect.x + x * rect.width, y: rect.y + y * rect.height};
      }
      throw Error('Could not find the real hull in the side view');
    });
    await page.mouse.click(hitPoint.x, hitPoint.y);
    await page.waitForFunction(() => [...workshop.state.docs.values()].some(d => d.layers.some(l => l.projection && l.raster.getContext('2d').getImageData(0,0,l.raster.width,l.raster.height).data.some((v,i)=>i%4===3&&v>0))),null,{timeout:90000});
    const baked = await page.evaluate(() => {const row = [...workshop.state.docs.values()].flatMap(d => d.layers).find(l => l.projection); return row.raster.getContext('2d').getImageData(0,0,row.raster.width,row.raster.height).data.some((v,i) => i % 4 === 3 && v > 0);});
    assert(baked, '3D projection writes actual texture pixels');
    await page.locator('#home-view').click(); await page.locator('[data-tool=orbit]').click();
    await page.screenshot({path: path.join(out, 'workshop-projected.png')});
    assert.deepEqual(errors, [], 'No browser errors');
    console.log('PASS brush / undo-redo / text transform / DDS export / project restore / XML preserve / real 3D projection / browser errors');
  } catch (error) { await page.screenshot({path: path.join(out, 'failure.png')}); console.log('BROWSER_ERRORS', errors); console.log('STATUS', await page.locator('#status').innerText()); throw error; }
  finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode = 1;});
