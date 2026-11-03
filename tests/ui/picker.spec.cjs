const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
let instance,page,profile;
const errors=[];
async function launch(extra=[]) {
  const env={...process.env,EMOJI_PICKER_TEST_USER_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE;
  instance=await electron.launch({args:[root,...extra],env});
  page=await instance.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await expect(page.locator('#emoji-grid .emoji').first()).toBeVisible();
}
test('desktop workflow, secure IPC, persistence, themes and warm opening',async()=>{
  profile=await fs.mkdtemp(path.join(root,'.test-profile-'));
  await launch();
  try {
    await fs.mkdir(path.join(root,'test-results'),{recursive:true});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('#theme').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.getByRole('button',{name:'Back to emojis'}).click();
    await page.screenshot({path:path.join(root,'test-results','picker-light.png')});
    expect(await page.evaluate(()=>typeof require)).toBe('undefined');
    expect((await page.evaluate(()=>window.picker.copy('not-an-emoji'))).ok).toBe(false);
    expect((await page.evaluate(()=>window.picker.updateSettings({unknown:true}))).ok).toBe(false);
    expect(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+E'))).toBe(true);
    const search=page.getByRole('searchbox',{name:'Search emoji'});
    await search.fill('laugh');
    await expect(page.locator('[data-id="1F602"]')).toBeVisible();
    await expect(page.locator('[data-id="1F923"]')).toBeVisible();
    await page.locator('[data-id="1F602"]').click();
    await expect(page.locator('#toast')).toBeVisible();
    expect(await instance.evaluate(({clipboard})=>clipboard.readText())).toBe('😂');
    await search.fill('nonsensezzzz');await expect(page.locator('#empty')).toBeVisible();
    await page.getByRole('button',{name:'People & body',exact:true}).click();
    expect(Number(await page.locator('#result-count').textContent())).toBeGreaterThan(300);
    expect(await page.locator('#emoji-grid .emoji').count()).toBeLessThan(200);
    await search.fill('thumbs up');
    await page.locator('#emoji-grid [data-id="1F44D"]').click({button:'right'});
    await expect(page.locator('#variants-grid .emoji')).toHaveCount(6);
    await page.locator('#variants-grid [data-id="1F44D-1F3FD"]').click();
    expect(await instance.evaluate(({clipboard})=>clipboard.readText())).toBe('👍🏽');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('#theme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.getByRole('button',{name:'Medium skin tone',exact:true}).click();
    await page.screenshot({path:path.join(root,'test-results','settings-dark.png')});
    await page.getByRole('button',{name:'Back to emojis'}).click();
    await expect(page.locator('#emoji-grid [data-id="1F44D-1F3FD"]')).toBeVisible();
    await page.getByRole('button',{name:'Smileys & emotion',exact:true}).click();
    await page.screenshot({path:path.join(root,'test-results','picker-dark.png')});
    await search.focus();await search.press('ArrowDown');
    expect(await page.locator('#emoji-grid .emoji').first().evaluate(el=>el===document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    expect(await instance.evaluate(({clipboard})=>clipboard.readText())).not.toBe('');
    const latencies=await instance.evaluate(async({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0],times=[];
      for(let i=0;i<20;i++){win.hide();const start=performance.now();win.show();times.push(performance.now()-start);}
      return times;
    });
    console.log('Warm BrowserWindow.show() ms:',JSON.stringify(latencies));
    expect(Math.max(...latencies)).toBeLessThan(1000);
    await search.fill('rocket');await page.locator('#emoji-grid [data-id="1F680"]').click();
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await page.locator('#hide-button').click();
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    expect(await instance.evaluate(({clipboard})=>clipboard.readText())).toBe('🚀');
    const secondEnv={...process.env,EMOJI_PICKER_TEST_USER_DATA:profile};delete secondEnv.ELECTRON_RUN_AS_NODE;
    const exitCode=await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[root],{env:secondEnv,windowsHide:true,stdio:'ignore'});child.on('exit',resolve);child.on('error',reject);});
    expect(exitCode).toBe(0);
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    expect(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
    await instance.close();
    await launch();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('#emoji-grid .emoji').first()).toHaveAttribute('data-id','1F680');
    const saved=await page.evaluate(()=>window.picker.bootstrap());
    expect(saved.settings.keepOpen).toBe(true);expect(saved.settings.tone).toBe(3);
    const conflict=await instance.evaluate(({globalShortcut})=>globalShortcut.register('Control+Alt+J',()=>{}));
    expect(conflict).toBe(true);
    const failure=await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+Alt+J'}));
    expect(failure.ok).toBe(false);
    expect(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+E'))).toBe(true);
    await instance.evaluate(({globalShortcut})=>globalShortcut.unregister('Control+Alt+J'));
    expect((await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+Alt+J'}))).ok).toBe(true);
    expect((await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+Shift+E'}))).ok).toBe(true);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('#theme').selectOption('system');
    await expect(page.locator('#settings-status')).toHaveText('Saved');
    await instance.evaluate(({nativeTheme})=>nativeTheme.themeSource='light');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await instance.evaluate(({nativeTheme})=>nativeTheme.themeSource='dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    expect(errors).toEqual([]);
  } finally {if(instance)await instance.close();}
});
for(const scale of [1,1.25,1.5,1.75]) test(`layout at ${scale*100}% display scaling`,async()=>{
  profile=await fs.mkdtemp(path.join(root,'.test-profile-dpi-'));
  await launch([`--force-device-scale-factor=${scale}`]);
  try {
    await page.getByRole('button',{name:'People & body',exact:true}).click();
    const dimensions=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>innerWidth,
      columns:getComputedStyle(document.getElementById('emoji-grid')).gridTemplateColumns.split(' ').length,
      gridWidth:document.getElementById('emoji-grid').getBoundingClientRect().width,
      dpr:devicePixelRatio,
      font:getComputedStyle(document.getElementById('search')).fontFamily
    }));
    console.log('Layout',scale,dimensions);
    expect(dimensions.overflow).toBe(false);expect(dimensions.columns).toBe(8);
    await page.screenshot({path:path.join(root,'test-results',`dpi-${scale}.png`)});
  }finally{await instance.close();}
});
