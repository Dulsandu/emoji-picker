const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const data=require('../data/emojis.json').emojis,model=require('../src/model.js');
const context={window:{}};vm.runInNewContext(fs.readFileSync('data/artwork.js','utf8'),context);const artwork=context.window.emojiArtwork;
test('all emoji sequences have bundled artwork, including every country flag',()=>{
 const all=data.flatMap(x=>[x,...(x.variants||[])]);assert.equal(all.length,3979);
 for(const item of all){assert.match(artwork[item.id],/^[0-9a-f-]+$/);assert.ok(fs.existsSync('assets/emoji/'+artwork[item.id]+'.webp'),item.id);}
 const flags=data.filter(x=>x.countryCode);assert.ok(flags.length>=258);
 for(const flag of flags){assert.equal(Array.from(flag.emoji).length,2);assert.equal(model.search(model.createIndex(data),flag.countryCode)[0].id,flag.id);}
});
test('country names and common aliases find their exact Unicode flag',()=>{
 const index=model.createIndex(data);
 for(const [query,code] of [['Sri Lanka','LK'],['LKA','LK'],['USA','US'],['United States','US'],['UK','GB'],['United Kingdom','GB'],['India','IN'],['Japan','JP'],['Australia','AU'],['Canada','CA'],['Germany','DE'],['France','FR'],['Brazil','BR'],['China','CN'],['South Africa','ZA'],['New Zealand','NZ'],['Ivory Coast','CI']])assert.equal(model.search(index,query)[0].countryCode,code,query);
});
