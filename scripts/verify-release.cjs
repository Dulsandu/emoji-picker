// Runs against a real packaged executable; restores the original preferences afterward.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const executablePath = path.resolve(process.argv[2] || 'dist/v1.2-p2/build/win-unpacked/Emoji Picker P2.exe');
const preferencePath = path.join(process.env.APPDATA,'Emoji Picker P2','preferences.json');
(async()=>{
  let previous;
  try{previous=await fs.readFile(preferencePath);}catch(error){if(error.code!=='ENOENT')throw error;}
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const instance=await electron.launch({executablePath,args:['--hidden'],env});
  const errors=[];
  try {
    const page=await instance.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.querySelector('#emoji-grid .emoji'));
    assert.equal(await instance.evaluate(({app})=>app.isPackaged),true);
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.equal(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+E')),true);
    assert.equal(await instance.evaluate(({app})=>app.getName()),'Emoji Picker P2');
    await instance.evaluate(({app})=>app.emit('second-instance'));
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await page.getByRole('searchbox',{name:'Search emoji'}).fill('woman technologist');
    await page.locator('[data-id="1F469-200D-1F4BB"]').click();
    assert.equal(await instance.evaluate(({clipboard})=>clipboard.readText()),'👩‍💻');
    assert.equal((await page.evaluate(()=>window.picker.bootstrap())).recent[0],'1F469-200D-1F4BB');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('#theme').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.locator('#theme').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.locator('#theme').selectOption('system');
    await expect.poll(()=>instance.evaluate(({nativeTheme})=>nativeTheme.themeSource)).toBe('system');
    await page.locator('#theme').selectOption('light');
    const original=(await page.evaluate(()=>window.picker.bootstrap())).settings;
    const startupSupported=(await page.evaluate(()=>window.picker.bootstrap())).startupSupported;
    if(startupSupported) try {
      await page.locator('#startup').check();
      await expect(page.locator('#settings-status')).toHaveText('Saved');
      await expect.poll(()=>instance.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath,args:['--hidden']}).openAtLogin)).toBe(true);
      await page.locator('#startup').uncheck();
      await expect(page.locator('#settings-status')).toHaveText('Saved');
      await expect.poll(()=>instance.evaluate(({app})=>app.getLoginItemSettings({path:process.execPath,args:['--hidden']}).openAtLogin)).toBe(false);
    }finally{await page.evaluate(settings=>window.picker.updateSettings(settings),original);}
    else await expect(page.locator('#startup')).toBeDisabled();
    assert.equal((await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+Alt+J'}))).ok,true);
    assert.equal(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+J')),true);
    assert.equal(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Shift+E')),false);
    assert.equal((await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+V'}))).ok,false);
    assert.equal(await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+J')),true);
    assert.equal((await page.evaluate(()=>window.picker.updateSettings({shortcut:'Control+Shift+E'}))).ok,true);
    await page.getByRole('button',{name:'Back to emojis'}).click();
    await page.screenshot({path:'test-results/release-light.png'});
    await page.keyboard.press('Escape');
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
    await page.locator('#hide-button').click();
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.equal(await instance.evaluate(({clipboard})=>clipboard.readText()),'👩‍💻');
    const firstPid=await instance.evaluate(()=>process.pid);
    const second=spawn(executablePath,['--hidden'],{env,windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{second.kill();reject(Error('Second instance did not exit'));},30000);
      second.once('error',error=>{clearTimeout(timer);reject(error);});
      second.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Second instance exit '+code));});
    });
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    assert.equal(await instance.evaluate(()=>process.pid),firstPid);
    assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
    await page.locator('#hide-button').click();
    const metrics=await instance.evaluate(async({app})=>{
      app.getAppMetrics();await new Promise(resolve=>setTimeout(resolve,3000));
      return app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetMB:Math.round(p.memory.workingSetSize/1024)}));
    });
    const bounds=await instance.evaluate(({BrowserWindow,screen})=>({window:BrowserWindow.getAllWindows()[0].getBounds(),displays:screen.getAllDisplays().map(d=>({workArea:d.workArea,scaleFactor:d.scaleFactor}))}));
    assert.deepEqual(errors,[]);
    const report={executablePath,passed:true,checks:['packaged launch','P2 identity','hidden startup','global shortcut registration','custom shortcut replaces old registration','unsafe editing shortcut rejected without losing active shortcut','ZWJ clipboard','recents updated','light/dark/system themes',startupSupported?'Windows startup on/off':'portable startup disabled','Escape keeps picker open','X hides','clipboard survives hide','real second process exits and shows existing single window','no renderer errors'],metrics,bounds};
    await fs.writeFile('test-results/release-report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }finally{
    await instance.close();
    if(previous)await fs.writeFile(preferencePath,previous);else await fs.rm(preferencePath,{force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
