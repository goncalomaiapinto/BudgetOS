@echo off
setlocal EnableExtensions
title Orcamento Pessoal - Instalacao
cd /d "%~dp0"

echo.
echo ===== Orcamento Pessoal - instalacao =====
echo.

set "MISSING="

where dotnet >nul 2>nul
if errorlevel 1 goto no_dotnet
dotnet --list-sdks | findstr /b /c:"10." >nul
if errorlevel 1 goto no_sdk10
for /f "tokens=1" %%v in ('dotnet --list-sdks ^| findstr /b /c:"10."') do set "SDK=%%v"
echo [OK] .NET SDK %SDK%
goto check_node

:no_dotnet
echo [FALTA] .NET SDK 10 - instale em https://dotnet.microsoft.com/download/dotnet/10.0
set "MISSING=1"
goto check_node

:no_sdk10
echo [FALTA] .NET SDK 10 - tem o dotnet mas nao a versao 10. Instale em https://dotnet.microsoft.com/download/dotnet/10.0
set "MISSING=1"

:check_node
where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
echo [OK] Node.js %NODEV%
goto check_sqlcmd

:no_node
echo [FALTA] Node.js 20 ou superior - instale a versao LTS em https://nodejs.org
set "MISSING=1"

:check_sqlcmd
where sqlcmd >nul 2>nul
if errorlevel 1 (
    echo [AVISO] sqlcmd nao encontrado - so e necessario para o backup-db.cmd
) else (
    echo [OK] sqlcmd
)

if defined MISSING goto failed

echo.
echo --- 1/4 Ferramentas .NET (dotnet-ef)
dotnet tool restore
if errorlevel 1 goto failed

echo.
echo --- 2/4 Pacotes da API (dotnet restore)
dotnet restore "src\Api\Api.csproj"
if errorlevel 1 goto failed

echo.
echo --- 3/4 Pacotes do frontend (npm install)
pushd "src\web"
call npm install
set "NPM_ERR=%ERRORLEVEL%"
popd
if not "%NPM_ERR%"=="0" goto failed

echo.
echo --- 4/4 Base de dados (migrations do EF Core)
dotnet ef database update --project "src\Api\Api.csproj"
if errorlevel 1 goto db_failed

echo.
echo ===== Instalacao concluida. Use start.cmd para arrancar. =====
echo.
pause
exit /b 0

:db_failed
echo.
echo [ERRO] Nao foi possivel aplicar as migrations.
echo Verifique se o SQL Server / LocalDB esta instalado e a connection string em
echo src\Api\appsettings.Development.json  - ver README, seccao Troubleshooting.
echo.
pause
exit /b 1

:failed
echo.
echo [ERRO] A instalacao nao terminou. Corrija o que esta indicado acima e volte a correr setup.cmd.
echo.
pause
exit /b 1
