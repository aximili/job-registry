@echo off
rem Starts Job Registry (if it isn't running yet) and opens the dashboard.
rem start.bat --no-browser starts it without opening a browser (used at log-in).
setlocal
cd /d "%~dp0"

for /f "usebackq delims=" %%p in (`node scripts\port.mjs`) do set "PORT=%%p"
if not defined PORT set "PORT=4777"
set "URL=http://127.0.0.1:%PORT%/"

rem Already running? Then just open the dashboard.
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri '%URL%api/v1/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto open

if exist "data\logs\startup-error.txt" del "data\logs\startup-error.txt"
start "Job Registry server - close this window to stop" /min node server\main.ts

rem Wait up to 20 seconds for it to answer.
powershell -NoProfile -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-RestMethod -Uri '%URL%api/v1/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if not %errorlevel%==0 goto failed

:open
if /i "%~1"=="--no-browser" exit /b 0
start "" "%URL%"
exit /b 0

:failed
echo.
echo The server didn't start. See data\logs for details.
if exist "data\logs\startup-error.txt" (
  echo.
  type "data\logs\startup-error.txt"
)
echo.
pause
exit /b 1
