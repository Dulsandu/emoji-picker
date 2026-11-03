const {WindowsBridge}=require('../../src/windows-bridge.cjs');
const path=require('node:path');
const bridge=new WindowsBridge(path.resolve('native/bin/WindowsBridge.exe'));
bridge.start().then(ready=>{if(!ready)process.exit(1);process.stdout.write(String(bridge.child.pid)+'\n');});
