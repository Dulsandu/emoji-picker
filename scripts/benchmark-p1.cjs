'use strict';
const { _electron:electron,expect }=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),root=path.resolve(__dirname,'..');
const executable=process.argv[2],label=process.argv[3]||'p1';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const profile=await fs.mkdtemp(path.join(root,'.test-profile-benchmark-'));
 const env={...process.env,EMOJI_PICKER_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const product=label==='baseline'?'Emoji Picker':'Emoji Picker P1';
 const pref=path.join(process.env.APPDATA,product,'preferences.json');let saved;
 if(executable)try{saved=await fs.readFile(pref);}catch(e){if(e.code!=='ENOENT')throw e;}
 const start=performance.now();
 const app=await electron.launch(executable?{executablePath:path.resolve(executable),env}:{args:[root],env});
 const report={label,executable:executable||'development',categories:[],searchMs:[],warmShowMs:[],scroll:[],cycles:[]};
 try {
  const page=await app.firstWindow();await page.locator('#emoji-grid .emoji').first().waitFor();report.launchToGridMs=performance.now()-start;
  const pid=await app.evaluate(()=>process.pid);
  async function sample(){return JSON.parse((await execute('powershell.exe',['-NoProfile','-File',path.join(__dirname,'measure-processes.ps1'),'-RootProcessId',String(pid)],{windowsHide:true})).stdout);}
  const cdp=await page.context().newCDPSession(page);
  for(const group of ['Smileys & emotion','People & body','Flags','Objects']) {
   await page.getByRole('button',{name:group,exact:true}).click();
   report.categories.push({group,...await page.evaluate(()=>({cells:document.querySelectorAll('#emoji-grid .emoji').length,liveElements:document.querySelectorAll('*').length,results:document.querySelector('#result-count').textContent})),...await cdp.send('Memory.getDOMCounters')});
  }
  for(const query of ['heart','Sri Lanka','woman technologist','laugh','thumb','']) {
   const elapsed=await page.evaluate(async q=>{const t=performance.now(),e=document.querySelector('#search');e.value=q;e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;},query);report.searchMs.push({query,elapsed});
  }
  await page.getByRole('button',{name:'People & body',exact:true}).click();
  report.scroll=await page.evaluate(async()=>{
   const el=document.querySelector('#emoji-scroll'),samples=[];let prev=performance.now();
   for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-prev);prev=now;el.scrollTop=(i%90)/89*(el.scrollHeight-el.clientHeight);}
   samples.sort((a,b)=>a-b);return {frames:samples.length,p50Ms:samples[90],p95Ms:samples[171],over25ms:samples.filter(x=>x>25).length,method:'180 requestAnimationFrame scroll steps; not a display FPS guarantee'};
  });
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  report.backHitTest=await page.locator('#back-button').evaluate(b=>{const r=b.getBoundingClientRect(),header=document.querySelector('.titlebar');return {bounds:{x:r.x,y:r.y,width:r.width,height:r.height},appRegion:getComputedStyle(b).getPropertyValue('app-region'),underlyingTitlebar:getComputedStyle(header).getPropertyValue('app-region'),overlapsTitlebar:r.top<header.getBoundingClientRect().bottom};});
  await page.getByRole('button',{name:'Back to emojis'}).click();await expect(page.locator('#settings-dialog')).not.toBeVisible();
  for(let cycle=0;cycle<4;cycle++) {
   for(const group of ['Flags','People & body','Smileys & emotion']){await page.getByRole('button',{name:group,exact:true}).click();await page.locator('#emoji-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);}
   await page.locator('#search').fill('heart');await page.locator('#search').fill('');
   await page.locator('#hide-button').click();await delay(500);
   const t=performance.now();await app.evaluate(({app})=>app.emit('second-instance'));await expect(page.locator('#search')).toBeVisible();report.warmShowMs.push(performance.now()-t);
   report.cycles.push(await sample());
  }
  await page.locator('#hide-button').click();console.log(label+': hidden idle settling for 35 seconds');await delay(35000);
  const before=await sample();await delay(5000);const after=await sample();
  report.idle={workingSetMiB:after.processes.reduce((a,p)=>a+p.workingSetBytes,0)/1048576,privateCommittedMiB:after.processes.reduce((a,p)=>a+p.privateBytes,0)/1048576,cpuPercentMachine:100*(after.processes.reduce((a,p)=>a+p.cpuSeconds,0)-before.processes.reduce((a,p)=>a+p.cpuSeconds,0))/((after.time-before.time)/1000)/after.cores,snapshot:after};
  report.passed=true;console.log(JSON.stringify(report,null,2));
 }finally{await app.close();if(executable){if(saved)await fs.writeFile(pref,saved);else await fs.rm(pref,{force:true});}await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/benchmark-'+label+'.json',JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
