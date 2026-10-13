param([string]$RuntimeSource = "$env:LOCALAPPDATA\Programs\WoWS Toolbox\Runtime\Python",[string]$OutputName = ('WoWS-Skin-Workshop-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if($OutputName -notmatch '^[A-Za-z0-9_-]+$'){throw 'OutputName must be a folder name.'}
$releaseRoot=Join-Path (Join-Path $projectRoot 'dist') $OutputName
if(Test-Path -LiteralPath $releaseRoot){throw 'Use a fresh OutputName so running release files are never overwritten.'}
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeSource 'python.exe'))) { throw '빌드용 CPython Windows embeddable runtime 경로가 필요해요. -RuntimeSource 로 지정하세요.' }
$runtime=Join-Path $releaseRoot 'Runtime\Python'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Get-ChildItem -LiteralPath $RuntimeSource -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $runtime -Force}
$site=Join-Path $runtime 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $site | Out-Null
Get-ChildItem -LiteralPath (Join-Path $RuntimeSource 'Lib\site-packages') -Directory | Where-Object {$_.Name -eq 'PIL' -or $_.Name -eq 'pillow.libs' -or $_.Name -like 'pillow-*.dist-info'} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $site -Recurse -Force}
@('web','engine') | ForEach-Object {
    $sourceTree=Join-Path $projectRoot $_
    $targetTree=Join-Path $releaseRoot $_
    Get-ChildItem -LiteralPath $sourceTree -Recurse -File | Where-Object {$_.FullName -notlike '*\__pycache__\*'} | ForEach-Object {
        $targetFile=Join-Path $targetTree $_.FullName.Substring($sourceTree.Length+1)
        New-Item -ItemType Directory -Force -Path (Split-Path $targetFile -Parent) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $targetFile
    }
}
@('server.py','game_library.py','launch.py','project_store.py','app_version.py','README.md','LICENSE','CHANGELOG.md','RELEASE-v0.2.md','THIRD_PARTY_NOTICES.md') | ForEach-Object {Copy-Item -LiteralPath (Join-Path $projectRoot $_) -Destination $releaseRoot -Force}
# An app-specific .pth makes the project visible to the isolated embedded interpreter.
@('python310.zip','.','Lib\site-packages','..\..','..\..\engine\Backend','import site') | Set-Content -LiteralPath (Join-Path $runtime 'python310._pth') -Encoding ascii
@('@echo off','cd /d "%~dp0"','"Runtime\Python\python.exe" launch.py','if errorlevel 1 pause') | Set-Content -LiteralPath (Join-Path $releaseRoot 'Start-Workshop.cmd') -Encoding ascii
$manifest=Get-ChildItem -LiteralPath $releaseRoot -Recurse -File | Where-Object {$_.FullName -notlike '*\__pycache__\*'} | ForEach-Object {[pscustomobject]@{path=$_.FullName.Substring($releaseRoot.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $releaseRoot 'manifest.json') -Encoding utf8
Compress-Archive -Path $releaseRoot -DestinationPath (Join-Path $projectRoot 'dist\WoWS-Skin-Workshop.zip') -Force
Write-Output "Portable release: $releaseRoot"
