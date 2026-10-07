@echo off
title Communication Readiness Platform - Full Stack Launcher
echo ===================================================================
echo   Communication Readiness Platform - Complete Stack Launcher
echo ===================================================================
echo.
echo Starting all 3 services in individual terminals:
echo   [1] Python AI Service : http://127.0.0.1:8000
echo   [2] Node.js Backend   : http://localhost:5000
echo   [3] React Frontend    : http://localhost:5173
echo.

:: 1. Start Python AI Service
start "CRP - [1] Python AI Service (Port 8000)" cmd /k "cd ai-service && python -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

:: 2. Start Node.js Backend
start "CRP - [2] Node Backend API (Port 5000)" cmd /k "cd backend && npm run dev"

:: 3. Start Frontend App
start "CRP - [3] Frontend Web App (Port 5173)" cmd /k "cd frontend && npm run dev"

echo All services launched!
echo Open your browser at: http://localhost:5173
echo.
pause
