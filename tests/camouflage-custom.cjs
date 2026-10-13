const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs/promises');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage();await page.addInitScript(()=>{if(!['ko','en'].includes(localStorage.getItem('workshop.language')))localStorage.setItem('workshop.language','ko');});await page.goto(process.env.WORKSHOP_URL||'http://127.0.0.1:8771');
    const parser=await page.evaluate(async()=>{
      const {parseCamouflageXML:parse,serializeCamouflageXML:save}=await import('/camouflage-xml.js');
      const source='<data><!-- __wows_mod_tag_ and <507C_group> --><507C_group><ships>A B</ships></507C_group><note><![CDATA[<507C_group>]]></note><colorScheme><name>custom</name><color0>0 0 0 9</color0></colorScheme><ref>507C_group</ref></data>';
      const document=parse(source),restored=save(document);document.querySelector('color0').textContent='1 0 0 9';const edited=save(document);
      const rejected=[];for(const bad of ['<!DOCTYPE data [<!ENTITY ext SYSTEM "file:///private">]><data/>','<data><broken></data>','<data/>']){try{parse(bad);rejected.push(false);}catch{rejected.push(true);}}
      return{restored,edited,rejected};
    });
    assert(parser.restored.includes('<507C_group><ships>A B</ships></507C_group>'));
    assert(parser.restored.includes('<!-- __wows_mod_tag_ and <507C_group> -->'));
    assert(parser.restored.includes('<![CDATA[<507C_group>]]>'));
    assert(parser.edited.includes('<color0>1 0 0 9</color0>'));
    assert(parser.edited.includes('<ref>507C_group</ref>'));assert.deepEqual(parser.rejected,[true,true,true]);
    await page.locator('#camo-open').click();
    const input=process.env.CUSTOM_CAMO_XML;
    if(input){await page.locator('#xml-file').setInputFiles(input);}
    else{
      const xml='<data><!--'+ 'x'.repeat(9*1024*1024)+'--><507C_group><ships>TEST</ships></507C_group><colorScheme><name>custom</name><color0>0 0 0 9</color0></colorScheme></data>';
      await page.locator('#xml-file').setInputFiles({name:'custom.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
    }
    await page.waitForFunction(()=>!!workshop.state.xml,{timeout:30000});
    const count=await page.locator('#scheme-select option').count();if(input)assert.equal(count,1428);else assert.equal(count,1);
    const original=await page.evaluate(()=>workshop.state.xml.getElementsByTagName('colorScheme')[0].getElementsByTagName('color0')[0].textContent.trim().split(/\s+/)[3]);
    const color=page.locator('#camo-colors input').first();await color.fill('#112233');await color.dispatchEvent('input');
    const download=page.waitForEvent('download');await page.locator('#save-xml').click();const item=await download;const file=await item.path();const saved=await fs.readFile(file,'utf8');
    assert(saved.includes('<507C_group>')&&saved.includes('</507C_group>'));
    if(input){assert(saved.includes('<507AB_group>')&&saved.includes('</507AB_group>'));assert.equal((saved.match(/<camouflage>/g)||[]).length,4189);}
    assert.equal(await page.evaluate(()=>Number(workshop.state.xml.getElementsByTagName('colorScheme')[0].getElementsByTagName('color0')[0].textContent.trim().split(/\s+/)[3])),Number(original));
    console.log('PASS '+count+' custom palettes / >8 MiB import / numeric tag roundtrip / RGB edit / fourth component / comments and CDATA / XML errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
