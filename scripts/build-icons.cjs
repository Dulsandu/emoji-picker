const fs = require('node:fs/promises');
const sharp = require('sharp');
(async () => {
  const source = await fs.readFile('assets/icon.svg');
  const sizes = [16,24,32,48,64,128,256];
  const pngs = await Promise.all(sizes.map(size => sharp(source).resize(size,size).png().toBuffer()));
  const header = Buffer.alloc(6 + 16*sizes.length);
  header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
  let offset = header.length;
  sizes.forEach((size,i) => {
    const p = 6 + i*16;
    header[p] = header[p+1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1,p+4); header.writeUInt16LE(32,p+6);
    header.writeUInt32LE(pngs[i].length,p+8); header.writeUInt32LE(offset,p+12);
    offset += pngs[i].length;
  });
  await fs.writeFile('assets/icon.ico',Buffer.concat([header,...pngs]));
  await fs.writeFile('assets/icon.png',pngs.at(-1));
  await fs.writeFile('assets/tray.png',pngs[2]);
  console.log('Created original PNG and multi-resolution Windows ICO assets.');
})().catch(error=>{console.error(error);process.exitCode=1;});
