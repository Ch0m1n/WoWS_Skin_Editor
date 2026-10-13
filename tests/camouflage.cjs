const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  try{for(const language of ['ko','en']){
    const page=await browser.newPage();await page.addInitScript(value=>localStorage.setItem('workshop.language',value),language);
    await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8772');await page.locator('#camo-open').click();
    await page.waitForFunction(()=>!document.getElementById('load-game-xml').disabled);
    const ready=page.waitForResponse(r=>r.url().endsWith('/api/camouflage-xml')&&r.request().method()==='POST',{timeout:120000});
    await page.locator('#load-game-xml').click();const response=await ready;assert(response.ok());const data=await response.json();
    const expected=data.labels.colorSchemeCN01;assert(expected?.length,'Installed game maps colorSchemeCN01 through Exterior params');
    if(language==='ko')assert(expected.includes('바다의 혼'));
    await page.waitForFunction(()=>!document.getElementById('scheme-select').disabled);
    const text=await page.locator('#scheme-select option').filter({hasText:'colorSchemeCN01'}).textContent();assert(text.includes(expected[0]),'Palette uses the language-specific game name');
    const scheme=await page.evaluate(()=>[...document.getElementById('scheme-select').options].find(o=>o.textContent.includes('colorSchemeCN01')).value);
    await page.locator('#scheme-select').selectOption(scheme);assert.equal(await page.locator('#camo-colors input').count(),4);
    assert.equal(await page.evaluate(()=>workshop.state.xml.getElementsByTagName('colorScheme')[Number(document.getElementById('scheme-select').value)].getElementsByTagName('name')[0].textContent.trim()),'colorSchemeCN01','Localized labels never change original XML identifiers');
    const named=page.waitForResponse(r=>r.url().endsWith('/api/camouflage-labels')&&r.request().method()==='POST');
    await page.locator('#xml-file').setInputFiles({name:'custom.xml',mimeType:'application/xml',buffer:Buffer.from('<data><colorScheme><name>colorSchemeCN01</name><color0>0 0 0 1</color0></colorScheme></data>')});await named;
    await page.waitForFunction(label=>document.getElementById('scheme-select').textContent.includes(label),expected[0]);
    assert.equal(await page.evaluate(()=>workshop.state.xmlName),'custom.xml');
    console.log('PASS '+language+' game and external XML palette names: '+text);await page.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
