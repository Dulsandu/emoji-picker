// Real Win32 input regression test, confined to two windows created by this test.
// No arbitrary desktop targets, no user text, no input logging; not shipped.
const { _electron: electron, expect }=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const koffi=require('koffi');
const user32=koffi.load('user32.dll');
// The test runner itself must use physical pixels too (the production helper
// already does). Otherwise a scaled desktop virtualizes GetWindowRect.
user32.func('int __stdcall SetProcessDpiAwarenessContext(intptr_t value)')(-4);
user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t value)')(-4);
const foreground=user32.func('uint64_t __stdcall GetForegroundWindow()');
const rect=user32.func('int __stdcall GetWindowRect(uint64_t hwnd, void *rect)');
const cursor=user32.func('int __stdcall SetCursorPos(int x, int y)');
const send=user32.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)');
const Point=koffi.struct('TestPoint',{x:'int',y:'int'});
const atPoint=user32.func('uint64_t __stdcall WindowFromPoint(TestPoint point)');
const ancestor=user32.func('uint64_t __stdcall GetAncestor(uint64_t hwnd, uint32_t flags)');
const root=path.resolve(__dirname,'..');
const data=require('../data/emojis.json').emojis.flatMap(x=>[x,...(x.variants||[])]);
const sequence=['1F600','2764','1F602','1F525','1F44D','1F44D-1F3FD','1F469-200D-1F4BB','1F468-200D-1F469-200D-1F467','1F1F1-1F1F0','0031-FE0F-20E3'];
let editor,picker,page,editPage,editorHwnd,pickerHwnd;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function hwnd(instance){return BigInt(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString()));}
function bounds(handle){const b=Buffer.alloc(16);assert.ok(rect(handle,b));return {left:b.readInt32LE(0),top:b.readInt32LE(4),right:b.readInt32LE(8),bottom:b.readInt32LE(12)};}
function inject(keys){
  assert.ok([editorHwnd,pickerHwnd].includes(BigInt(foreground())),'Input must be confined to a test-owned foreground window');
  const events=[...keys.map(key=>[key,false]),...keys.toReversed().map(key=>[key,true])],buffer=Buffer.alloc(events.length*40);
  events.forEach(([key,up],i)=>{const o=i*40;buffer.writeUInt32LE(1,o);buffer.writeUInt16LE(key,o+8);buffer.writeUInt32LE(up?2:0,o+12);buffer.writeBigUInt64LE(0x54455354n,o+24);});
  assert.equal(send(events.length,buffer,40),events.length);
}
function injectText(character){
  assert.ok([editorHwnd,pickerHwnd].includes(BigInt(foreground())),'Unicode input must remain in a test-owned window');
  const buffer=Buffer.alloc(80);for(let i=0;i<2;i++){const o=i*40;buffer.writeUInt32LE(1,o);buffer.writeUInt16LE(character.charCodeAt(0),o+10);buffer.writeUInt32LE(i?6:4,o+12);buffer.writeBigUInt64LE(0x54455354n,o+24);}assert.equal(send(2,buffer,40),2);
}
async function activate(instance,handle){
  if(BigInt(foreground())!==handle){
    await instance.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMinimized())w.restore();if(process.env.EMOJI_TEST_FOREGROUND_ACTIVATION)w.setAlwaysOnTop(true);w.show();w.focus();});
    await delay(80);
  }
  if(BigInt(foreground())!==handle){
    const box=bounds(handle);
    const hit=BigInt(ancestor(atPoint({x:box.left+180,y:box.top+18}),2));
    if(hit!==handle){
      const status=await instance.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),topmost:w.isAlwaysOnTop(),bounds:w.getBounds()};});
      throw Error('Test window is occluded: '+JSON.stringify({expected:String(handle),hit:String(hit),nativeBounds:box,status}));
    }
    // A real click on this test window's title/header supplies normal foreground
    // activation, just as the user clicking the inactive picker would.
    assert.ok(cursor(box.left+180,box.top+18));
    const mouse=Buffer.alloc(80);mouse.writeUInt32LE(2,20);mouse.writeUInt32LE(4,60);assert.equal(send(2,mouse,40),2);
  }
  await expect.poll(()=>BigInt(foreground()),{timeout:3000}).toBe(handle);await delay(70);
}
async function nativeClick(instance,handle,selector){
  const targetPage=instance===picker?page:editPage;
  const point=await targetPage.locator(selector).evaluate(el=>{el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};});
  await activate(instance,handle);
  const box=bounds(handle);
  // The picker is frameless, so client coordinates map directly to native bounds.
  assert.equal(instance,picker);
  const x=Math.round(box.left+point.x*(box.right-box.left)/point.width),y=Math.round(box.top+point.y*(box.bottom-box.top)/point.height);
  assert.ok(cursor(x,y));
  const buffer=Buffer.alloc(80);buffer.writeUInt32LE(2,20);buffer.writeUInt32LE(4,60);
  assert.equal(send(2,buffer,40),2);await delay(20);
}
(async()=>{
  const profile=await fs.mkdtemp(path.join(root,'.test-profile-native-regression-'));
  const env={...process.env,EMOJI_PICKER_TEST_USER_DATA:path.join(profile,'picker'),EMOJI_NATIVE_EDITOR_PROFILE:path.join(profile,'editor')};delete env.ELECTRON_RUN_AS_NODE;
  const report={checks:[],sequence:sequence.map(id=>data.find(x=>x.id===id).emoji).join(''),sessions:0};
  const preferences=path.join(process.env.APPDATA,process.argv[2]?.includes('v1.1.0')?'Emoji Picker':process.argv[2]?.includes('v1.2-p1')?'Emoji Picker P1':'Emoji Picker P2','preferences.json');
  let savedPreferences;
  if(process.argv[2])try{savedPreferences=await fs.readFile(preferences);}catch(error){if(error.code!=='ENOENT')throw error;}
  try {
    editor=await electron.launch({args:[path.join(root,'tests/native/editor.cjs')],env});editPage=await editor.firstWindow();await editPage.locator('#plain').waitFor();editorHwnd=await hwnd(editor);
    const executablePath=process.argv[2];
    picker=await electron.launch(executablePath?{executablePath:path.resolve(executablePath),args:['--hidden'],env}:{args:[root,'--hidden'],env});page=await picker.firstWindow();await page.waitForFunction(()=>window.picker);pickerHwnd=await hwnd(picker);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    assert.equal((await page.evaluate(()=>window.picker.bootstrap())).warning,'');
    const visible=()=>picker.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
    async function open(){
      await activate(editor,editorHwnd);inject([0x11,0x10,0x45]);await expect.poll(visible).toBe(true);
      await picker.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:760,y:80,width:432,height:552}));
      await expect.poll(()=>BigInt(foreground())).toBe(pickerHwnd);
    }
    // Physical Space is layout-independent. Literal Unicode SendInput also
    // verifies A without changing the user's keyboard layout or opening an IME composition.
    report.keyboardInput={resumedPhysicalKey:'Space',literalText:'A via Unicode SendInput'};
    let expected='Hello';await editPage.locator('#plain').fill(expected);
    await editPage.locator('#plain').focus();
    if(process.env.EMOJI_TEST_BACK_ONLY){
      await open();await nativeClick(picker,pickerHwnd,'#settings-button');
      await expect(page.locator('#settings-dialog')).toBeVisible();
      await nativeClick(picker,pickerHwnd,'#back-button');
      await expect(page.locator('#settings-dialog')).not.toBeVisible();
      assert.equal(await visible(),true);report.passed=true;report.checks.push('real Win32 click on Settings Back returns to picker');return;
    }
    for(let round=0;round<10;round++){
      await open();
      for(const id of sequence){
        await activate(picker,pickerHwnd);
        const result=await page.evaluate(id=>window.picker.copy(id),id);
        assert.equal(result.pasted,true,JSON.stringify({round,id,...result}));
        expected+=data.find(x=>x.id===id).emoji;
        await expect(editPage.locator('#plain')).toHaveValue(expected);
        await expect.poll(()=>BigInt(foreground())).toBe(editorHwnd);
        assert.equal(await visible(),true);
      }
      // An actual external key must pass through while hiding the picker.
      inject([0x20]);expected+=' ';await expect(editPage.locator('#plain')).toHaveValue(expected);await expect.poll(visible).toBe(false);
      report.sessions++;
      console.log('Native insertion session',report.sessions,'passed');
    }
    report.checks.push('10 global-shortcut sessions; 100 ordered Unicode pastes; visible inactive picker; first resumed physical Space key delivered in all 10 sessions');
    await open();
    const burst=sequence.slice(0,5);
    if(process.env.EMOJI_TEST_UNPACED_QUEUE){
      const burstResults=await page.evaluate(ids=>Promise.all(ids.map(id=>window.picker.copy(id))),burst);
      assert.ok(burstResults.every(x=>x.pasted));expected+=burst.map(id=>data.find(x=>x.id===id).emoji).join('');
      await expect(editPage.locator('#plain')).toHaveValue(expected);
      report.checks.push('unpaced concurrent IPC stress passed');
    }else{
      for(const id of burst){await activate(picker,pickerHwnd);await page.locator('#search').fill(data.find(x=>x.id===id).name);await nativeClick(picker,pickerHwnd,`#emoji-grid [data-id="${id}"]`);expected+=data.find(x=>x.id===id).emoji;await expect(editPage.locator('#plain')).toHaveValue(expected);assert.equal(await visible(),true);}
      report.checks.push('five consecutive real native mouse selections insert exact Unicode in order');
    }
    injectText('A');expected+='A';await expect(editPage.locator('#plain')).toHaveValue(expected);await expect.poll(visible).toBe(false);
    report.checks.push('Unicode SendInput A reaches target and hides picker');
    if(process.env.EMOJI_TEST_QUEUE_ONLY){report.passed=true;return;}
    await open();
    await page.locator('#search').focus();injectText('f');await expect(page.locator('#search')).toHaveValue('f');assert.equal(await visible(),true);
    inject([0x1B]);await delay(80);assert.equal(await visible(),true);
    report.checks.push('native typing inside search and Escape keep picker visible');
    await page.locator('#search').fill('red heart');await nativeClick(picker,pickerHwnd,'[data-id="2764"]');
    expected+='❤️';await expect(editPage.locator('#plain')).toHaveValue(expected);assert.equal(await visible(),true);
    report.checks.push('real native mouse click inside emoji cell pastes and keeps picker visible');
    // Outside click on a safe interior point of the separate test editor.
    const box=bounds(editorHwnd);assert.ok(cursor(box.left+100,box.top+100));
    const mouse=Buffer.alloc(80);mouse.writeUInt32LE(2,20);mouse.writeUInt32LE(4,60);assert.equal(send(2,mouse,40),2);
    await expect.poll(visible).toBe(false);report.checks.push('real outside mouse click hides already-inactive picker');
    await editPage.locator('#single').fill('Hello');await editPage.locator('#single').focus();await open();
    await activate(picker,pickerHwnd);assert.equal((await page.evaluate(()=>window.picker.copy('1F600'))).pasted,true);await expect(editPage.locator('#single')).toHaveValue('Hello😀');assert.equal(await visible(),true);
    await activate(picker,pickerHwnd);assert.equal((await page.evaluate(()=>window.picker.copy('2764'))).pasted,true);await expect(editPage.locator('#single')).toHaveValue('Hello😀❤️');assert.equal(await visible(),true);
    injectText('A');await expect(editPage.locator('#single')).toHaveValue('Hello😀❤️A');await expect.poll(visible).toBe(false);
    report.checks.push('Chromium input restores its caret for repeated emoji insertion and first resumed key');
    await editPage.locator('#rich').focus();await open();
    await activate(picker,pickerHwnd);assert.equal((await page.evaluate(()=>window.picker.copy('1F469-200D-1F4BB'))).pasted,true);
    await expect(editPage.locator('#rich')).toHaveText('👩‍💻');assert.equal(await visible(),true);
    injectText('A');await expect(editPage.locator('#rich')).toHaveText('👩‍💻A');await expect.poll(visible).toBe(false);
    report.checks.push('Chromium contenteditable restores its caret for ZWJ insertion and first resumed key');
    await open();await nativeClick(picker,pickerHwnd,'#settings-button');await expect(page.locator('#settings-dialog')).toBeVisible();
    await nativeClick(picker,pickerHwnd,'#back-button');await expect(page.locator('#settings-dialog')).not.toBeVisible();assert.equal(await visible(),true);
    report.checks.push('native Settings Back click returns to the visible picker');
    await nativeClick(picker,pickerHwnd,'#hide-button');await expect.poll(visible).toBe(false);
    report.checks.push('global shortcut toggles from external focus; native X click hides');
    assert.deepEqual(errors,[]);report.passed=true;report.executable=executablePath||'development';
    console.log(JSON.stringify(report,null,2));
  }finally{
    if(picker)await picker.close();if(editor)await editor.close();
    if(process.argv[2]){if(savedPreferences)await fs.writeFile(preferences,savedPreferences);else await fs.rm(preferences,{force:true});}
    await fs.mkdir(path.join(root,'test-results'),{recursive:true});
    await fs.writeFile(path.join(root,'test-results',process.argv[2]?'native-packaged-report.json':'native-development-report.json'),JSON.stringify(report,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
