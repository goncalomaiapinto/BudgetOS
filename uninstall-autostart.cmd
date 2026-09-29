@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Stops the installed app and removes the scheduled task. The database and the .\app folder are kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" uninstall

echo.
echo A app deixou de arrancar com o Windows. Os dados ^(base de dados^) nao foram tocados.
if not defined NO_PAUSE pause
