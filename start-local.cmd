@echo off
setlocal
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
if errorlevel 1 (
	echo.
	echo Startup failed. Check the console output and the .logs folder.
	pause
)