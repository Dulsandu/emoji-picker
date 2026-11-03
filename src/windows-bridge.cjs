'use strict';
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function shortcutKeys(shortcut) {
  const parts = shortcut.split('+'), key = parts.at(-1);
  return [key.startsWith('F') && key.length > 1 ? 0x6f + Number(key.slice(1)) : key.charCodeAt(0),
    (parts.includes('Control') ? 1 : 0) | (parts.includes('Alt') ? 2 : 0) | (parts.includes('Shift') ? 4 : 0)];
}
class WindowsBridge extends EventEmitter {
  constructor(executable) {
    super(); this.executable = executable; this.pending = new Map(); this.counter = 0; this.available = false;
    try {
      // Only the foreground Electron process can delegate its focus permission.
      // Grant it solely to our child, never ASFW_ANY. Windows can still refuse.
      this.user32 = require('koffi').load(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'user32.dll'));
      this.allowForeground = this.user32.func('int __stdcall AllowSetForegroundWindow(uint32_t processId)');
    } catch { this.allowForeground = null; }
  }
  async start() {
    if (this.child) return this.ready;
    this.child = spawn(this.executable, [String(process.pid)], { stdio: ['pipe','pipe','ignore'], windowsHide: true });
    this.ready = new Promise(resolve => {
      const timer = setTimeout(() => { resolve(false); this.child?.kill(); }, 2500);
      const lines = createInterface({ input: this.child.stdout });
      lines.on('line', line => {
        let value; try { value = JSON.parse(line); } catch { return; }
        if (value.event === 'ready') { clearTimeout(timer); this.available = true; resolve(true); }
        else if (value.id) { const waiter = this.pending.get(value.id); if (waiter) { this.pending.delete(value.id); clearTimeout(waiter.timer); waiter.resolve(value); } }
        else if (['outside-click','external-key'].includes(value.event)) this.emit('dismiss', value);
      });
      const failed = () => {
        clearTimeout(timer); this.available = false; resolve(false);
        for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.resolve({ ok:false, reason:'helper-unavailable' }); }
        this.pending.clear(); this.emit('unavailable');
      };
      this.child.once('error', failed); this.child.once('exit', failed);
      this.child.stdin.on('error', () => {});
    });
    return this.ready;
  }
  request(command, ...args) {
    if (!this.available) return Promise.resolve({ ok:false, reason:'helper-unavailable' });
    const id = ++this.counter;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok:false, reason:'timeout' }); this.child?.kill(); }, 1500);
      this.pending.set(id, { resolve, timer });
      this.child.stdin.write([id,command,...args].join('\t') + '\n');
    });
  }
  configure(shortcut) { return this.request('shortcut', ...shortcutKeys(shortcut)); }
  begin(session, handle) { return this.request('begin', session, handle); }
  end(session) { return this.request('end', session); }
  paste(session) {
    if (this.available && this.child?.pid && this.allowForeground) this.allowForeground(this.child.pid);
    return this.request('paste', session);
  }
  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await this.request('quit');
    await new Promise(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 500);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.stdin.end();
    });
  }
}
module.exports = { WindowsBridge, shortcutKeys };
