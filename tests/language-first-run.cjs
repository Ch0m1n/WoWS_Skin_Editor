const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  try{
    const base=process.env.WORKSHOP_URL||'http://127.0.0.1:8771';
    for(const language of ['ko','en']){
      const page=await browser.newPage({viewport:{width:1100,height:800}});await page.goto(base);
      const dialog=page.locator('#language-dialog');await dialog.waitFor({state:'visible'});
      assert.match(await dialog.textContent(),/Choose your language/);assert.match(await dialog.textContent(),/한국어 \/ Korean/);assert.match(await dialog.textContent(),/English \/ 영어/);
      await page.keyboard.press('Escape');assert(await dialog.isVisible(),'The first-run chooser remains until a language is chosen');
      await page.locator(`[data-language-choice=${language}]`).click();
      await page.waitForFunction(value=>document.documentElement.lang===value&&!document.getElementById('language-dialog').open,language);
      assert.equal(await page.evaluate(()=>localStorage.getItem('workshop.language')),language);
      assert.equal(await page.locator('#open-model').textContent(),language==='en'?'Open ship':'모델 열기');
      await page.reload();assert(await dialog.isHidden(),'Saved choice skips the chooser on the next visit');
      assert.equal(await page.locator('#ui-language').inputValue(),language);
      const other=language==='ko'?'en':'ko';await page.locator('#ui-language').selectOption(other);
      await page.waitForFunction(value=>document.documentElement.lang===value&&!document.getElementById('language-dialog').open,other);
      assert.equal(await page.evaluate(()=>localStorage.getItem('workshop.language')),other);
      console.log('PASS first choice '+language+' / translated UI / saved choice / later switching');await page.close();
    }
    const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('workshop.language','invalid'));await page.goto(base);await page.locator('#language-dialog').waitFor({state:'visible'});await page.close();
    console.log('PASS invalid saved language prompts for a new choice');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
