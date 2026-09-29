using System.Globalization;
using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

/// <param name="StartDate">Balances count from the month of this date. Opening balances live on each account.</param>
public record SettingsDto(DateOnly StartDate);

public record SettingsRequest(DateOnly? StartDate);

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/settings", async (AppDbContext db) => Results.Ok(await LoadAsync(db)));

        api.MapPut("/settings", async (SettingsRequest req, AppDbContext db) =>
        {
            if (req.StartDate is null) return Problems.Validation("startDate", "A data de início é obrigatória.");

            var value = req.StartDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var setting = await db.AppSettings.FindAsync(SettingKeys.OpeningBalanceDate);
            if (setting is null) db.AppSettings.Add(new AppSetting { Key = SettingKeys.OpeningBalanceDate, Value = value });
            else setting.Value = value;
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db));
        });
    }

    public static async Task<SettingsDto> LoadAsync(AppDbContext db)
    {
        var d = await db.AppSettings.AsNoTracking()
            .Where(s => s.Key == SettingKeys.OpeningBalanceDate).Select(s => s.Value).FirstOrDefaultAsync();
        var start = DateOnly.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var sd)
            ? sd
            : new DateOnly(DateTime.Today.Year, 1, 1);
        return new SettingsDto(start);
    }

    /// <summary>Opening balance of one account, or of all accounts added up when <paramref name="accountId"/> is null.</summary>
    public static Task<decimal> OpeningAsync(AppDbContext db, int? accountId) =>
        db.Accounts.Where(a => accountId == null || a.Id == accountId).SumAsync(a => a.OpeningBalance);
}
