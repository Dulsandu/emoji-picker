(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EmojiModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = Object.freeze({ theme: 'system', shortcut: 'Control+Shift+E', keepOpen: true, tone: 0, launchAtLogin: false });
  const normalize = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_:\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  function createIndex(data) {
    return data.map(item => ({ item, name: normalize(item.name), text: normalize([item.name, ...(item.keywords || [])].join(' ')) }));
  }
  function search(index, query) {
    const q = normalize(query);
    if (!q) return [];
    const words = q.split(' ');
    return index.filter(row => row.item.emoji === query.trim() || words.every(word => row.text.includes(word)))
      .map(row => ({ item: row.item, score: row.item.countryCode?.toLowerCase()===q ? -1 : row.item.emoji === query.trim() || row.name === q || (row.item.countryCode && row.item.keywords.some(k=>normalize(k)===q)) ? 0 : row.name.startsWith(q) ? 1 : row.name.includes(q) ? 2 : 3 }))
      .sort((a, b) => a.score - b.score || a.item.order - b.item.order).map(row => row.item);
  }
  function preferred(item, tone) {
    return tone ? item.variants?.find(v => v.tones?.every(t => t === tone)) || item : item;
  }
  function recentAfterCopy(recent, id) { return [id, ...recent.filter(value => value !== id)].slice(0, 56); }
  function sanitizeSettings(input = {}) {
    return {
      theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : defaults.theme,
      shortcut: validShortcut(input.shortcut) ? input.shortcut : defaults.shortcut,
      keepOpen: true, // Migrate v1.0's optional auto-hide to v1.1's required behavior.
      tone: Number.isInteger(input.tone) && input.tone >= 0 && input.tone <= 5 ? input.tone : 0,
      launchAtLogin: input.launchAtLogin === true
    };
  }
  function unsafeShortcut(value) { return new Set(['Control+C','Control+V','Control+X','Control+Z','Alt+F4']).has(value); }
  function validShortcut(value) {
    return typeof value === 'string' && value.length < 60 && !unsafeShortcut(value) && /^(?:(?:Control|Alt|Shift)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(value) && /(?:Control|Alt)\+/.test(value) && new Set(value.split('+')).size === value.split('+').length;
  }
  function position(cursor, workArea, desired = { width: 432, height: 552 }) {
    const width = Math.min(desired.width, workArea.width);
    const height = Math.min(desired.height, workArea.height);
    return {
      x: Math.round(Math.max(workArea.x, Math.min(cursor.x + 12, workArea.x + workArea.width - width))),
      y: Math.round(Math.max(workArea.y, Math.min(cursor.y + 16, workArea.y + workArea.height - height))), width, height
    };
  }
  return { defaults, normalize, createIndex, search, preferred, recentAfterCopy, sanitizeSettings, unsafeShortcut, validShortcut, position };
});
