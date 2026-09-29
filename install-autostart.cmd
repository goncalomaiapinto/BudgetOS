@echo off
setlocal EnableExtensions
title Orcamento Pessoal - Arranque automatico
cd /d "%~dp0"

rem Publishes the app (if needed) and registers a scheduled task that starts it, hidden, every time you log in.

if not exist "%~dp0app\Api.exe" (
    echo A app ainda nao foi publicada. A publicar primeiro...
    set "NO_PAUSE=1"
    call "%~dp0publish.cmd"
    if errorlevel 1 goto failed
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" install
if errorlevel 1 goto failed

echo.
echo Pronto. A app arranca sozinha sempre que iniciar sessao no Windows.
echo.
echo Para a ter como aplicacao (Menu Iniciar / barra de tarefas, sem barra de enderecos):
echo   1. Abra http://localhost:5180 no Edge ou no Chrome
echo   2. Edge: menu ... ^> Aplicacoes ^> Instalar este site como aplicacao
echo      Chrome: icone de instalar na barra de enderecos ^(ou menu ^> Transmitir, guardar e partilhar ^> Instalar pagina como app^)
echo   3. Clique com o botao direito no icone da barra de tarefas ^> Afixar
echo.
if not defined NO_BROWSER start "" "http://localhost:5180"
pause
exit /b 0

:failed
echo.
echo [ERRO] Nao foi possivel configurar o arranque automatico - veja as mensagens acima.
pause
exit /b 1
