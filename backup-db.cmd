@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ---- Configuration: change here if you move the database to another SQL Server instance ----
set "SQL_INSTANCE=(localdb)\MSSQLLocalDB"
set "DB_NAME=OrcamentoPessoal"
rem ---------------------------------------------------------------------------------------------

where sqlcmd >nul 2>nul
if errorlevel 1 goto no_sqlcmd

if not exist "%~dp0backups" mkdir "%~dp0backups"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "FILE=%~dp0backups\%DB_NAME%_%TS%.bak"

echo A fazer backup de [%DB_NAME%] em %SQL_INSTANCE%
echo para "%FILE%"...
sqlcmd -S "%SQL_INSTANCE%" -E -b -Q "BACKUP DATABASE [%DB_NAME%] TO DISK = N'%FILE%' WITH INIT, COPY_ONLY, CHECKSUM, NAME = N'%DB_NAME% %TS%'"
if errorlevel 1 goto failed

echo.
echo Backup concluido: "%FILE%"
pause
exit /b 0

:no_sqlcmd
echo [ERRO] sqlcmd nao encontrado. Instale as "SQL Server Command Line Utilities" ou use o SSMS - ver README.
pause
exit /b 1

:failed
echo.
echo [ERRO] O backup falhou. Confirme a instancia SQL_INSTANCE no topo deste ficheiro.
pause
exit /b 1
