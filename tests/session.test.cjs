const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PickerSession } = require('../src/picker-session.cjs');
const { WindowsBridge, shortcutKeys } = require('../src/windows-bridge.cjs');
const { sanitizeSettings } = require('../src/model.js');
const path = require('node:path');
const { spawn } = require('node:child_process');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture() {
  const calls = [], bridge = new EventEmitter();
  Object.assign(bridge, {
    begin: async generation => { calls.push(['capture', generation]); return { ok:true }; },
    end: async generation => calls.push(['end', generation]),
    paste: async generation => { calls.push(['paste', generation]); return {ok:true}; }
  });
  const window = {
    visible:false, focused:false, getNativeWindowHandle:()=>Buffer.from([1,0,0,0,0,0,0,0]),
    isMinimized:()=>false, isFocused:()=>window.focused,
    show:()=>{window.visible=true;calls.push(['show']);},
    focus:()=>{window.focused=true;calls.push(['focus']);},
    moveTop:()=>calls.push(['raise']),
    hide:()=>{window.visible=false;calls.push(['hide']);}
  };
  const session = new PickerSession({window, bridge, place:()=>calls.push(['place']), onShow:()=>{}});
  return {session,bridge,window,calls};
}
test('capture precedes show; paste keeps one visible window without stealing focus', async()=>{
  const {session,bridge,window,calls}=fixture();
  await session.show(); assert.deepEqual(calls.slice(0,4).map(c=>c[0]),['capture','place','show','focus']);
  bridge.paste=async()=>{window.focused=false;session.focusChanged(false);return {ok:true};};
  const before=calls.length;
  assert.equal((await session.select(async()=>({ok:true}))).pasted,true);
  assert.equal(window.visible,true); assert.equal(session.state,'external');
  assert.deepEqual(calls.slice(before),[['raise']]);
  session.focusChanged(true);assert.equal(session.state,'focused');
  session.focusChanged(false);assert.equal(window.visible,true);
});
test('rapid selections serialize each clipboard write behind previous paste completion', async()=>{
  const {session,bridge}=fixture(); await session.show();
  const gate=deferred(), order=[];
  bridge.paste=async()=>{order.push('paste');if(order.length===2)await gate.promise;return {ok:true};};
  const first=session.select(async()=>{order.push('copy A');return {ok:true};});
  const second=session.select(async()=>{order.push('copy B');return {ok:true};});
  await new Promise(setImmediate);assert.deepEqual(order,['copy A','paste']);
  gate.resolve();await Promise.all([first,second]);
  assert.deepEqual(order,['copy A','paste','copy B','paste']);
});
test('dismiss while opening cancels show; stale dismiss cannot hide reopened session',async()=>{
  const {session,bridge,window}=fixture();const gate=deferred();
  bridge.begin=()=>gate.promise;
  const opening=session.show();const old=session.generation;session.toggle();gate.resolve({ok:true});await opening;
  assert.equal(window.visible,false);await session.show();
  bridge.emit('dismiss',{session:old,event:'external-key'});assert.equal(window.visible,true);
  bridge.emit('dismiss',{session:session.generation,event:'outside-click'});assert.equal(window.visible,false);
});
test('a stale queued selection copies but never pastes into a new session target',async()=>{
  const {session,bridge,calls}=fixture(); await session.show();
  const gate=deferred();bridge.paste=()=>gate.promise;
  const first=session.select(async()=>({ok:true}));
  const second=session.select(async()=>({ok:true}));await new Promise(setImmediate);
  session.hide('shortcut');await session.show();gate.resolve({ok:true});
  await first;assert.equal((await second).pasted,false);
  assert.equal(calls.filter(c=>c[0]==='capture').length,2);
});
test('copy failures skip paste; helper failures retain clipboard fallback and visibility',async()=>{
  const {session,bridge,window,calls}=fixture();await session.show();
  assert.equal((await session.select(async()=>({ok:false}))).ok,false);
  assert.equal(calls.some(c=>c[0]==='paste'),false);
  bridge.paste=async()=>({ok:false,reason:'blocked'});
  const result=await session.select(async()=>({ok:true,recent:['1F600']}));
  assert.equal(result.pasted,false);assert.equal(result.pasteReason,'blocked');
  assert.deepEqual(result.recent,['1F600']);assert.equal(window.visible,true);
});
test('v1.0 auto-hide is migrated; shortcut keys preserve the configurable toggle',()=>{
  assert.equal(sanitizeSettings({keepOpen:false,theme:'dark'}).keepOpen,true);
  assert.deepEqual(shortcutKeys('Control+Shift+E'),[0x45,5]);
  assert.deepEqual(shortcutKeys('Alt+F8'),[0x77,2]);
});
test('real native helper starts, validates protocol, and exits without an orphan', {skip:process.platform!=='win32'},async()=>{
  const bridge=new WindowsBridge(path.resolve('native/bin/WindowsBridge.exe'));
  try{
    assert.equal(await bridge.start(),true);
    assert.equal(typeof bridge.allowForeground,'function');
    assert.equal((await bridge.configure('Control+Shift+E')).ok,true);
    assert.equal((await bridge.begin(1,'0')).reason,'invalid-window');
    assert.equal((await bridge.paste(1)).ok,false);
  } finally {await bridge.stop();}
  assert.notEqual(bridge.child.exitCode,null);
});
test('native helper exits when its parent is terminated', {skip:process.platform!=='win32'},async()=>{
  const parent=spawn(process.execPath,[path.resolve('tests/native/helper-parent.cjs')],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let helperPid;
  try{
    helperPid=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Helper parent did not start')),3000);
      parent.stdout.once('data',data=>{clearTimeout(timeout);resolve(Number(data.toString().trim()));});
      parent.once('error',reject);
    });
    assert.ok(helperPid>0);parent.kill();
    const deadline=Date.now()+3000;
    while(Date.now()<deadline){try{process.kill(helperPid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}await new Promise(r=>setTimeout(r,30));}
    assert.fail('Native helper survived parent termination');
  }finally{parent.kill();if(helperPid)try{process.kill(helperPid);}catch{}}
});
