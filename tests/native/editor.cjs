// Isolated external browser editor used only by the native integration tests.
const {app,BrowserWindow}=require('electron');
app.setPath('userData',process.env.EMOJI_NATIVE_EDITOR_PROFILE);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({x:40,y:40,width:650,height:420,alwaysOnTop:true,title:'Emoji insertion test editor',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"><title>Emoji insertion test editor</title></head><body><label>Single-line input <input id="single" style="width:70%"></label><p><label>Plain textarea<textarea id="plain" style="width:90%;height:90px"></textarea></label></p><p>Rich contenteditable</p><div id="rich" contenteditable="true" role="textbox" style="border:1px solid;padding:10px;height:90px"></div></body></html>'));
});
app.on('window-all-closed',()=>app.quit());
