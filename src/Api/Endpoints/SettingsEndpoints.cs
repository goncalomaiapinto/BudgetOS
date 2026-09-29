using System.Globalization;
using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

/// <param name="OpeningBalance">Opening balance of the main account (conta à ordem).</param>
/// <param name="MealCardOpeningBalance">Opening balance of the meal card (cartão refeição).</param>
public record SettingsDto(decimal OpeningBalance, decimal MealCardOpeningBalance, DateOnly StartDate)
{
    /// <summary>Opening balance for one account, or both added up when <paramref name="account"/> is null.</summary>
    public decimal OpeningFor(PaymentAccount? account) => account switch
    {
        PaymentAccount.Main => OpeningBalance,
        PaymentAccount.MealCard => MealCardOpeningBalance,
        _ => OpeningBalance + MealCardOpeningBalance,
    };
}

public record SettingsRequest(decimal? OpeningBalance, decimal? MealCardOpeningBalance, DateOnly? StartDate);

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/settings", async (AppDbContext db) => Results.Ok(await LoadAsync(db)));

        api.MapPut("/settings", async (SettingsRequest req, AppDbContext db) =>
        {
            var errors = new Dictionary<string, List<string>>();
            if (req.OpeningBalance is null) errors.AddError("openingBalance", "O saldo inicial é obrigatório.");
            else if (req.OpeningBalance != Math.Round(req.OpeningBalance.Value, 2))
                errors.AddError("openingBalance", "O saldo inicial só pode ter duas casas decimais.");
            if (req.MealCardOpeningBalance is { } meal && meal != Math.Round(meal, 2))
                errors.AddError("mealCardOpeningBalance", "O saldo inicial do cartão só pode ter duas casas decimais.");
            if (req.StartDate is null) errors.AddError("startDate", "A data de início é obrigatória.");
            if (errors.Count > 0) return Problems.Validation(errors);

            await SetAsync(db, SettingKeys.OpeningBalance, req.OpeningBalance!.Value.ToString(CultureInfo.InvariantCulture));
            if (req.MealCardOpeningBalance is { } mealCard)
                await SetAsync(db, SettingKeys.MealCardOpeningBalance, mealCard.ToString(CultureInfo.InvariantCulture));
            await SetAsync(db, SettingKeys.OpeningBalanceDate, req.StartDate!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            await db.SaveChangesAsync();
            return Results.Ok(await LoadAsync(db));
        });
    }

    public static async Task<SettingsDto> LoadAsync(AppDbContext db)
    {
        var values = await db.AppSettings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value);

        decimal Amount(string key) =>
            values.TryGetValue(key, out var v) && decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var a) ? a : 0m;
        var start = values.TryGetValue(SettingKeys.OpeningBalanceDate, out var d)
            && DateOnly.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var sd)
            ? sd
            : new DateOnly(DateTime.Today.Year, 1, 1);

        return new SettingsDto(Amount(SettingKeys.OpeningBalance), Amount(SettingKeys.MealCardOpeningBalance), start);
    }

    private static async Task SetAsync(AppDbContext db, string key, string value)
    {
        var setting = await db.AppSettings.FindAsync(key);
        if (setting is null) db.AppSettings.Add(new AppSetting { Key = key, Value = value });
        else setting.Value = value;
    }
}
