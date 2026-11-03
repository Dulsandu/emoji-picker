$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$installTestPath = [IO.Path]::GetFullPath((Join-Path $workspacePath '.installer-test-p2'))
if (-not $installTestPath.StartsWith($workspacePath + '\')) { throw 'Invalid installer test directory' }
if (Test-Path -LiteralPath $installTestPath) { throw 'Installer test directory already exists; inspect it before reusing it.' }
$existingInstall = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object DisplayName -eq 'Emoji Picker P2'
if ($existingInstall) { throw 'An Emoji Picker installation already exists; leave it untouched.' }
$installerPath = Join-Path $workspacePath 'dist\v1.2-p2\public\Emoji Picker P2 Setup 1.2.0-p2.exe'
$installedExe = Join-Path $installTestPath 'Emoji Picker P2.exe'
$uninstallerPath = Join-Path $installTestPath 'Uninstall Emoji Picker P2.exe'
$preferencesPath = Join-Path $env:APPDATA 'Emoji Picker P2\preferences.json'
$hadPreferences = Test-Path -LiteralPath $preferencesPath
$preferencesBackup = if ($hadPreferences) { [IO.File]::ReadAllBytes($preferencesPath) } else { $null }
$startMenuLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Emoji Picker P2.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Emoji Picker P2.lnk'
$shortcutBackups = @{}
foreach ($shortcut in @($startMenuLink,$desktopLink)) { if (Test-Path -LiteralPath $shortcut) { $shortcutBackups[$shortcut] = [IO.File]::ReadAllBytes($shortcut) } }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupValue = (Get-ItemProperty -LiteralPath $runKey -Name 'com.techkey.emojipicker.p2' -ErrorAction SilentlyContinue).'com.techkey.emojipicker.p2'
$installedByTest = $false
try {
  $installerProcess = Start-Process -FilePath $installerPath -ArgumentList "/S /D=$installTestPath" -WindowStyle Hidden -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) { throw "Installer failed with exit code $($installerProcess.ExitCode)" }
  if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Installed executable missing' }
  $installedByTest = $true
  Write-Output 'PASS: silent per-user NSIS installation'
  & node (Join-Path $PSScriptRoot 'verify-release.cjs') $installedExe
  if ($LASTEXITCODE -ne 0) { throw 'Installed executable checks failed' }
  & node (Join-Path $PSScriptRoot 'test-native.cjs') $installedExe
  if ($LASTEXITCODE -ne 0) { throw 'Installed native interaction checks failed' }
  if (-not (Test-Path -LiteralPath $startMenuLink)) { throw 'Start Menu shortcut missing' }
  Write-Output 'PASS: Start Menu shortcut exists'
  if (-not $hadPreferences) { [IO.File]::WriteAllText($preferencesPath, '{"settings":{"theme":"system"},"recent":[]}') }
  $beforeUninstall = [IO.File]::ReadAllText($preferencesPath)
  $uninstallProcess = Start-Process -FilePath $uninstallerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) { throw "Uninstaller failed with exit code $($uninstallProcess.ExitCode)" }
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ((Test-Path -LiteralPath $installedExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (Test-Path -LiteralPath $installedExe) { throw 'Installed executable remained after uninstall' }
  if (Test-Path -LiteralPath $startMenuLink) { throw 'Start Menu shortcut remained after uninstall' }
  if ([IO.File]::ReadAllText($preferencesPath) -ne $beforeUninstall) { throw 'Preferences were not preserved' }
  Write-Output 'PASS: uninstall removes installed app and shortcut, preserving preferences'
} finally {
  if ($installedByTest -and (Test-Path -LiteralPath $uninstallerPath)) {
    Start-Process -FilePath $uninstallerPath -ArgumentList '/S' -WindowStyle Hidden -Wait | Out-Null
  }
  if ($hadPreferences) { [IO.File]::WriteAllBytes($preferencesPath,$preferencesBackup) }
  elseif (Test-Path -LiteralPath $preferencesPath) { Remove-Item -LiteralPath $preferencesPath }
  foreach ($shortcut in $shortcutBackups.Keys) { [IO.File]::WriteAllBytes($shortcut,$shortcutBackups[$shortcut]) }
  if ($null -ne $startupValue) { New-ItemProperty -Path $runKey -Name 'com.techkey.emojipicker.p2' -Value $startupValue -PropertyType String -Force | Out-Null }
  else { Remove-ItemProperty -LiteralPath $runKey -Name 'com.techkey.emojipicker.p2' -ErrorAction SilentlyContinue }
}

