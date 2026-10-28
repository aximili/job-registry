@echo off
rem Job Registry: one-time setup. Installs packages, builds the dashboard,
rem creates your settings file and, if you like, shortcuts.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
pause
