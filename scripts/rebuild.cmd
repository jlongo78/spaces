@echo off
setlocal
:: Rebuild and restart Agent Spaces.
:: Run from a Spaces pane:  C:\projects\spaces\scripts\rebuild.cmd

set SPACES_DIR=C:\projects\spaces
set PORT=3457

echo === Stopping Spaces server (port %PORT%) ===

:: Find and kill processes listening on our port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTEN"') do (
    if not "%%a"=="0" (
        echo   Killing PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)

:: Also try service stop
node "%SPACES_DIR%\bin\spaces.js" service stop >nul 2>&1

:: Give processes time to die
timeout /t 2 /nobreak >nul

echo.
echo === Building ===
cd /d "%SPACES_DIR%"
call npm run build
if errorlevel 1 (
    echo BUILD FAILED
    pause
    exit /b 1
)

echo.
echo === Starting Spaces ===
start "Spaces Server" /min node "%SPACES_DIR%\bin\spaces.js"

:: Wait for it to come up
echo   Waiting for server on port %PORT%...
for /l %%i in (1,1,30) do (
    curl -s -o nul http://localhost:%PORT% >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo === Spaces is running at http://localhost:%PORT% ===
        goto :done
    )
    timeout /t 1 /nobreak >nul
    <nul set /p =.
)
echo.
echo   Server may still be starting — check http://localhost:%PORT%

:done
endlocal
