@echo off
rem Job Registry: downloads the default local AI (llama-server and the
rem Bonsai 2 27B model, about 8 GB) into the ai folder. Safe to run again:
rem a broken download carries on where it stopped.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\download-ai.ps1"
pause
