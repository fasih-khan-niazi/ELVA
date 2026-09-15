# ELVA local dev — opens three colored terminals (backend, AI service, frontend).
# Usage: .\scripts\start-elva.ps1
# Prerequisite: ngrok http 3000 in a separate terminal if testing browser voice.

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "  ELVA Local Dev" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Backend   → http://localhost:3000" -ForegroundColor Green
Write-Host "  AI        → http://localhost:8000" -ForegroundColor Green
Write-Host "  Frontend  → http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  Voice test: start ngrok (ngrok http 3000) and set BASE_URL in backend/.env" -ForegroundColor Yellow
Write-Host ""

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\backend'; Write-Host '══ ELVA Backend ══' -ForegroundColor Cyan; npm run dev"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\ai_service'; Write-Host '══ ELVA AI Service ══' -ForegroundColor Cyan; python -m uvicorn main:app --reload --port 8000"
)

Start-Sleep -Seconds 1

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\frontend'; Write-Host '══ ELVA Frontend ══' -ForegroundColor Cyan; npm run dev"
)

Write-Host "  Started 3 terminals. Watch backend for the Voice Pipeline banner on startup." -ForegroundColor Green
Write-Host ""
