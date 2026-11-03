'use strict';
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, session, Tray } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./src/store.cjs');
const { WindowsBridge } = require('./src/windows-bridge.cjs');
const { PickerSession } = require('./src/picker-session.cjs');
const { position, recentAfterCopy, sanitizeSettings, unsafeShortcut, validShortcut } = require('./src/model.js');
// Main needs only the Unicode allowlist, not renderer search/label metadata.
const known = new Map(JSON.parse(fs.readFileSync(path.join(__dirname,'data','emojis.json'),'utf8')).emojis.flatMap(item => [item, ...(item.variants || [])]).map(item => [item.id, {emoji:item.emoji}]));
const pagePath = path.join(__dirname, 'src', 'index.html');
const pageUrl = pathToFileURL(pagePath).href;
app.setName('Emoji Picker P2');
const profile = !app.isPackaged && process.env.EMOJI_PICKER_TEST_USER_DATA
  ? process.env.EMOJI_PICKER_TEST_USER_DATA : path.join(app.getPath('appData'), 'Emoji Picker P2');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const hasLock = app.requestSingleInstanceLock();
let window, tray, store, ready = false, quitting = false, quitFlushed = false, shortcutError = '';
let pendingShow = false;
let bridge, pickerSession;
let settingsQueue = Promise.resolve();
const startupSupported = () => app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;

function theme() {
  nativeTheme.themeSource = store.state.settings.theme;
  window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#20252b' : '#fafbf9');
}
function showPicker(settings = false) {
  if (!ready) { pendingShow = true; return; }
  if (!quitting) return pickerSession.show(settings);
}
function placePicker() {
  const cursor = screen.getCursorScreenPoint();
  window.setBounds(position(cursor, screen.getDisplayNearestPoint(cursor).workArea));
}
function togglePicker() { if (ready && !quitting) return pickerSession.toggle(); }
function registerShortcut(accelerator) {
  try { return globalShortcut.register(accelerator, togglePicker); } catch { return false; }
}
function payload() {
  return { ...store.state, dark: nativeTheme.shouldUseDarkColors, shortcutError, warning: store.warning || (!bridge?.available ? 'Windows integration is unavailable. Emojis can still be copied.' : ''), startupSupported: startupSupported(), version: app.getVersion() };
}
function trusted(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('Untrusted IPC sender');
}
function handle(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { trusted(event); return fn(...args); }); }
function configureIPC() {
  handle('picker:bootstrap', () => payload());
  handle('picker:hide', () => pickerSession.hide('close-button'));
  handle('picker:copy', async id => {
    if (typeof id !== 'string' || !known.has(id)) return { ok: false, error: 'This emoji is unavailable.' };
    return pickerSession.select(async () => {
      try { await clipboard.writeText(known.get(id).emoji); }
      catch { return { ok: false, error: 'Clipboard is busy. Please try again.' }; }
      store.state.recent = recentAfterCopy(store.state.recent, id);
      let warning = '';
      try { await store.save(); } catch { warning = 'Copied, but recent emojis could not be saved.'; }
      return { ok: true, recent: [...store.state.recent], warning };
    });
  });
  handle('picker:settings', patch => {
    const job = settingsQueue.catch(() => {}).then(() => updateSettings(patch));
    settingsQueue = job;
    return job;
  });
}
async function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !Object.hasOwn(store.state.settings, key))) return { ok: false, error: 'Invalid preference.' };
  const old = { ...store.state.settings };
  const next = sanitizeSettings({ ...old, ...patch });
  if (Object.entries(patch).some(([key, value]) => next[key] !== value)) return { ok: false, error: 'Invalid preference value.' };
  const shortcutUpdated = Object.hasOwn(patch, 'shortcut');
  if (shortcutUpdated) {
    if (unsafeShortcut(next.shortcut)) return { ok: false, error: 'Choose a shortcut that does not replace common editing or window commands.' };
    if (!validShortcut(next.shortcut)) return { ok: false, error: 'Use Ctrl or Alt with a letter, number, or function key.' };
    if (next.shortcut !== old.shortcut && !registerShortcut(next.shortcut)) return { ok: false, error: 'That shortcut is in use. Your previous shortcut is still active.' };
    if (next.shortcut === old.shortcut && !globalShortcut.isRegistered(next.shortcut) && !registerShortcut(next.shortcut)) return { ok: false, error: 'That shortcut is in use. Choose another combination.' };
  }
  try {
    if (next.launchAtLogin !== old.launchAtLogin) {
      if (!startupSupported()) throw new Error('Install Emoji Picker to enable launch at Windows startup.');
      // Keep Electron's default AppUserModelId registry name: its reader uses that key.
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, path: process.execPath, args: ['--hidden'] });
      if (app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin !== next.launchAtLogin) throw new Error('Windows could not update the startup preference.');
    }
    store.state.settings = next;
    await store.save();
  } catch (error) {
    store.state.settings = old;
    if (next.shortcut !== old.shortcut) globalShortcut.unregister(next.shortcut);
    if (next.launchAtLogin !== old.launchAtLogin && startupSupported()) app.setLoginItemSettings({ openAtLogin: old.launchAtLogin, path: process.execPath, args: ['--hidden'] });
    return { ok: false, error: error.message || 'Preferences could not be saved.' };
  }
  if (next.shortcut !== old.shortcut) globalShortcut.unregister(old.shortcut);
  if (shortcutUpdated) {
    await bridge.configure(next.shortcut);
    shortcutError = '';
  }
  theme();
  return { ok: true, ...payload() };
}
async function start() {
  app.setAppUserModelId('com.techkey.emojipicker.p2');
  store = new Store(app.getPath('userData'), new Set(known.keys()));
  await store.load();
  if (startupSupported()) store.state.settings.launchAtLogin = app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin;
  else store.state.settings.launchAtLogin = false;
  nativeTheme.themeSource = store.state.settings.theme;
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
  window = new BrowserWindow({
    width: 432, height: 552, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    show: false, skipTaskbar: true, alwaysOnTop: true, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#20252b' : '#fafbf9',
    title: 'Emoji Picker', icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // The explicit X IPC hides; a generic close/blur is not an insertion dismissal.
  window.on('close', event => { if (!quitting) event.preventDefault(); });
  window.on('focus', () => pickerSession?.focusChanged(true));
  window.on('blur', () => pickerSession?.focusChanged(false));
  window.webContents.on('render-process-gone', () => { pickerSession.hide('renderer-recovery'); ready = false; window.reload(); });
  window.webContents.on('did-finish-load', () => {
    ready = true;
    if (pendingShow || !process.argv.includes('--hidden')) { pendingShow = false; showPicker(); }
  });
  bridge = new WindowsBridge(path.join(app.isPackaged ? process.resourcesPath : __dirname, 'native', ...(app.isPackaged ? [] : ['bin']), 'WindowsBridge.exe'));
  pickerSession = new PickerSession({ window, bridge, place: placePicker, onShow: settings => window.webContents.send('picker:shown', { settings }) });
  await bridge.start();
  await bridge.configure(store.state.settings.shortcut);
  configureIPC();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Emoji Picker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Emoji Picker', click: () => showPicker() },
    { label: 'Settings', click: () => showPicker(true) },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]));
  if (!registerShortcut(store.state.settings.shortcut)) shortcutError = 'Your shortcut is in use. Open Settings to choose another; the tray icon still works.';
  nativeTheme.on('updated', () => {
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#20252b' : '#fafbf9');
    window.webContents.send('picker:theme', nativeTheme.shouldUseDarkColors);
  });
  screen.on('display-metrics-changed', () => { if (window.isVisible()) placePicker(); });
  screen.on('display-removed', () => { if (window.isVisible()) placePicker(); });
  await window.loadFile(pagePath);
}
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => showPicker());
  app.on('activate', () => showPicker());
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    quitting = true;
    globalShortcut.unregisterAll();
    if (store && !quitFlushed) {
      event.preventDefault();
      pickerSession?.hide('quit');
      Promise.allSettled([store.queue, settingsQueue, pickerSession?.queue]).then(async () => { await bridge?.stop(); quitFlushed = true; app.quit(); });
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
  app.whenReady().then(start).catch(error => { console.error(error); app.exit(1); });
}
