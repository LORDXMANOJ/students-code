@echo off
title CodeTracker Launcher
echo ========================================================
echo               Starting CodeTracker Locally
echo ========================================================
echo.

echo Starting Backend Server (Port 3000)...
start "CodeTracker - Backend" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting Frontend Angular App (Port 4200)...
start "CodeTracker - Frontend" cmd /k "cd /d %~dp0frontend && npm start"

echo.
echo ========================================================
echo  Both services are starting in separate windows!
echo.
echo  Backend:  http://localhost:3000/api/health
echo  Frontend: http://localhost:4200
echo.
echo  Default Super Admin:
echo  Email:    admin@codetracker.local
echo  Password: ChangeMe123!
echo ========================================================
echo.
pause
