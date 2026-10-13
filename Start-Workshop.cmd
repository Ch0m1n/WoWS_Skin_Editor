@echo off
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 is required. Open Start-Workshop.ps1 with pwsh.
  pause
  exit /b 1
)
pwsh -NoLogo -NoProfile -File "%~dp0Start-Workshop.ps1"
if errorlevel 1 pause
