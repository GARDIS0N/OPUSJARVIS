@echo off
title OPUSJARVIS Launcher
echo ========================================================
echo               STARTING OPUSJARVIS
echo       Personal AI Manager for Gardison
echo ========================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found at .venv.
    echo Please make sure you are in the repository root.
    pause
    exit /b 1
)

echo Checking server dependencies...
start "OPUSJARVIS Server (port 8000)" cmd /k ""%~dp0.venv\Scripts\python.exe" -m openjarvis.cli serve --host 127.0.0.1 --port 8000"

echo Waiting for server to initialize...
timeout /t 3 /nobreak >nul

echo Opening browser to http://localhost:8000 ...
start http://localhost:8000

echo.
echo OPUSJARVIS is running! Keep the server window open while using Jarvis.
echo.
pause
