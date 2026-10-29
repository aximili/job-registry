@echo off
rem Job Registry: one-time setup. Installs packages, builds the dashboard,
rem creates your settings file and, if you like, shortcuts.
rem setup.bat -Quiet asks nothing and doesn't pause (for the handover checks).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set "CODE=%errorlevel%"
if /i not "%~1"=="-Quiet" pause
exit /b %CODE%
