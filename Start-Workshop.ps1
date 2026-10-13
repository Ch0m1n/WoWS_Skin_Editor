param([int]$Port = 8766, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workshopRoot = $PSScriptRoot
$workshopUrl = "http://127.0.0.1:$Port"
$existing = $null
try { $existing = Invoke-RestMethod -Uri "$workshopUrl/api/health" -TimeoutSec 2 } catch {}
if ($existing -and $existing.app -eq 'wows-skin-workshop') {
    Write-Output "이미 실행 중이에요: $workshopUrl"
    if (-not $NoBrowser) { Start-Process $workshopUrl }
    exit 0
}
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
$process = Start-Process -FilePath $workshopPython -ArgumentList @('"' + (Join-Path $workshopRoot 'server.py') + '"', '--port', "$Port") -WorkingDirectory $workshopRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $workshopRoot 'workshop.log') -RedirectStandardError (Join-Path $workshopRoot 'workshop-error.log')
$process.Id | Set-Content -LiteralPath (Join-Path $workshopRoot 'workshop.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw ('편집기 서버가 종료됐어요. ' + (Get-Content -LiteralPath (Join-Path $workshopRoot 'workshop-error.log') -Raw)) }
    try {
        $health = Invoke-RestMethod -Uri "$workshopUrl/api/health" -TimeoutSec 1
        if ($health.app -eq 'wows-skin-workshop') {
            Write-Output "편집기가 열렸어요: $workshopUrl"
            if (-not $NoBrowser) { Start-Process $workshopUrl }
            exit 0
        }
    } catch {}
    Start-Sleep -Milliseconds 200
}
throw '서버가 응답하지 않아요. workshop-error.log를 확인하세요.'
