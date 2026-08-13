@echo off
chcp 65001 >nul
title TodoQuant Electron

cd /d "%~dp0"

set PATH=C:\Program Files\nodejs;%PATH%

:MENU
cls
echo.
echo ========================================
echo   TodoQuant Electron
echo ========================================
echo.
echo [1] Restart Electron Client
echo [2] Stop Electron Client
echo [3] Build Windows Installer (local)
echo [4] Build and Upload Installer to GitHub
echo [5] Sync Public Source Code (to TodoQuant-releases)
echo [6] Exit
echo.
set /p choice="Select (1-6): "

if "%choice%"=="1" goto RESTART
if "%choice%"=="2" goto STOP
if "%choice%"=="3" goto BUILD_LOCAL
if "%choice%"=="4" goto BUILD_PUBLISH
if "%choice%"=="5" goto SYNC_PUBLIC
if "%choice%"=="6" exit /b 0
goto MENU

:RESTART
echo.
echo Stopping existing client...

for /L %%p in (3000,1,3010) do (
    for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :%%p ^| findstr LISTENING') do (
        taskkill /PID %%a /F /T >nul 2>&1
    )
)
taskkill /F /IM TodoQuant.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1

timeout /t 2 /nobreak >nul
echo Old processes cleaned.

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install >nul 2>&1
)

echo.
echo Starting Electron client...
echo.
start "TodoQuant" cmd /c "npm run electron:dev"
echo.
echo Client is starting...
echo.
echo Press any key to return to menu
echo.
pause >nul
goto MENU

:STOP
echo.
echo Stopping Electron client...

for /L %%p in (3000,1,3010) do (
    for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :%%p ^| findstr LISTENING') do (
        taskkill /PID %%a /F /T >nul 2>&1
    )
)
taskkill /F /IM TodoQuant.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1

timeout /t 2 /nobreak >nul
echo Client stopped.
echo.
pause >nul
goto MENU

:BUILD_LOCAL
echo.
echo Building Windows installer (local only)...
echo This may take a few minutes.
echo.

echo Stopping any running client...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM TodoQuant.exe >nul 2>&1
timeout /t 2 /nobreak >nul

call npm run electron:build:local
echo.
if errorlevel 1 (
    echo Build FAILED.
) else (
    echo Build completed! Check the release/ folder.
)
echo.
pause >nul
goto MENU

:BUILD_PUBLISH
echo.
echo Building Windows installer and publishing to GitHub...
echo This may take a few minutes.
echo.

echo Stopping any running client...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM TodoQuant.exe >nul 2>&1
timeout /t 2 /nobreak >nul

call npm run electron:build:win
echo.
if errorlevel 1 (
    echo Build FAILED.
) else (
    echo Build completed! Check release/ folder and GitHub Releases page.
)
echo.
pause >nul
goto MENU

:SYNC_PUBLIC
echo.
echo Syncing public source code to TodoQuant-releases...
echo This will: strip comments, remove sensitive files, replace secrets, then push.
echo.
call node scripts/sync-public.mjs --push
echo.
pause >nul
goto MENU
