'use strict';
// One generation per opening. Native dismissals and queued copies from an old
// generation cannot hide a new panel or paste into its new target.
class PickerSession {
  constructor({ window, bridge, place, onShow }) {
    Object.assign(this, { window, bridge, place, onShow });
    this.state = 'hidden'; this.generation = 0; this.queue = Promise.resolve();
    bridge.on('dismiss', event => { if (event.session === this.generation) this.hide(event.event); });
  }
  async show(settings = false) {
    if (this.state !== 'hidden') {
      if (this.state === 'opening') return;
      this.window.show(); this.window.focus(); this.state = 'focused'; this.onShow(settings); return;
    }
    const generation = ++this.generation;
    this.state = 'opening';
    const handle = this.window.getNativeWindowHandle();
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    // Capture foreground before any Electron show/focus call.
    this.capture = await this.bridge.begin(generation, hwnd);
    if (generation !== this.generation || this.state !== 'opening') return;
    this.place();
    if (this.window.isMinimized()) this.window.restore();
    this.window.show(); this.window.focus(); this.state = 'focused'; this.onShow(settings);
  }
  toggle() { if (this.state === 'hidden') return this.show(); this.hide('shortcut'); }
  hide(reason) {
    if (this.state === 'hidden') return;
    const previous = this.generation++;
    this.state = 'hidden'; this.lastClose = reason;
    this.window.hide(); void this.bridge.end(previous);
  }
  focusChanged(focused) {
    if (this.state === 'hidden' || this.state === 'opening' || this.state === 'inserting') return;
    this.state = focused ? 'focused' : 'external';
  }
  select(copy) {
    const generation = this.generation;
    const operation = this.queue.catch(() => {}).then(async () => {
      // Serialize the clipboard write WITH paste completion so fast clicks retain order.
      const result = await copy();
      if (!result.ok) return result;
      let pasted = { ok:false, reason:'cancelled' };
      if (generation === this.generation && this.state !== 'hidden' && this.state !== 'opening') {
        this.state = 'inserting';
        pasted = await this.bridge.paste(generation);
        if (generation === this.generation && this.state !== 'hidden') {
          // Already visible: no hide/show cycle, no refocus, no flicker.
          if (pasted.ok) this.window.moveTop();
          this.state = this.window.isFocused() ? 'focused' : 'external';
        }
      }
      return { ...result, pasted:pasted.ok, pasteReason:pasted.reason };
    });
    this.queue = operation;
    return operation;
  }
}
module.exports = { PickerSession };
