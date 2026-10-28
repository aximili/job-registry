@echo off
rem Stops Job Registry cleanly.
setlocal
cd /d "%~dp0"

for /f "usebackq delims=" %%p in (`node scripts\port.mjs`) do set "PORT=%%p"
if not defined PORT set "PORT=4777"

rem Windows PowerShell 5.1 sends a form content type on a POST without a body,
rem which the app refuses. So send an empty JSON body. Only say "wasn't
rem running" when nothing answered at all; show any other error as it is.
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:%PORT%/api/v1/system/shutdown' -Headers @{ Origin = 'http://127.0.0.1:%PORT%' } -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null; Write-Host 'Job Registry stopped.' } catch { if ($_.Exception.Response) { Write-Host ('Job Registry answered with an error: ' + $_.Exception.Message) } else { Write-Host 'Job Registry wasn''t running.' } }"

rem Leave the message on screen for a moment.
timeout /t 4 >nul
