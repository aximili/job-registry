@echo off
rem Starts Bonsai 2 (llama-server) on this computer only, for the agent tool
rem (for example Cline) and Job Registry to share. Leave this window open;
rem close it to stop the AI. Job Registry sees the server already running,
rem uses it, and never stops it.
rem -c 65536 -np 2: two requests at once, each with up to 32768 tokens.
setlocal
cd /d "%~dp0"

if not exist "ai\llama.cpp\llama-server.exe" goto missing
if not exist "ai\models\Ternary-Bonsai-2-27B-PQ2_0.gguf" goto missing

rem Something on port 8080 already? It's often Job Registry's own llama-server,
rem which it would stop when idle, cutting the agent off. Stop it first.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:8080/health' | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } else { exit 1 } }"
if %errorlevel%==0 goto busy

echo Starting Bonsai 2 at http://127.0.0.1:8080/v1 ...
"ai\llama.cpp\llama-server.exe" -m "ai\models\Ternary-Bonsai-2-27B-PQ2_0.gguf" -ngl 99 -fa on -c 65536 -np 2 --jinja --host 127.0.0.1 --port 8080
echo.
echo Bonsai 2 stopped.
pause
exit /b 0

:busy
echo Something already answers on port 8080, often Job Registry's own AI.
echo Run stop.bat (it stops Job Registry and its AI), then run this again.
pause
exit /b 1

:missing
echo The AI isn't downloaded yet. Run download-ai.bat first, then run this again.
pause
exit /b 1
