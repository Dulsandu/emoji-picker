// Development-only interactive driver for the picker under test. Not packaged.
// Input is one JSON object per line; only the picker's own renderer is controlled.
const { _electron: electron } = require('@playwright/test');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs/promises');
const koffi=require('koffi');
const native=koffi.load('user32.dll');
native.func('int __stdcall SetProcessDpiAwarenessContext(intptr_t value)')(-4);
native.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t value)')(-4);
const rect=native.func('int __stdcall GetWindowRect(uint64_t hwnd, void *rect)');
const atPoint=native.func('uint64_t __stdcall WindowFromPoint('+koffi.struct('DriverPoint',{x:'int',y:'int'}).name+' point)');
const ancestor=native.func('uint64_t __stdcall GetAncestor(uint64_t hwnd, uint32_t flags)');
const cursor=native.func('int __stdcall SetCursorPos(int x, int y)');
const send=native.func('uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)');
(async()=>{
  const root=path.resolve(__dirname,'..'), env={...process.env,EMOJI_PICKER_TEST_USER_DATA:path.join(root,'.test-profile-native')};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.argv[2];
  const instance=await electron.launch(executablePath ? {executablePath:path.resolve(executablePath),args:['--hidden'],env} : {args:[path.join(root,'tests/desktop-entry.cjs'),'--hidden'],env});
  const page=await instance.firstWindow();await page.waitForFunction(()=>window.picker);
  console.log('READY');
  for await(const line of readline.createInterface({input:process.stdin})) {
    try {
      const command=JSON.parse(line);let result;
      if(command.action==='quit')break;
      if(command.action==='state')result=await instance.evaluate(async({BrowserWindow,clipboard,app,globalShortcut})=>({visible:BrowserWindow.getAllWindows()[0].isVisible(),focused:BrowserWindow.getAllWindows()[0].isFocused(),clipboard:await clipboard.readText(),version:app.getVersion(),registered:globalShortcut.isRegistered('Control+Shift+E'),state:global.__pickerTestSession?.state,capture:global.__pickerTestSession?.capture,lastClose:global.__pickerTestSession?.lastClose}));
      if(command.action==='focus')result=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
      if(command.action==='search')await page.locator('#search').fill(command.text);
      if(command.action==='click') {await page.locator('#emoji-grid [data-id="'+command.id+'"]').click();await page.waitForTimeout(550);result=await page.locator('#toast-text').textContent();}
      if(command.action==='copy')result=await page.evaluate(id=>window.picker.copy(id),command.id);
      if(command.action==='show')await instance.evaluate(({app})=>app.emit('second-instance'));
      if(command.action==='hide')await page.locator('#hide-button').click();
      if(command.action==='snapshot')await page.screenshot({path:path.join(root,'test-results',command.name+'.png')});
      if(command.action==='bootstrap')result=await page.evaluate(()=>window.picker.bootstrap());
      if(command.action==='run'){
        const sequence=command.basic?['1F600','2764','1F602','1F525']:['1F600','2764','1F602','1F525','1F44D','1F44D-1F3FD','1F469-200D-1F4BB','1F468-200D-1F469-200D-1F467','1F1F1-1F1F0','0031-FE0F-20E3'];
        const data=require('../data/emojis.json').emojis.flatMap(x=>[x,...(x.variants||[])]);
        await instance.evaluate(async()=>{const until=Date.now()+60000;while(global.__pickerTestSession.state!=='focused'||global.__pickerTestSession.capture?.reason!=='captured'){if(Date.now()>until)throw Error('Open picker from a text target first');await new Promise(r=>setTimeout(r,50));}});
        await page.waitForTimeout(300);
        const rounds=command.rounds||1, checks=[];
        for(let round=0;round<rounds;round++){
          if(round){await instance.evaluate(async()=>{global.__pickerTestSession.hide('test-cycle');await global.__pickerTestSession.show();});}
          for(const id of sequence){
            await page.locator('#search').fill(data.find(x=>x.id===id).name);
            const point=await page.locator('#emoji-grid [data-id="'+id+'"]').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight};});
            const handle=BigInt(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString()));
            const b=Buffer.alloc(16);if(!rect(handle,b))throw Error('No test picker rectangle');
            const x=Math.round(b.readInt32LE(0)+point.x*(b.readInt32LE(8)-b.readInt32LE(0))/point.width),y=Math.round(b.readInt32LE(4)+point.y*(b.readInt32LE(12)-b.readInt32LE(4))/point.height);
            const deadline=Date.now()+3000;
            while(BigInt(ancestor(atPoint({x,y}),2))!==handle){if(Date.now()>deadline)throw Error('Picker is occluded; refusing to click another application');await page.waitForTimeout(50);}
            const count=await instance.evaluate(()=>global.__testSelections.length);
            cursor(x,y);const mouse=Buffer.alloc(80);mouse.writeUInt32LE(2,20);mouse.writeUInt32LE(4,60);if(send(2,mouse,40)!==2)throw Error('Test click failed');
            const copied=await instance.evaluate(async(_,{count})=>{const until=Date.now()+3000;while(global.__testSelections.length<=count){if(Date.now()>until)throw Error('Selection not received');await new Promise(r=>setTimeout(r,20));}return global.__testSelections.at(-1);},{count});
            await page.waitForTimeout(100);
            const state=await instance.evaluate(({BrowserWindow})=>({visible:BrowserWindow.getAllWindows()[0].isVisible(),focused:BrowserWindow.getAllWindows()[0].isFocused()}));
            checks.push({round,id,pasted:copied.pasted,reason:copied.pasteReason,...state});
            if(!copied.pasted||!state.visible||state.focused)throw Error(JSON.stringify(checks.at(-1)));
          }
        }
        result={checks,expected:sequence.map(id=>data.find(x=>x.id===id).emoji).join('').repeat(rounds)};
        await fs.writeFile(path.join(root,'test-results','native-insertion.json'),JSON.stringify(result,null,2));
      }
      console.log(JSON.stringify({action:command.action,result}));
    } catch(error){console.log(JSON.stringify({error:error.message}));}
  }
  await instance.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
