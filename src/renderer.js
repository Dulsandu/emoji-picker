'use strict';
const $ = id => document.getElementById(id);
const paths = {
  search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close:'M6 6l12 12 M18 6L6 18', check:'M5 12l4 4L19 6', back:'M14 5l-7 7 7 7',
  clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  smile:'M8 14s1 3 4 3 4-3 4-3 M8 9h.01 M16 9h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  people:'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 22v-3a8 8 0 0 1 16 0v3',
  nature:'M12 21v-6 M12 16C4 17 2 12 3 5c7 0 10 4 9 11 M12 12c0-6 4-9 9-9 0 6-3 10-9 9',
  food:'M4 2v7a3 3 0 0 0 6 0V2 M7 2v20 M19 22V2c-5 3-5 10 0 10',
  travel:'M3 16l4-8h10l4 8v5h-3v-3H6v3H3v-5Z M4 14h16 M7 16h.01 M17 16h.01',
  activity:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M9 9l6 0 2 5-5 4-5-4 2-5 M9 9L6 4 M15 9l3-5 M17 14l5 1 M7 14l-5 1 M12 18v4',
  objects:'M9 18v3h6v-3 M8 15a7 7 0 1 1 8 0l-1 3H9l-1-3',
  symbols:'M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z',
  flag:'M5 22V3c5-5 9 5 15 0v11c-6 5-10-5-15 0',
  components:'M12 2L2 7l10 5 10-5-10-5Z M2 12l10 5 10-5 M2 17l10 5 10-5',
  settings:'M9 3l1-2h4l1 2 3 2 2 0 2 4-1 2v3l1 2-2 4h-3l-2 1-1 2h-4l-1-2-3-2H3l-2-4 1-2v-3L1 8l2-4h3l3-1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
};
function icon(key) { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',paths[key]); svg.append(path); return svg; }
document.querySelectorAll('[data-icon]').forEach(el => el.append(icon(el.dataset.icon)));
const categories = [ ['recent','Recently used','clock'], [0,'Smileys & emotion','smile'], [1,'People & body','people'], [3,'Animals & nature','nature'], [4,'Food & drink','food'], [6,'Activities','activity'], [5,'Travel & places','travel'], [7,'Objects','objects'], [8,'Symbols','symbols'], [9,'Flags','flag'], [2,'Components','components'] ];
const data = window.emojiData;
const items = data.emojis;
const byId = new Map(items.flatMap(item => [item, ...(item.variants || [])]).map(item => [item.id,item]));
const baseById = new Map(items.flatMap(item => [item, ...(item.variants || [])].map(v => [v.id,item])));
const searchIndex = EmojiModel.createIndex(items);
const variantIndex = EmojiModel.createIndex(items.flatMap(item => item.variants || []));
const grouped = new Map(categories.filter(c=>typeof c[0]==='number').map(c=>[c[0],items.filter(item=>item.group===c[0])]));
const grid = new WindowedGrid($('emoji-scroll'),$('emoji-grid'),emojiButton);
let state, category = 'recent', displayed = [], toastTimer, lastVariantTrigger, pendingShortcut;
const toneNames = ['Default','Light','Medium-light','Medium','Medium-dark','Dark'];
const toneEmoji = ['✋','✋🏻','✋🏼','✋🏽','✋🏾','✋🏿'];
function displayShortcut(value) { return value.replace('Control','Ctrl').replaceAll('+',' + '); }
function applyTheme() { document.documentElement.dataset.theme = state.settings.theme === 'system' ? (state.dark ? 'dark':'light') : state.settings.theme; }
function notify(message, duration = 800) { clearTimeout(toastTimer); $('toast-text').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true,duration); }
function warn(message) { $('banner').textContent = message; $('banner').hidden = !message; }
function artwork(host,item){
  host.replaceChildren();const key=window.emojiArtwork?.[item.id];
  if(!key){host.textContent=item.emoji;return;}
  const img=document.createElement('img');img.className='emoji-art';img.width=32;img.height=32;img.alt='';img.draggable=false;img.decoding='async';img.dataset.fallback=item.emoji;img.src=`../assets/emoji/${key}.webp`;host.append(img);
}
document.addEventListener('error',event=>{if(event.target.classList?.contains('emoji-art')){const fallback=document.createElement('span');fallback.className='emoji-fallback';fallback.textContent=event.target.dataset.fallback;fallback.setAttribute('aria-hidden','true');event.target.parentElement.replaceChildren(fallback);}},true);
function emojiButton(item, index, variants = false) {
  const button = document.createElement('button');
  button.className = 'emoji'; artwork(button,item); button.dataset.id = item.id;
  button.setAttribute('aria-label',item.name); button.title = item.name; button.tabIndex = index === 0 ? 0 : -1;
  const base = baseById.get(item.id);
  if (!variants && base?.variants?.length) { button.classList.add('has-variants'); button.setAttribute('aria-haspopup','dialog'); button.title += ' · Right-click for variants'; }
  return button;
}
function render(reset = true) {
  if (!state) return;
  const query = $('search').value.trim();
  $('clear-search').hidden = !query; $('search-hint').hidden = !!query;
  $('welcome').hidden = true;
  if (query) {
    displayed = EmojiModel.search(searchIndex,query);
    if (/skin|tone/i.test(query) || /[\u{1f3fb}-\u{1f3ff}]/u.test(query)) displayed = [...displayed,...EmojiModel.search(variantIndex,query)];
    $('section-title').textContent = 'Search results';
  } else if (category === 'recent') {
    displayed = state.recent.map(id => byId.get(id)).filter(Boolean);
    $('section-title').textContent = 'Recently used';
    if (!displayed.length) { $('welcome').hidden = false; displayed = grouped.get(0).slice(0,56); }
  } else {
    displayed = grouped.get(category);
    $('section-title').textContent = categories.find(c => c[0] === category)[1];
  }
  if (category !== 'recent' || query || !state.recent.length) displayed = displayed.map(item => EmojiModel.preferred(item,state.settings.tone));
  $('result-count').textContent = !query && category === 'recent' && !state.recent.length ? '' : displayed.length;
  $('empty').hidden = displayed.length !== 0;
  grid.set(displayed,reset);
  document.querySelectorAll('.category').forEach(button => button.setAttribute('aria-current',String(!query && button.dataset.category === String(category))));
  $('hover-name').textContent = 'Click an emoji to insert';
}
async function copy(id) {
  // Close/focus the variant UI before the native paste returns focus externally.
  if ($('variants-dialog').open) closeVariants();
  try {
    const result = await window.picker.copy(id);
    if (!result.ok) { notify(result.error,2200); return; }
    state.recent = result.recent;
    notify(result.warning || (result.pasted ? 'Paste sent' : 'Copied — automatic paste was blocked'), result.warning || !result.pasted ? 2400 : 800);
    // Keep the current cells stable during rapid selections; refresh recents on next visit.
  } catch { notify('Could not copy. Please try again.',2200); }
}
function openVariants(button) {
  const base = baseById.get(button.dataset.id);
  if (!base?.variants?.length) return;
  lastVariantTrigger = button;
  $('variants-title').textContent = base.name;
  $('variants-grid').replaceChildren(...[base,...base.variants].map((item,i) => emojiButton(item,i,true)));
  $('variants-dialog').showModal();
  $('variants-grid').firstElementChild?.focus();
}
function closeVariants() { $('variants-dialog').close(); lastVariantTrigger?.focus(); }
function focusCell(index) {
  grid.focus(index);
}
function openSettings() { if (!state) return; syncSettings(); if (!$('settings-dialog').open) $('settings-dialog').showModal(); }
function closeSettings(){ $('settings-dialog').close(); $('search').focus({preventScroll:true}); }
function syncSettings() {
  $('theme').value = state.settings.theme;
  $('startup').checked = state.settings.launchAtLogin; $('startup').disabled = !state.startupSupported;
  if (!state.startupSupported) $('startup-help').textContent = 'Available in the installed version';
  pendingShortcut = state.settings.shortcut;
  $('shortcut-input').value = displayShortcut(pendingShortcut);
  $('shortcut-label').textContent = displayShortcut(state.settings.shortcut);
  artwork($('tone-button'),{id:['270B','270B-1F3FB','270B-1F3FC','270B-1F3FD','270B-1F3FE','270B-1F3FF'][state.settings.tone],emoji:toneEmoji[state.settings.tone]});
  $('tone-button').title = `${toneNames[state.settings.tone]} skin tone`;
  $('tone-options').querySelectorAll('button').forEach((button,i) => button.setAttribute('aria-pressed',String(i === state.settings.tone)));
  $('version').textContent = state.version==='1.2.0-p2'?'v1.2 P2':state.version;
  $('data-version').textContent = `Emoji ${data.version}`;
}
async function update(patch) {
  $('settings-status').textContent = 'Saving…';
  $('settings-status').classList.remove('error');
  try {
    const result = await window.picker.updateSettings(patch);
    $('settings-status').textContent = result.ok ? 'Saved' : result.error;
    $('settings-status').classList.toggle('error',!result.ok);
    if (result.ok) { const toneChanged=state.settings.tone!==result.settings.tone;state = result; applyTheme(); syncSettings(); if(toneChanged)render(false); warn(''); }
    else { syncSettings(); }
  } catch { $('settings-status').textContent = 'Could not save preferences. Please try again.'; }
}
for (const [id,label,glyph] of categories) {
  const button = document.createElement('button'); button.className = 'category'; button.dataset.category = id; button.title = label; button.setAttribute('aria-label',label); button.append(icon(glyph));
  button.addEventListener('click',() => { category = id; $('search').value = ''; render(); });
  $('categories').append(button);
}
toneNames.forEach((name,i) => { const button = document.createElement('button'); artwork(button,{id:['270B','270B-1F3FB','270B-1F3FC','270B-1F3FD','270B-1F3FE','270B-1F3FF'][i],emoji:toneEmoji[i]}); button.title = name; button.setAttribute('aria-label',`${name} skin tone`); button.addEventListener('click',() => update({tone:i})); $('tone-options').append(button); });
$('emoji-grid').addEventListener('click',event => { const button = event.target.closest('.emoji'); if (button) copy(button.dataset.id); });
$('emoji-grid').addEventListener('contextmenu',event => { event.preventDefault(); const button = event.target.closest('.emoji'); if (button) openVariants(button); });
$('emoji-grid').addEventListener('keydown',event => {
  const button = event.target.closest('.emoji'); if (!button) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openVariants(button); return; }
  const index = Number(button.dataset.index);
  const cols = grid.columns;
  const offsets = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols,Home:-index,End:displayed.length};
  if (Object.hasOwn(offsets,event.key)) { event.preventDefault(); focusCell(index + offsets[event.key]); }
});
for (const eventName of ['mouseover','focusin']) $('emoji-grid').addEventListener(eventName,event => { const button = event.target.closest('.emoji'); if (button) { const name=byId.get(button.dataset.id).name;if($('hover-name').textContent!==name)$('hover-name').textContent=name;if(eventName==='focusin')grid.active=Number(button.dataset.index); } });
$('variants-grid').addEventListener('click',event => { const button = event.target.closest('.emoji'); if (button) copy(button.dataset.id); });
$('variants-grid').addEventListener('keydown',event => {
  const buttons = Array.from($('variants-grid').children), index = buttons.indexOf(document.activeElement);
  const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-6,ArrowDown:6}[event.key];
  if (delta !== undefined) { event.preventDefault(); const target = buttons[Math.max(0,Math.min(index+delta,buttons.length-1))]; buttons.forEach(b => b.tabIndex = b === target ? 0:-1); target?.focus(); }
});
$('search').addEventListener('input',()=>render());
$('search').addEventListener('keydown',event => { if (event.key === 'ArrowDown') { event.preventDefault(); focusCell(0); } else if (event.key === 'Enter' && displayed.length) { event.preventDefault(); copy(displayed[0].id); } });
$('clear-search').addEventListener('click',() => { $('search').value = ''; render(); $('search').focus(); });
$('hide-button').addEventListener('click',() => window.picker.hide());
$('settings-button').addEventListener('click',openSettings);
$('tone-button').addEventListener('click',() => { openSettings(); $('tone-options').querySelector(`[aria-pressed="true"]`)?.focus(); });
$('back-button').addEventListener('click',closeSettings);
$('close-variants').addEventListener('click',closeVariants);
$('theme').addEventListener('change',event => update({theme:event.target.value}));
$('startup').addEventListener('change',event => update({launchAtLogin:event.target.checked}));
$('shortcut-input').addEventListener('keydown',event => {
  if (['Tab','Escape'].includes(event.key)) return;
  event.preventDefault();
  if (!/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(event.code) || event.metaKey || (!event.ctrlKey && !event.altKey)) return;
  pendingShortcut = [event.ctrlKey?'Control':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,event.code.replace(/^Key|^Digit/,'')].filter(Boolean).join('+');
  $('shortcut-input').value = displayShortcut(pendingShortcut);
});
$('shortcut-save').addEventListener('click',() => update({shortcut:pendingShortcut}));
$('banner').addEventListener('click',() => { warn(''); openSettings(); });
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') { event.preventDefault(); $('variants-dialog').close(); closeSettings(); }
  if (event.ctrlKey && event.key.toLowerCase() === 'f' && !$('settings-dialog').open) { event.preventDefault(); $('search').focus(); $('search').select(); }
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel',event => { event.preventDefault(); dialog.close(); });
window.picker.onTheme(dark => { if (state) { state.dark = dark; applyTheme(); } });
document.addEventListener('visibilitychange',()=>{if(document.hidden){grid.suspend();clearTimeout(toastTimer);$('toast').hidden=true;}else grid.resume();});
window.picker.onShow(({settings}) => {
  if (!state) return;
  $('variants-dialog').close();
  if (settings) openSettings();
  else { $('settings-dialog').close(); category = 'recent'; $('search').value = ''; render(); $('search').focus(); }
});
window.picker.bootstrap().then(value => {
  state = value; applyTheme(); syncSettings(); render(); $('search').focus();
  warn(state.shortcutError || state.warning);
}).catch(() => warn('Emoji Picker could not start. Quit from the tray and reopen it.'));
