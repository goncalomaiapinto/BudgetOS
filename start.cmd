@echo off
setlocal EnableExtensions
title Orcamento Pessoal - Arranque
cd /d "%~dp0"

set "API_URL=http://localhost:5100/api/health"
set "WEB_URL=http://localhost:5173"

curl.exe -s -f -o nul "%API_URL%" >nul 2>nul
if not errorlevel 1 (
    echo A API ja esta a correr. A abrir o browser...
    if not defined NO_BROWSER start "" "%WEB_URL%"
    exit /b 0
)

if not exist "src\web\node_modules" (
    echo Parece que falta a instalacao. Corra primeiro o setup.cmd.
    pause
    exit /b 1
)

echo A arrancar a API ^(porta 5100^) e o frontend ^(porta 5173^)...
rem The "title ..." inside the command line is what stop.cmd looks for.
start "OrcamentoPessoal - API" /D "%~dp0src\Api" cmd /k "title OrcamentoPessoal - API && dotnet run --launch-profile http"
start "OrcamentoPessoal - Web" /D "%~dp0src\web" cmd /k "title OrcamentoPessoal - Web && npm run dev"

echo A aguardar que a API fique pronta...
set /a TRIES=0
:wait_api
curl.exe -s -f -o nul "%API_URL%" >nul 2>nul
if not errorlevel 1 goto wait_web
set /a TRIES+=1
if %TRIES% geq 120 goto timeout
ping -n 2 127.0.0.1 >nul
goto wait_api

:wait_web
curl.exe -s -o nul "%WEB_URL%" >nul 2>nul
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% geq 150 goto timeout
ping -n 2 127.0.0.1 >nul
goto wait_web

:ready
echo Pronto: %WEB_URL%
if not defined NO_BROWSER start "" "%WEB_URL%"
exit /b 0

:timeout
echo.
echo [ERRO] A API nao respondeu em 2 minutos. Veja os erros na janela "OrcamentoPessoal - API".
echo Causas comuns: SQL Server/LocalDB inacessivel ou porta 5100 ocupada ^(ver README^).
pause
exit /b 1
