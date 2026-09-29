@echo off
setlocal EnableExtensions
title Orcamento Pessoal - Publicar
cd /d "%~dp0"

rem Builds the frontend and the API into .\app (single process on http://localhost:5180).
rem Run it again after changing the code to update the installed app.

echo.
echo --- 1/4 A parar a app instalada (se estiver a correr)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" stop
if errorlevel 1 goto failed

echo.
echo --- 2/4 Frontend (npm run build)
pushd "src\web"
call npm run build
set "NPM_ERR=%ERRORLEVEL%"
popd
if not "%NPM_ERR%"=="0" goto failed

echo.
echo --- 3/4 API (dotnet publish)
rem WinExe = no console window when it runs in the background.
dotnet publish "src\Api\Api.csproj" -c Release -o "%~dp0app" -p:OutputType=WinExe --nologo -v q
if errorlevel 1 goto failed

echo.
echo --- 4/4 A copiar o frontend para app\wwwroot
robocopy "%~dp0src\web\dist" "%~dp0app\wwwroot" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto failed

echo.
echo Publicado em "%~dp0app".
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-ScheduledTask -TaskName 'Orcamento Pessoal' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo Para arrancar sempre com o Windows, corra install-autostart.cmd.
) else (
    echo A reiniciar a app instalada...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" start
)
echo.
if not defined NO_PAUSE pause
exit /b 0

:failed
echo.
echo [ERRO] A publicacao falhou - veja as mensagens acima.
if not defined NO_PAUSE pause
exit /b 1
