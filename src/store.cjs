const fs = require('node:fs/promises');
const path = require('node:path');
const { sanitizeSettings } = require('./model.js');

class Store {
  constructor(directory, validIds) {
    this.file = path.join(directory, 'preferences.json');
    this.validIds = validIds;
    this.queue = Promise.resolve();
    this.state = { settings: sanitizeSettings(), recent: [] };
  }
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.state = {
        settings: sanitizeSettings(parsed.settings),
        recent: [...new Set(Array.isArray(parsed.recent) ? parsed.recent.filter(id => this.validIds.has(id)) : [])].slice(0, 56)
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.warning = 'Saved preferences could not be read. Defaults were restored.';
        await fs.copyFile(this.file, `${this.file}.recovery-${Date.now()}`).catch(() => {});
      }
    }
    return this.state;
  }
  save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const write = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      await fs.rename(temporary, this.file);
    });
    this.queue = write;
    return write;
  }
}
module.exports = { Store };
