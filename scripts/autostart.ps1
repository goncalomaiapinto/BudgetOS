# Installs / removes / stops the "always on" copy of the app (the one published to .\app by publish.cmd).
# Used by install-autostart.cmd, uninstall-autostart.cmd and publish.cmd.
param([Parameter(Mandatory)][ValidateSet('install', 'uninstall', 'stop', 'start')] [string] $Action)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'app'
$exe = Join-Path $appDir 'Api.exe'
$taskName = 'Orcamento Pessoal'
$url = 'http://localhost:5180'
$user = "$env:USERDOMAIN\$env:USERNAME"

function Get-Task { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }

function Stop-App {
    if (Get-Task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
    # Also covers a copy started by hand; only processes running from .\app are touched.
    Get-Process -Name Api -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($appDir, [StringComparison]::OrdinalIgnoreCase) } |
        ForEach-Object { Stop-Process -Id $_.Id -Force; Write-Host "Parado (PID $($_.Id))." }
}

function Wait-App {
    Write-Host 'A aguardar que a app responda...'
    for ($i = 0; $i -lt 60; $i++) {
        try { Invoke-RestMethod "$url/api/health" -TimeoutSec 2 | Out-Null; return $true } catch { Start-Sleep 1 }
    }
    return $false
}

switch ($Action) {
    'install' {
        if (-not (Test-Path $exe)) { throw "Não encontrei $exe. Corra primeiro o publish.cmd." }

        $taskAction = New-ScheduledTaskAction -Execute $exe -Argument '--environment Production' -WorkingDirectory $appDir
        # Two triggers: start right away at logon, plus a watchdog every 5 minutes. With MultipleInstances IgnoreNew
        # the watchdog does nothing while the app runs and brings it back if it ever stops
        # (Task Scheduler's restart-on-failure only covers failures to start, not crashes).
        $taskTrigger = @(
            (New-ScheduledTaskTrigger -AtLogOn -User $user),
            (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5))
        )
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $taskSettings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings `
            -Description "Orçamento Pessoal em $url (arranca ao iniciar sessão, sem janela)." -Force | Out-Null
        Write-Host "Tarefa agendada '$taskName' criada (arranca ao iniciar sessão)."

        Stop-App
        Start-ScheduledTask -TaskName $taskName
        if (Wait-App) { Write-Host "A app está a correr em $url" }
        else { Write-Warning "A app não respondeu. Veja os logs em $appDir\logs." }
    }
    'uninstall' {
        Stop-App
        if (Get-Task) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
            Write-Host "Tarefa agendada '$taskName' removida."
        } else {
            Write-Host 'A tarefa agendada não existia.'
        }
    }
    'stop' { Stop-App }
    'start' {
        if (Get-Task) { Start-ScheduledTask -TaskName $taskName }
        elseif (Test-Path $exe) { Start-Process -FilePath $exe -ArgumentList '--environment Production' -WorkingDirectory $appDir }
        else { throw "Não encontrei $exe." }
        if (Wait-App) { Write-Host "A app está a correr em $url" }
        else { Write-Warning "A app não respondeu. Veja os logs em $appDir\logs." }
    }
}
