@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo A fechar a API e o frontend lancados pelo start.cmd...

rem Finds the cmd windows started by start.cmd (their command line contains "title OrcamentoPessoal - ")
rem and kills each one together with its child processes (dotnet, Api.exe, node).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$found = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*title OrcamentoPessoal - *' }; if (-not $found) { 'Nada para fechar.' } else { $found | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null; 'Fechado (PID ' + $_.ProcessId + ')' } }; $left = Get-NetTCPConnection -State Listen -LocalPort 5100,5173 -ErrorAction SilentlyContinue; foreach ($c in $left) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; 'Aviso: a porta ' + $c.LocalPort + ' continua ocupada por ' + $p.ProcessName + ' (PID ' + $c.OwningProcess + ')' }"

ping -n 3 127.0.0.1 >nul
