# OPUSJARVIS PowerShell Launcher
Write-Host "========================================================" -ForegroundColor Green
Write-Host "               STARTING OPUSJARVIS                     " -ForegroundColor Green
Write-Host "       Personal AI Manager for Gardison                 " -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$python = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "[ERROR] Virtual environment not found at .venv." -ForegroundColor Red
    exit 1
}

Write-Host "Starting background server on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/k `"`"$python`" -m openjarvis.cli serve --host 127.0.0.1 --port 8000`"" -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host "Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:8000"

Write-Host ""
Write-Host "OPUSJARVIS is live at http://localhost:8000" -ForegroundColor Green
Write-Host "Keep the server window open while interacting with Jarvis." -ForegroundColor Yellow
