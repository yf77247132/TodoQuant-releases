@echo off
chcp 65001 >nul
title OKX Trading TS

cd /d "%~dp0"

set PATH=C:\Program Files\nodejs;%PATH%

:MENU
cls
echo.
echo ========================================
echo   OKX Trading TS
echo ========================================
echo.
echo [1] Start Server
echo [2] Stop Server
echo [3] Start Server + Rebuild (for Electron switch)
echo [4] Exit
echo.
set /p choice="Select (1-4): "

if "%choice%"=="1" goto START
if "%choice%"=="2" goto STOP
if "%choice%"=="3" goto START_REBUILD
if "%choice%"=="4" exit /b 0
goto MENU

:START
call :KILL_PORT_3000
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install >nul 2>&1
)
goto :LAUNCH

:START_REBUILD
call :KILL_PORT_3000
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install >nul 2>&1
)
echo.
echo Rebuilding native modules (for Electron compatibility)...
call npm rebuild better-sqlite3 2>&1
echo Rebuild complete.
goto :LAUNCH

:LAUNCH
echo.
echo Starting server...
start /B cmd /c "npm run dev"
timeout /t 3 /nobreak >nul

echo.
tasklist | findstr /I "chrome.exe firefox.exe msedge.exe" >nul 2>&1
if errorlevel 1 (
    start http://localhost:3000
    echo Browser opened at http://localhost:3000
) else (
    echo Browser already running, skipping open
)
echo.
echo Server is running at http://localhost:3000
echo.
echo Press any key to return to menu
echo.
pause >nul
goto MENU

:KILL_PORT_3000
netstat -ano | findstr :3000 >nul 2>&1
if not errorlevel 1 (
    echo Port 3000 already in use, stopping existing process...
    for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :3000 ^| findstr LISTENING') do (
        taskkill /PID %%a /F /T >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
)
exit /b 0

:STOP
echo.
echo Stopping server...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
echo Server stopped.
echo.
pause >nul
goto MENU
