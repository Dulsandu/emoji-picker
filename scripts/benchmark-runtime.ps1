param([Parameter(Mandatory=$true)][int]$RootProcessId,[string]$Label='p2-normal',[int]$IdleSeconds=40,[ValidateSet('v1.2-p1','v1.2-p2')][string]$Release='v1.2-p2')
$ErrorActionPreference='Stop'
if($IdleSeconds -lt 30 -or $IdleSeconds -gt 60){throw 'Use a 30–60 second hidden settling interval'}
$workspace=Split-Path -Parent $PSScriptRoot
$otherPickers=Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Emoji Picker.exe','Emoji Picker P1.exe','Emoji Picker P2.exe') -and $_.ProcessId -ne $RootProcessId -and $_.CommandLine -notmatch '--type=' }
if($otherPickers){throw 'Another main Emoji Picker process is running; stop it before measuring'}
$root=Get-Process -Id $RootProcessId
if($root.MainWindowHandle -ne 0){throw 'Hide the picker before starting the idle benchmark'}
Write-Output "Normal packaged runtime ${RootProcessId}: hidden settling for $IdleSeconds seconds"
Start-Sleep -Seconds $IdleSeconds
$samples=@()
for($i=0;$i -lt 3;$i++){
 if((Get-Process -Id $RootProcessId).MainWindowHandle -ne 0){throw 'Picker became visible during idle measurement'}
 $sample=& (Join-Path $PSScriptRoot 'measure-processes.ps1') -RootProcessId $RootProcessId -NormalRuntimeOnly | ConvertFrom-Json
 $samples+=,$sample
 if($i -lt 2){Start-Sleep -Seconds 5}
}
$cpu=@();for($i=1;$i -lt $samples.Count;$i++){
 $before=$samples[$i-1];$after=$samples[$i]
 $previousIds=@($before.processes.pid | Sort-Object);$currentIds=@($after.processes.pid | Sort-Object)
 if(Compare-Object $previousIds $currentIds){throw 'Process tree changed during CPU measurement'}
 $cpu+=100*(($after.processes | Measure-Object cpuSeconds -Sum).Sum-($before.processes | Measure-Object cpuSeconds -Sum).Sum)/(($after.time-$before.time)/1000)/$after.cores
}
$summary=@($samples | ForEach-Object { [ordered]@{time=$_.time;workingSetMiB=($_.processes | Measure-Object workingSetBytes -Sum).Sum/1MB;privateWorkingSetMiB=($_.processes | Measure-Object privateWorkingSetBytes -Sum).Sum/1MB;privateCommittedMiB=($_.processes | Measure-Object privateBytes -Sum).Sum/1MB;processCount=$_.processes.Count} })
$report=[ordered]@{label=$Label;method='Normal packaged app, no inspector or remote debugging; verified executable paths, parent PIDs and creation times; external sampler/harness/build/installer/unrelated apps excluded';settledSeconds=$IdleSeconds;cpuPercentMachine=$cpu;memory=$summary;samples=$samples;os=(Get-CimInstance Win32_OperatingSystem).Caption}
$evidenceDirectory=Join-Path $workspace ('evidence\'+$Release)
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$destination=Join-Path $evidenceDirectory ('runtime-'+$Label+'.json')
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination
[ordered]@{report=$destination;cpuPercentMachine=$cpu;memory=$summary} | ConvertTo-Json -Depth 5
