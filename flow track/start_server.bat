@echo off
title FlowTrack - SQLite Database & Web Server
color 0A
cd /d "%~dp0"

echo ==========================================================
echo           FLOWTRACK - SQLITE DATABASE & SERVER
echo ==========================================================
echo Starting Python SQLite database server at http://localhost:5000...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python was not found in your system PATH!
    echo Please ensure Python is installed to run the local SQLite server.
    pause
    exit /b 1
)

REM Initialize SQLite database if missing
if not exist "flowtrack.db" (
    echo Initializing SQLite database flowtrack.db...
    python init_db.py
)

REM Open browser after 1 second in the background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

REM Run server
python server.py

pause
