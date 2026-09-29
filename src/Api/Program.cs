using System.Text.Json.Serialization;
using Api.Data;
using Api.Endpoints;
using Api.Hosting;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Optional machine-specific overrides (git-ignored), e.g. another SQL Server instance.
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.local.json", optional: true, reloadOnChange: true);

// Personal app: never listen on anything other than loopback, whatever the configuration says.
// 5100 while developing; the installed app uses 5180 (appsettings.Production.json).
var port = builder.Configuration.GetValue("Port", 5100);
builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(port));

// The installed app has no console window, so it logs to app\logs as well.
if (!builder.Environment.IsDevelopment())
    builder.Logging.AddProvider(new FileLoggerProvider(Path.Combine(builder.Environment.ContentRootPath, "logs")));

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddProblemDetails();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddSingleton<DatabaseBackup>();
if (builder.Configuration.GetValue("Backups:Weekly", false))
    builder.Services.AddHostedService<WeeklyBackupService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
    if (pending.Count > 0)
    {
        // Outside development, never change the schema of a database with data without a backup first.
        if (!app.Environment.IsDevelopment() && await db.Database.CanConnectAsync()
            && (await db.Database.GetAppliedMigrationsAsync()).Any())
        {
            await scope.ServiceProvider.GetRequiredService<DatabaseBackup>().RunAsync(db, "antes-migration");
        }
        app.Logger.LogInformation("A aplicar migrations: {Migrations}", string.Join(", ", pending));
        await db.Database.MigrateAsync();
    }
    await Seed.RunAsync(db);
}

app.UseExceptionHandler();
app.UseStatusCodePages();

// Installed app: the built frontend lives in wwwroot and is served by the API itself (single process).
// Static files must run before routing, otherwise the SPA fallback below would swallow them.
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();
app.UseCors();

var api = app.MapGroup("/api");
api.MapGet("/health", () => Results.Ok(new { status = "ok" }));
api.MapTransactionEndpoints();
api.MapTransferEndpoints();
api.MapCategoryEndpoints();
api.MapReportEndpoints();
api.MapSettingsEndpoints();
api.MapAccountEndpoints();
api.MapBudgetEndpoints();
api.MapHoldingEndpoints();

// Client-side routes (/orcamento, /investimentos, …) all load index.html; unknown /api/* stays a 404.
app.MapFallbackToFile("{*path:regex(^(?!api/).*$)}", "index.html");

app.Logger.LogInformation("Orçamento Pessoal a correr em http://localhost:{Port} ({Environment})", port, app.Environment.EnvironmentName);
app.Run();
