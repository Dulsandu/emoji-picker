$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$destination=[IO.Path]::GetFullPath((Join-Path $workspace 'backups\v1.2 P1 - Complete'))
if(-not $destination.StartsWith($workspace+'\')){throw 'Checkpoint must be inside the workspace'}
if(Test-Path -LiteralPath $destination){throw 'Complete checkpoint already exists; do not overwrite it'}
$sourceItems=@('main.js','preload.js','package.json','package-lock.json','playwright.config.cjs','.gitignore','README.md','CHANGELOG.md','LICENSE','POST-RESTART-INTEGRITY.md','TEST-REPORT-v1.1.md','V1.2-P1-REPORT.md','src','native','scripts','tests','assets','data','licenses')
foreach($item in $sourceItems){
 $source=Join-Path $workspace $item
 if(-not (Test-Path -LiteralPath $source)){throw ('Missing source: '+$source)}
 if((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('Unexpected reparse point: '+$source)}
 if(Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}){throw ('Nested reparse point: '+$source)}
}
New-Item -ItemType Directory -Path (Join-Path $destination 'source'),(Join-Path $destination 'release'),(Join-Path $destination 'evidence') | Out-Null
foreach($item in $sourceItems){Copy-Item -LiteralPath (Join-Path $workspace $item) -Destination (Join-Path $destination 'source') -Recurse}
Get-ChildItem -LiteralPath (Join-Path $workspace 'dist\v1.2-p1') -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination 'release')}
Copy-Item -LiteralPath (Join-Path $workspace 'evidence\v1.2-p1') -Destination (Join-Path $destination 'evidence') -Recurse
$manifest=@(Get-ChildItem -LiteralPath $destination -File -Recurse | Sort-Object FullName | ForEach-Object {[ordered]@{path=$_.FullName.Substring($destination.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json')
foreach($entry in $manifest){if((Get-FileHash -LiteralPath (Join-Path $destination $entry.path) -Algorithm SHA256).Hash -ne $entry.sha256){throw ('Checkpoint verification failed: '+$entry.path)}}
[ordered]@{checkpoint=$destination;filesVerified=$manifest.Count;bytes=($manifest | Measure-Object bytes -Sum).Sum;status='complete'} | ConvertTo-Json
