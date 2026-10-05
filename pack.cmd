@echo off
setlocal EnableExtensions
title Orcamento Pessoal - Gerar pacote para outro PC
cd /d "%~dp0"

rem Builds pacote\OrcamentoPessoal.zip for a PC with nothing installed (self-contained .NET, prebuilt frontend).
rem Only needs SQL Server Express LocalDB on the other PC. Does not touch .\app nor the local database.

set "OUT=%~dp0pacote\OrcamentoPessoal"
if exist "%~dp0pacote" rmdir /s /q "%~dp0pacote"

echo --- 1/3 Frontend (npm run build)
pushd "src\web"
call npm run build
set "NPM_ERR=%ERRORLEVEL%"
popd
if not "%NPM_ERR%"=="0" goto failed

echo --- 2/3 API self-contained (dotnet publish)
dotnet publish "src\Api\Api.csproj" -c Release -r win-x64 --self-contained -o "%OUT%\app" -p:OutputType=WinExe --nologo -v q
if errorlevel 1 goto failed
robocopy "%~dp0src\web\dist" "%OUT%\app\wwwroot" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto failed

echo --- 3/3 Scripts e zip
mkdir "%OUT%\scripts"
copy /y "scripts\autostart.ps1" "%OUT%\scripts\" >nul
copy /y "install-autostart.cmd" "%OUT%\" >nul
copy /y "uninstall-autostart.cmd" "%OUT%\" >nul
copy /y "scripts\LEIA-ME.txt" "%OUT%\" >nul
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%' -DestinationPath '%~dp0pacote\OrcamentoPessoal.zip' -Force"
if errorlevel 1 goto failed

echo.
echo Pacote pronto: "%~dp0pacote\OrcamentoPessoal.zip"
if not defined NO_PAUSE pause
exit /b 0

:failed
echo.
echo [ERRO] Nao foi possivel gerar o pacote - veja as mensagens acima.
if not defined NO_PAUSE pause
exit /b 1
