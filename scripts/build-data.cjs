const fs = require('node:fs');
const path = require('node:path');
const source = require('emojibase-data/en/data.json');
const aliases = require('emojibase-data/en/shortcodes/emojibase.json');
const github = require('emojibase-data/en/shortcodes/github.json');
const messages = require('emojibase-data/en/messages.json');
const groups = new Map(messages.groups.map(g => [g.order,g.message]));
const extra = {
  '1F602':['laugh','laughing','lol','lmao','haha'], '1F923':['laugh','laughing','lol','lmao','haha'],
  '1F60A':['happy','smile'], '1F604':['happy','smile','laughing'], '2764':['love','heart'],
  '1F64F':['pray','please','thanks'], '2615':['coffee'], '1F44D':['thumb','approve'], '2705':['check','yes'], '274C':['cross','no']
};
function convert(item,parent) {
  const group = item.group ?? parent?.group ?? 2;
  const regional = item.hexcode.split('-');
  const countryCode = regional.length===2 && regional.every(x=>parseInt(x,16)>=0x1f1e6 && parseInt(x,16)<=0x1f1ff)
    ? regional.map(x=>String.fromCharCode(parseInt(x,16)-0x1f1e6+65)).join('') : null;
  const countryAliases = {US:['USA','United States of America','America'],GB:['UK','GBR','Britain','Great Britain'],LK:['LKA','Ceylon'],AE:['UAE'],KR:['South Korea'],KP:['North Korea'],CZ:['Czech Republic'],TR:['Turkey'],CI:['Ivory Coast']};
  return {
    id:item.hexcode, emoji:item.emoji, name:item.label || item.annotation,
    group, order:item.order ?? 99999, version:item.version,
    keywords:[...new Set([...(item.tags || parent?.tags || []),...[aliases[item.hexcode] || []].flat(),...[github[item.hexcode] || []].flat(),...(extra[item.hexcode] || []),...(countryCode?[countryCode,...(countryAliases[countryCode]||[])]:[]),groups.get(group)])].filter(Boolean),
    ...(countryCode ? {countryCode} : {}),
    ...(item.tone ? {tones:[item.tone].flat()} : {}),
    ...(item.skins?.length ? {variants:item.skins.map(skin=>convert(skin,item))} : {})
  };
}
const emojis = source.map(item=>convert(item)).sort((a,b)=>a.order-b.order);
const total = emojis.reduce((count,item)=>count+1+(item.variants?.length || 0),0);
const data = {version:'17.0',source:'emojibase-data@17.0.0',total,emojis};
fs.mkdirSync('data',{recursive:true});
const json = JSON.stringify(data);
fs.writeFileSync('data/emojis.json',json);
fs.writeFileSync('data/emoji-data.js',`window.emojiData = ${json};\n`);
fs.mkdirSync('licenses',{recursive:true});
fs.copyFileSync(path.join(path.dirname(require.resolve('emojibase-data/package.json')),'LICENSE'),'licenses/Emojibase-MIT.txt');
console.log(`Bundled Emoji ${data.version}: ${emojis.length} base entries, ${total} total with variants; ${Buffer.byteLength(json)} bytes.`);
