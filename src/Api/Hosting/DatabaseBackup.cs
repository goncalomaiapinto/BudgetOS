using Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Api.Hosting;

/// <summary>BACKUP DATABASE to the backups folder (the same folder backup-db.cmd uses).</summary>
public class DatabaseBackup(IConfiguration config, IHostEnvironment env, ILogger<DatabaseBackup> logger)
{
    public const string AutoPrefix = "auto_";

    /// <summary>Absolute path of the backups folder ("Backups:Folder", relative to the app folder).</summary>
    public string Folder => Path.GetFullPath(Path.Combine(env.ContentRootPath, config["Backups:Folder"] ?? "backups"));

    public async Task<string> RunAsync(AppDbContext db, string reason, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Folder);
        var name = new SqlConnectionStringBuilder(db.Database.GetConnectionString()).InitialCatalog;
        var file = Path.Combine(Folder, $"{name}_{AutoPrefix}{reason}_{DateTime.Now:yyyyMMdd_HHmmss}.bak");

        db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        // BACKUP accepts variables for both the database name and the file.
        await db.Database.ExecuteSqlRawAsync(
            "BACKUP DATABASE @p0 TO DISK = @p1 WITH INIT, COPY_ONLY, CHECKSUM", [name, file], ct);

        logger.LogInformation("Backup da base de dados criado em {File}", file);
        Prune();
        return file;
    }

    /// <summary>Keeps only the newest "Backups:Keep" automatic backups; manual ones are never touched.</summary>
    private void Prune()
    {
        var keep = config.GetValue("Backups:Keep", 10);
        var old = new DirectoryInfo(Folder).GetFiles($"*_{AutoPrefix}*.bak")
            .OrderByDescending(f => f.CreationTimeUtc)
            .Skip(keep);
        foreach (var f in old)
        {
            try { f.Delete(); }
            catch (IOException e) { logger.LogWarning(e, "Não foi possível apagar o backup antigo {File}", f.FullName); }
        }
    }

    public DateTime? NewestBackupUtc() =>
        Directory.Exists(Folder)
            ? new DirectoryInfo(Folder).GetFiles("*.bak").Select(f => (DateTime?)f.LastWriteTimeUtc).Max()
            : null;
}

/// <summary>While the app is running, makes sure there is a backup no older than a week.</summary>
public class WeeklyBackupService(IServiceProvider services, DatabaseBackup backup, ILogger<WeeklyBackupService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the PC finish logging in before doing anything heavy.
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        do
        {
            try
            {
                var newest = backup.NewestBackupUtc();
                if (newest is null || DateTime.UtcNow - newest > TimeSpan.FromDays(7))
                {
                    using var scope = services.CreateScope();
                    await backup.RunAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), "semanal", stoppingToken);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "O backup semanal falhou");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
