param([int]$RootProcessId,[switch]$NormalRuntimeOnly)
$ErrorActionPreference='Stop'
$all=Get-CimInstance Win32_Process
$byId=@{};foreach($process in $all){$byId[[int]$process.ProcessId]=$process}
$root=$byId[$RootProcessId]
if(-not $root){throw 'Packaged application root no longer exists'}
if($NormalRuntimeOnly -and ($root.Name -notin @('Emoji Picker.exe','Emoji Picker P1.exe','Emoji Picker P2.exe') -or $root.CommandLine -match '--inspect|--remote-debugging|--type=')){throw 'Normal packaged main process required; no debugger/test launch'}
$appDirectory=Split-Path -Parent $root.ExecutablePath
$helperPath=Join-Path $appDirectory 'resources\native\WindowsBridge.exe'
$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add($RootProcessId)
do {
 $added=$false
 foreach($process in $all){
  $parent=$byId[[int]$process.ParentProcessId]
  $ownedBinary=$process.ExecutablePath -eq $root.ExecutablePath -or $process.ExecutablePath -eq $helperPath -or $process.ExecutablePath -eq (Join-Path $env:SystemRoot 'System32\conhost.exe')
  if($ownedBinary -and $parent -and $process.CreationDate -ge $parent.CreationDate -and $ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)){$added=$true}
 }
}while($added)
$counters=@{};foreach($counter in Get-CimInstance Win32_PerfRawData_PerfProc_Process){$counters[[int]$counter.IDProcess]=$counter}
$rows=foreach($id in $ids){
 $p=Get-Process -Id $id -ErrorAction SilentlyContinue
 if($p){$meta=$byId[$id];$counter=$counters[$id];[ordered]@{pid=$id;parentPid=$meta.ParentProcessId;name=$p.ProcessName;path=$meta.ExecutablePath;created=$meta.CreationDate.ToString('o');workingSetBytes=$p.WorkingSet64;privateWorkingSetBytes=if($counter){[long]$counter.WorkingSetPrivate}else{$null};privateBytes=$p.PrivateMemorySize64;cpuSeconds=$p.TotalProcessorTime.TotalSeconds}}
}
[ordered]@{time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();cores=[Environment]::ProcessorCount;rootPid=$RootProcessId;normalRuntimeOnly=[bool]$NormalRuntimeOnly;processes=@($rows)} | ConvertTo-Json -Depth 4 -Compress
