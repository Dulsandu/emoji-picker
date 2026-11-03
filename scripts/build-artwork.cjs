'use strict';
// Build-time only. No downloads or emoji parser run in the shipped application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const version='17.0.3',source=path.resolve('.build-cache','twemoji-'+version),out=path.resolve('assets','emoji');
const entries=require('../data/emojis.json').emojis.flatMap(x=>[x,...(x.variants||[])]);
(async()=>{
 if(!fs.existsSync(source)){
  const manifest=JSON.parse(fs.readFileSync('data/artwork-manifest.json'));
  if(manifest.version!==version)throw Error('Wrong artwork version');
  for(const file of Object.keys(manifest.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')!==manifest.files[file])throw Error('Artwork hash mismatch: '+file);
  console.log('Verified bundled offline artwork: '+Object.keys(manifest.files).length+' files');return;
 }
 fs.mkdirSync(out,{recursive:true});const mapping={},missing=[],files={},jobs=new Map();
 for(const item of entries){
  const full=Array.from(item.emoji,c=>c.codePointAt(0).toString(16)).join('-');
  const candidates=[full,item.id.toLowerCase(),full.replace(/-fe0f/g,'')];
  const key=candidates.find(k=>fs.existsSync(path.join(source,'assets','svg',k+'.svg')));
  if(!key){missing.push({id:item.id,name:item.name});continue;}
  mapping[item.id]=key; jobs.set(key,path.join(source,'assets','svg',key+'.svg'));
 }
 const work=[...jobs];let index=0;
 await Promise.all(Array.from({length:4},async()=>{while(index<work.length){const [key,file]=work[index++];const buffer=await sharp(file).resize(64,64).webp({lossless:true,effort:4}).toBuffer();fs.writeFileSync(path.join(out,key+'.webp'),buffer);files[key+'.webp']=crypto.createHash('sha256').update(buffer).digest('hex');}}));
 fs.copyFileSync(path.join(source,'LICENSE-GRAPHICS'),'licenses/Twemoji-CC-BY-4.0.txt');
 const manifest={set:'Twemoji',version,source:'https://github.com/jdecked/twemoji/tree/v'+version,archiveSha256:'d8a269885d95c78123cc0981c8c76a4c55466cdcb6c7c939434323533e6cd754',license:'CC-BY-4.0',format:'64x64 lossless WebP rasterized from upstream SVG',mapped: Object.keys(mapping).length,total:entries.length,missing,files};
 fs.writeFileSync('data/artwork-manifest.json',JSON.stringify(manifest,null,2));
 fs.writeFileSync('data/artwork.js','window.emojiArtwork = '+JSON.stringify(mapping)+';\n');
 console.log(JSON.stringify({mapped:manifest.mapped,total:manifest.total,missing,files:jobs.size,bytes:[...jobs.keys()].reduce((n,k)=>n+fs.statSync(path.join(out,k+'.webp')).size,0)},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
