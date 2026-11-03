'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('picker', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('picker:bootstrap'),
  hide: () => ipcRenderer.invoke('picker:hide'),
  copy: id => ipcRenderer.invoke('picker:copy', id),
  updateSettings: patch => ipcRenderer.invoke('picker:settings', patch),
  onShow: callback => subscribe('picker:shown', callback),
  onTheme: callback => subscribe('picker:theme', callback)
}));
