@echo off
setlocal
:: Rebuild and restart Agent Spaces.
:: Run from a Spaces pane:  C:\projects\spaces\scripts\rebuild.cmd

set SPACES_DIR=C:\projects\spaces

echo === Stopping Spaces server ===

:: Kill ALL node processes running spaces.js (catches any port)
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%spaces.js%%' and name='node.exe'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
    echo   Killing Spaces PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: Also kill any node-terminal-server processes
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%terminal-server%%' and name='node.exe'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
    echo   Killing terminal-server PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: Also try service stop
node "%SPACES_DIR%\bin\spaces.js" service stop >nul 2>&1

:: Give processes time to die
timeout /t 3 /nobreak >nul

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

:: Detect port from config or default
set PORT=3457
echo   Waiting for server to start...
for /l %%i in (1,1,45) do (
    curl -s -o nul http://localhost:3457 >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo === Spaces is running at http://localhost:3457 ===
        goto :done
    )
    curl -s -o nul http://localhost:3458 >nul 2>&1
    if not errorlevel 1 (
        echo.
        echo === Spaces is running at http://localhost:3458 ===
        goto :done
    )
    timeout /t 1 /nobreak >nul
    <nul set /p =.
)
echo.
echo   Server may still be starting — check http://localhost:3457 or :3458

:done
endlocal
