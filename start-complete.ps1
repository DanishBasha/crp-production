Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  Communication Readiness Platform - Complete Stack Launcher" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting all 3 services in individual terminals:" -ForegroundColor White
Write-Host "  [1] Python AI Service : http://127.0.0.1:8000" -ForegroundColor Yellow
Write-Host "  [2] Node.js Backend   : http://localhost:5000" -ForegroundColor Green
Write-Host "  [3] React Frontend    : http://localhost:5173" -ForegroundColor Cyan
Write-Host ""

# 1. Start Python AI Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Starting AI Service on Port 8000...' -ForegroundColor Yellow; cd '$PSScriptRoot\ai-service'; python -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

# 2. Start Node.js Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Starting Backend API on Port 5000...' -ForegroundColor Green; cd '$PSScriptRoot\backend'; npm run dev"

# 3. Start Frontend App
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Starting Frontend on Port 5173...' -ForegroundColor Cyan; cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host "All services launched in separate windows!" -ForegroundColor Green
Write-Host "Visit the web portal: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
