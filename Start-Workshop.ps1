param([int]$Port = 8766, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workshopRoot = $PSScriptRoot
$pythonCandidates = @(
    $env:WOWS_WORKSHOP_PYTHON,
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
    (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$workshopPython = $null
foreach ($candidate in $pythonCandidates) {
    & $candidate -c 'from PIL import Image' 2>$null
    if ($LASTEXITCODE -eq 0) { $workshopPython = $candidate; break }
}
if (-not $workshopPython) { throw 'Python과 Pillow가 필요해요. Python을 설치하고 python -m pip install -r requirements.txt 를 실행하세요.' }
if (-not $env:WOWS_WORKSHOP_CACHE) { $env:WOWS_WORKSHOP_CACHE = Join-Path $workshopRoot '.cache' }
$launchArgs = @((Join-Path $workshopRoot 'launch.py'), '--port', "$Port")
if ($NoBrowser) { $launchArgs += '--no-browser' }
Push-Location $workshopRoot
try { & $workshopPython @launchArgs; if ($LASTEXITCODE -ne 0) { throw '편집기를 시작하지 못했어요.' } }
finally { Pop-Location }
