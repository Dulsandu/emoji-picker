const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const data = require('../data/emojis.json');
const source = require('emojibase-data/en/data.json');
const model = require('../src/model.js');
const { Store } = require('../src/store.cjs');
const flat = data.emojis.flatMap(item => [item,...(item.variants || [])]);
const ids = new Set(flat.map(item=>item.id));
const index = model.createIndex(data.emojis);

test('every Emojibase entry and variant survives bundling exactly', () => {
  const originals = source.flatMap(item=>[item,...(item.skins || [])]);
  assert.equal(flat.length,originals.length);
  assert.equal(ids.size,flat.length);
  const map = new Map(flat.map(item=>[item.id,item]));
  for (const item of originals) assert.equal(map.get(item.hexcode)?.emoji,item.emoji);
  assert.ok(flat.length > 3900);
  for (let group=0;group<=9;group++) assert.ok(data.emojis.some(item=>item.group===group));
  assert.ok(flat.some(item=>item.version===17));
  for (const id of ['1F1F1-1F1F0','1F3F4-E0067-E0062-E0065-E006E-E0067-E007F','0031-FE0F-20E3','1F469-200D-1F4BB','1F468-200D-1F469-200D-1F467']) assert.ok(ids.has(id),id);
});
test('search covers requested vocabulary, aliases, case and punctuation', () => {
  const terms='heart love laugh laughing smile happy sad cry angry fire star sparkle dog cat lion food pizza coffee car plane phone camera money party flag rocket warning check cross thumb clap pray'.split(' ');
  for (const term of terms) assert.ok(model.search(index,term).length > 0,term);
  for (const id of ['1F602','1F923']) assert.ok(model.search(index,'LAUGH').some(item=>item.id===id));
  assert.ok(model.search(index,':thumbs_up:').some(item=>item.id==='1F44D'));
  assert.equal(model.search(index,'zzzznotanemoji').length,0);
  assert.equal(model.search(index,'   ').length,0);
});
test('search latency across 500 realistic queries', () => {
  const terms=['heart','laugh','dog','pizza','plane','pray','woman technologist'];
  const start=performance.now();
  for(let i=0;i<500;i++) model.search(index,terms[i%terms.length]);
  const elapsed=performance.now()-start;
  console.log(`Search: ${(elapsed/500).toFixed(3)} ms average (500 queries)`);
  assert.ok(elapsed/500 < 20);
});
test('tones retain original sequences including mixed-tone handshakes', () => {
  const hand=data.emojis.find(item=>item.id==='1F44D');
  assert.equal(model.preferred(hand,3).emoji,'👍🏽');
  assert.equal(model.preferred(hand,0),hand);
  const shake=data.emojis.find(item=>item.id==='1F91D');
  assert.equal(shake.variants.length,25);
  assert.equal(model.preferred(shake,5).emoji,'🤝🏿');
});
test('recent list deduplicates, moves newest first and caps at 56', () => {
  let recent=[];
  for(const item of flat.slice(0,75)) recent=model.recentAfterCopy(recent,item.id);
  assert.equal(recent.length,56);
  const id=recent[40];recent=model.recentAfterCopy(recent,id);
  assert.equal(recent[0],id);assert.equal(new Set(recent).size,56);
});
test('position stays within negative-coordinate monitors and small work areas', () => {
  for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1920,y:-300,width:1920,height:1080},{x:2000,y:0,width:350,height:450}]) {
    for(const cursor of [{x:area.x,y:area.y},{x:area.x+area.width-1,y:area.y+area.height-1}]) {
      const box=model.position(cursor,area);
      assert.ok(box.x>=area.x && box.y>=area.y);
      assert.ok(box.x+box.width<=area.x+area.width && box.y+box.height<=area.y+area.height);
    }
  }
});
test('shortcut validation rejects reserved and incomplete shortcuts', () => {
  for(const value of ['Control+Shift+E','Alt+F8','Control+Alt+1']) assert.ok(model.validShortcut(value));
  for(const value of ['Super+.','E','Shift+E','Control+Control+E','Control+','Control+Shift+Escape','Control+C','Control+V','Control+X','Control+Z','Alt+F4']) assert.ok(!model.validShortcut(value));
  assert.equal(model.sanitizeSettings({theme:'bad',tone:20,keepOpen:'no'}).theme,'system');
});
test('atomic persistence survives restart and recovers corrupted files', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'emoji-picker-store-'));
  try {
    const store=new Store(dir,ids);await store.load();
    store.state.settings.theme='dark';store.state.recent=['1F44D'];
    const saves=[];
    for(let i=0;i<10;i++) {store.state.settings.tone=i%6;saves.push(store.save());}
    await Promise.all(saves);
    const restored=new Store(dir,ids);await restored.load();
    assert.equal(restored.state.settings.theme,'dark');assert.equal(restored.state.settings.tone,3);assert.deepEqual(restored.state.recent,['1F44D']);
    await fs.writeFile(store.file,'{broken');
    const recovered=new Store(dir,ids);await recovered.load();assert.equal(recovered.state.settings.theme,'system');assert.ok(recovered.warning);
    assert.ok((await fs.readdir(dir)).some(name=>name.includes('recovery')));
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
