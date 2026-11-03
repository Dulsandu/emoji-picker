// Verify the final packaged payload and record distributable hashes without launching it.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),output=path.join(root,'dist','v1.2-p1'),archive=path.join(output,'win-unpacked','resources','app.asar');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const read=(...parts)=>asar.extractFile(archive,path.join(...parts));
const pkg=JSON.parse(read('package.json')),art=JSON.parse(read('data','artwork-manifest.json'));
assert.equal(pkg.version,'1.2.0-p1');assert.equal(art.mapped,3979);assert.equal(art.missing.length,0);
for(const [file,hash] of Object.entries(art.files))assert.equal(digest(read('assets','emoji',file)),hash,file);
for(const file of ['main.js','preload.js','src/renderer.js','src/windowed-grid.js','src/model.js','src/styles.css','src/index.html','data/emojis.json','data/emoji-data.js','data/artwork.js','licenses/THIRD-PARTY.md','licenses/Twemoji-CC-BY-4.0.txt'])assert.equal(digest(read(...file.split('/'))),digest(fs.readFileSync(path.join(root,file))),file);
assert(!asar.listPackage(archive).some(p=>/^[/\\](tests|scripts|evidence)[/\\]/.test(p)));
const artifacts=['Emoji Picker P1 Setup 1.2.0-p1.exe','Emoji Picker P1 1.2.0-p1 Portable.exe'].map(file=>({file,bytes:fs.statSync(path.join(output,file)).size,sha256:digest(fs.readFileSync(path.join(output,file)))}));
const countryFlags=JSON.parse(read('data','emojis.json')).emojis.filter(e=>e.countryCode).length;assert.equal(countryFlags,259);
const report={version:pkg.version,verifiedAt:new Date().toISOString(),artworkFilesVerified:Object.keys(art.files).length,countryFlags,archiveSha256:digest(fs.readFileSync(archive)),artifacts};
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),artifacts.map(a=>a.sha256+'  '+a.file).join('\n')+'\n');
console.log(JSON.stringify(report,null,2));

