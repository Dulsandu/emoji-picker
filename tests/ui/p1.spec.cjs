const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('P1 windowed artwork, scrolling, keyboard, settings state and flags',async()=>{
 test.setTimeout(120000);
 const profile=await fs.mkdtemp(path.join(root,'.test-profile-p1-'));
 const env={...process.env,EMOJI_PICKER_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.EMOJI_P2_PACKAGED_EXE||process.env.EMOJI_P1_PACKAGED_EXE;
 const preferences=path.join(process.env.APPDATA,process.env.EMOJI_P2_PACKAGED_EXE?'Emoji Picker P2':'Emoji Picker P1','preferences.json');let saved;
 if(packaged)try{saved=await fs.readFile(preferences);}catch(e){if(e.code!=='ENOENT')throw e;}
 const app=await electron.launch(packaged?{executablePath:path.resolve(packaged),env}:{args:[root],env}),page=await app.firstWindow(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.locator('#emoji-grid .emoji').first().waitFor();
  const cdp=await page.context().newCDPSession(page);
  async function listeners(){const counts={};for(const selector of ['document','#emoji-grid','#back-button','#settings-button']){const {result}=await cdp.send('Runtime.evaluate',{expression:selector==='document'?'document':`document.querySelector(${JSON.stringify(selector)})`});counts[selector]=(await cdp.send('DOMDebugger.getEventListeners',{objectId:result.objectId})).listeners.length;await cdp.send('Runtime.releaseObject',{objectId:result.objectId});}return counts;}
  const before=await listeners(),scrollArtworkReadyMs=[];
  for(const category of ['Smileys & emotion','People & body','Animals & nature','Food & drink','Activities','Travel & places','Objects','Symbols','Flags']){
   await page.getByRole('button',{name:category,exact:true}).click();
   await expect.poll(()=>page.locator('#emoji-grid .emoji-art').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth===64))).toBe(true);
   expect(await page.locator('#emoji-grid .emoji').count()).toBeLessThan(200);
   const scroll=page.locator('#emoji-scroll');await scroll.hover();
   for(const delta of [70,700,1200,-450,250,-2000]){const started=Date.now();await page.mouse.wheel(0,delta);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('#emoji-grid .emoji')].every(b=>b.querySelector('img')?.complete&&b.querySelector('img')?.naturalWidth===64)),{timeout:2000,intervals:[16,32,50,100]}).toBe(true);
    scrollArtworkReadyMs.push(Date.now()-started);
    const coverage=await page.evaluate(()=>{const s=document.querySelector('#emoji-scroll'),r=s.getBoundingClientRect(),cells=[...document.querySelectorAll('#emoji-grid .emoji')].filter(b=>{const q=b.getBoundingClientRect();return q.bottom>r.top&&q.top<r.bottom;});return {visible:cells.length,loaded:cells.every(b=>b.querySelector('img')?.naturalWidth===64),mounted:document.querySelectorAll('#emoji-grid .emoji').length};});
    expect(coverage.visible).toBeGreaterThan(0);expect(coverage.loaded).toBe(true);expect(coverage.mounted).toBeLessThan(200);
   }
  }
  await page.getByRole('button',{name:'People & body',exact:true}).click();
  await page.locator('#search').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');
  expect(await page.evaluate(()=>Number(document.activeElement.dataset.index))).toBe(387);
  await page.keyboard.press('Home');expect(await page.evaluate(()=>document.activeElement.dataset.index)).toBe('0');
  await page.locator('#emoji-scroll').evaluate(e=>e.scrollTop=600);await page.waitForTimeout(100);
  const savedTop=await page.locator('#emoji-scroll').evaluate(e=>e.scrollTop);
  for(let i=0;i<6;i++){
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('#theme').selectOption(i%2?'light':'dark');
   await expect(page.locator('html')).toHaveAttribute('data-theme',i%2?'light':'dark');
   expect(await page.locator('.titlebar').evaluate(e=>getComputedStyle(e).getPropertyValue('app-region'))).toBe('no-drag');
   await page.getByRole('button',{name:'Back to emojis'}).click();await expect(page.locator('#settings-dialog')).not.toBeVisible();
   expect(await page.locator('#emoji-scroll').evaluate(e=>e.scrollTop)).toBe(savedTop);
   await expect(page.locator('[data-category="1"]')).toHaveAttribute('aria-current','true');
  }
  for(const [query,unicode] of [['Sri Lanka','🇱🇰'],['US','🇺🇸'],['UK','🇬🇧'],['India','🇮🇳'],['JP','🇯🇵'],['Australia','🇦🇺'],['Canada','🇨🇦'],['Germany','🇩🇪'],['France','🇫🇷'],['Brazil','🇧🇷'],['China','🇨🇳'],['OM','🇴🇲']]){
   await page.locator('#search').fill(query);const first=page.locator('#emoji-grid .emoji').first();
   await expect.poll(()=>first.locator('img').evaluate(i=>i.complete&&i.naturalWidth===64)).toBe(true);
   await first.click();await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(unicode);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Back to emojis'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#search')).toHaveValue('OM');
  if(process.env.EMOJI_P2_PACKAGED_EXE){
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   await expect(page.locator('.about')).toContainText('v1.2 P2');
   await expect(page.locator('.ownership')).toContainText('TechKey');
   await expect(page.locator('.ownership')).toContainText('Cryptic Sheep');
   await page.getByRole('button',{name:'Back to emojis'}).click();
  }
  const damaged=page.locator('#emoji-grid .emoji').first();await damaged.locator('img').evaluate(img=>img.src='../assets/emoji/intentional-missing.webp');
  await expect(damaged.locator('img')).toHaveCount(0);expect(await damaged.locator('.emoji-fallback').isVisible()).toBe(true);
  await damaged.click();expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('🇴🇲');
  console.log(`Scroll artwork readiness: max ${Math.max(...scrollArtworkReadyMs)} ms, average ${Math.round(scrollArtworkReadyMs.reduce((a,b)=>a+b,0)/scrollArtworkReadyMs.length)} ms`);
  expect(await listeners()).toEqual(before);expect(errors).toEqual([]);
 }finally{await app.close();if(packaged){if(saved)await fs.writeFile(preferences,saved);else await fs.rm(preferences,{force:true});}}
});
