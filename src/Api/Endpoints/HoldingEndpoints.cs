using System.Text.RegularExpressions;
using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public record LinkedSubCategory(int Id, string Name, int CategoryId, string CategoryName, EntryType Type);

/// <summary>
/// A value update. <c>Change</c> is the growth since the previous update with the money put in (or taken out)
/// in between removed: value − previous value − net invested in between.
/// <c>ChangePercent</c> = change ÷ (previous value + net invested in between).
/// </summary>
public record ValuationDto(
    int Id, DateOnly Date, decimal Value, string? Note, decimal InvestedAtDate,
    DateOnly? PreviousDate = null, decimal? PreviousValue = null, decimal? Change = null, decimal? ChangePercent = null);

/// <summary>
/// Invested = expenses booked in the linked subcategories minus income booked there (withdrawals).
/// Gain is measured at the last valuation; the estimated value adds what was invested after it (at cost).
/// </summary>
public record HoldingDto(
    int Id,
    string Name,
    string? Color,
    int SortOrder,
    bool IsActive,
    List<LinkedSubCategory> SubCategories,
    decimal Invested,
    ValuationDto? LastValuation,
    decimal? Gain,
    decimal? GainPercent,
    decimal InvestedSinceValuation,
    decimal EstimatedValue);

public record HoldingPoint(DateOnly Date, decimal Invested);

public record HoldingHistory(List<ValuationDto> Valuations, List<HoldingPoint> Invested);

public record HoldingRequest(string? Name, string? Color, bool? IsActive, List<int>? SubCategoryIds);

public record ValuationRequest(DateOnly? Date, decimal? Value, string? Note);

public static partial class HoldingEndpoints
{
    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();

    public static void MapHoldingEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/holdings");

        g.MapGet("/", async (AppDbContext db) =>
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var ids = await db.Holdings.OrderBy(h => h.SortOrder).ThenBy(h => h.Name).Select(h => h.Id).ToListAsync();
            var list = new List<HoldingDto>();
            foreach (var id in ids) list.Add((await SummarizeAsync(db, id, today))!);
            return Results.Ok(list);
        });

        g.MapGet("/{id:int}/history", async (int id, AppDbContext db) =>
        {
            if (!await db.Holdings.AnyAsync(h => h.Id == id)) return Problems.NotFound("Investimento não encontrado.");

            // Net invested per day (aggregated in SQL), turned into a running total.
            var perDay = await Contributions(db, id)
                .GroupBy(t => t.Date)
                .Select(x => new { Date = x.Key, Amount = x.Sum(t => t.Type == EntryType.Expense ? t.Amount : -t.Amount) })
                .OrderBy(x => x.Date)
                .ToListAsync();
            var points = new List<HoldingPoint>();
            var running = 0m;
            foreach (var d in perDay) points.Add(new HoldingPoint(d.Date, running += d.Amount));

            var valuations = await db.HoldingValuations.Where(v => v.HoldingId == id).OrderBy(v => v.Date).ToListAsync();
            var dtos = new List<ValuationDto>();
            foreach (var v in valuations)
            {
                var investedAt = points.LastOrDefault(p => p.Date <= v.Date)?.Invested ?? 0;
                var dto = new ValuationDto(v.Id, v.Date, v.Value, v.Note, investedAt);
                dtos.Add(dtos.Count == 0 ? dto : WithChange(dto, dtos[^1]));
            }

            return Results.Ok(new HoldingHistory(dtos, points));
        });

        g.MapPost("/", async (HoldingRequest req, AppDbContext db) =>
        {
            var errors = await ValidateAsync(req, db, null);
            if (errors.Count > 0) return Problems.Validation(errors);

            var nextOrder = await db.Holdings.MaxAsync(h => (int?)h.SortOrder) ?? -1;
            var holding = new Holding
            {
                Name = req.Name!.Trim(),
                Color = NormalizeColor(req.Color),
                SortOrder = nextOrder + 1,
                IsActive = req.IsActive ?? true,
            };
            db.Holdings.Add(holding);
            await db.SaveChangesAsync();
            await LinkAsync(db, holding.Id, req.SubCategoryIds);
            return Results.Created($"/api/holdings/{holding.Id}", await SummarizeAsync(db, holding.Id, DateOnly.FromDateTime(DateTime.Today)));
        });

        g.MapPut("/{id:int}", async (int id, HoldingRequest req, AppDbContext db) =>
        {
            var holding = await db.Holdings.FindAsync(id);
            if (holding is null) return Problems.NotFound("Investimento não encontrado.");

            var errors = await ValidateAsync(req, db, id);
            if (errors.Count > 0) return Problems.Validation(errors);

            holding.Name = req.Name!.Trim();
            holding.Color = NormalizeColor(req.Color);
            if (req.IsActive is { } active) holding.IsActive = active;
            await db.SaveChangesAsync();
            if (req.SubCategoryIds is not null) await LinkAsync(db, id, req.SubCategoryIds);
            return Results.Ok(await SummarizeAsync(db, id, DateOnly.FromDateTime(DateTime.Today)));
        });

        g.MapDelete("/{id:int}", async (int id, AppDbContext db) =>
        {
            // Valuations go with it (cascade); linked subcategories and their transactions stay, just unlinked.
            var deleted = await db.Holdings.Where(h => h.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Problems.NotFound("Investimento não encontrado.") : Results.NoContent();
        });

        // ---- valuations ("atualizar valor") ----

        g.MapPost("/{id:int}/valuations", async (int id, ValuationRequest req, AppDbContext db) =>
        {
            if (!await db.Holdings.AnyAsync(h => h.Id == id)) return Problems.NotFound("Investimento não encontrado.");
            var errors = ValidateValuation(req);
            if (errors.Count > 0) return Problems.Validation(errors);

            // One value per day: updating twice on the same day replaces it.
            var date = req.Date!.Value;
            var valuation = await db.HoldingValuations.FirstOrDefaultAsync(v => v.HoldingId == id && v.Date == date);
            if (valuation is null)
            {
                valuation = new HoldingValuation { HoldingId = id, Date = date, CreatedAt = DateTime.UtcNow };
                db.HoldingValuations.Add(valuation);
            }
            valuation.Value = req.Value!.Value;
            valuation.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
            await db.SaveChangesAsync();
            return Results.Ok(await SummarizeAsync(db, id, DateOnly.FromDateTime(DateTime.Today)));
        });

        api.MapPut("/valuations/{id:int}", async (int id, ValuationRequest req, AppDbContext db) =>
        {
            var valuation = await db.HoldingValuations.FindAsync(id);
            if (valuation is null) return Problems.NotFound("Atualização não encontrada.");
            var errors = ValidateValuation(req);
            if (req.Date is { } d && d != valuation.Date &&
                await db.HoldingValuations.AnyAsync(v => v.HoldingId == valuation.HoldingId && v.Date == d && v.Id != id))
                errors.AddError("date", "Já existe uma atualização nesse dia.");
            if (errors.Count > 0) return Problems.Validation(errors);

            valuation.Date = req.Date!.Value;
            valuation.Value = req.Value!.Value;
            valuation.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        api.MapDelete("/valuations/{id:int}", async (int id, AppDbContext db) =>
        {
            var deleted = await db.HoldingValuations.Where(v => v.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Problems.NotFound("Atualização não encontrada.") : Results.NoContent();
        });
    }

    /// <summary>Transactions booked in subcategories linked to the holding.</summary>
    private static IQueryable<Transaction> Contributions(AppDbContext db, int holdingId) =>
        db.Transactions.Where(t => t.SubCategory != null && t.SubCategory.HoldingId == holdingId);

    private static Task<decimal> InvestedUntilAsync(AppDbContext db, int holdingId, DateOnly date) =>
        Contributions(db, holdingId)
            .Where(t => t.Date <= date)
            .SumAsync(t => t.Type == EntryType.Expense ? t.Amount : -t.Amount);

    /// <summary>State of a holding as of <paramref name="asOf"/> (inclusive).</summary>
    public static async Task<HoldingDto?> SummarizeAsync(AppDbContext db, int id, DateOnly asOf)
    {
        var holding = await db.Holdings.AsNoTracking()
            .Where(h => h.Id == id)
            .Select(h => new
            {
                h.Id, h.Name, h.Color, h.SortOrder, h.IsActive,
                Subs = h.SubCategories
                    .OrderBy(s => s.Category.SortOrder).ThenBy(s => s.SortOrder)
                    .Select(s => new LinkedSubCategory(s.Id, s.Name, s.CategoryId, s.Category.Name, s.Category.Type))
                    .ToList(),
            })
            .FirstOrDefaultAsync();
        if (holding is null) return null;

        var invested = await InvestedUntilAsync(db, id, asOf);
        var last = await db.HoldingValuations.AsNoTracking()
            .Where(v => v.HoldingId == id && v.Date <= asOf)
            .OrderByDescending(v => v.Date)
            .FirstOrDefaultAsync();

        ValuationDto? lastDto = null;
        decimal? gain = null, gainPercent = null;
        var since = invested;
        var estimated = invested;
        if (last is not null)
        {
            var investedAtValuation = await InvestedUntilAsync(db, id, last.Date);
            lastDto = new ValuationDto(last.Id, last.Date, last.Value, last.Note, investedAtValuation);
            var previous = await db.HoldingValuations.AsNoTracking()
                .Where(v => v.HoldingId == id && v.Date < last.Date)
                .OrderByDescending(v => v.Date)
                .FirstOrDefaultAsync();
            if (previous is not null)
            {
                var investedAtPrevious = await InvestedUntilAsync(db, id, previous.Date);
                lastDto = WithChange(lastDto,
                    new ValuationDto(previous.Id, previous.Date, previous.Value, previous.Note, investedAtPrevious));
            }
            gain = last.Value - investedAtValuation;
            gainPercent = investedAtValuation > 0 ? Math.Round(gain.Value / investedAtValuation, 4, MidpointRounding.AwayFromZero) : null;
            since = invested - investedAtValuation;
            estimated = last.Value + since;
        }

        return new HoldingDto(holding.Id, holding.Name, holding.Color, holding.SortOrder, holding.IsActive,
            holding.Subs, invested, lastDto, gain, gainPercent, since, estimated);
    }

    private static ValuationDto WithChange(ValuationDto current, ValuationDto previous)
    {
        var putIn = current.InvestedAtDate - previous.InvestedAtDate;
        var change = current.Value - previous.Value - putIn;
        var basis = previous.Value + putIn;
        return current with
        {
            PreviousDate = previous.Date,
            PreviousValue = previous.Value,
            Change = change,
            ChangePercent = basis > 0 ? Math.Round(change / basis, 4, MidpointRounding.AwayFromZero) : null,
        };
    }

    /// <summary>Sum of the estimated value of every holding as of a date (for the dashboard).</summary>
    public static async Task<decimal> TotalValueAsync(AppDbContext db, DateOnly asOf)
    {
        var total = 0m;
        foreach (var id in await db.Holdings.Select(h => h.Id).ToListAsync())
            total += (await SummarizeAsync(db, id, asOf))!.EstimatedValue;
        return total;
    }

    /// <summary>Makes <paramref name="subCategoryIds"/> the exact set of subcategories linked to the holding.</summary>
    private static async Task LinkAsync(AppDbContext db, int holdingId, List<int>? subCategoryIds)
    {
        var ids = subCategoryIds ?? [];
        await db.SubCategories.Where(s => s.HoldingId == holdingId && !ids.Contains(s.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.HoldingId, (int?)null));
        await db.SubCategories.Where(s => ids.Contains(s.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.HoldingId, holdingId));
    }

    private static async Task<Dictionary<string, List<string>>> ValidateAsync(HoldingRequest req, AppDbContext db, int? id)
    {
        var errors = new Dictionary<string, List<string>>();
        var name = req.Name?.Trim();
        if (string.IsNullOrEmpty(name)) errors.AddError("name", "O nome é obrigatório.");
        else if (name.Length > 100) errors.AddError("name", "O nome não pode ter mais de 100 caracteres.");
        else if (await db.Holdings.AnyAsync(h => h.Id != id && h.Name == name))
            errors.AddError("name", "Já existe um investimento com esse nome.");

        if (!string.IsNullOrWhiteSpace(req.Color) && !HexColor().IsMatch(req.Color.Trim()))
            errors.AddError("color", "A cor tem de estar no formato #RRGGBB.");

        if (req.SubCategoryIds is { Count: > 0 } ids)
        {
            var found = await db.SubCategories.Where(s => ids.Contains(s.Id))
                .Select(s => new { s.Id, s.Name, s.HoldingId, HoldingName = s.Holding != null ? s.Holding.Name : null })
                .ToListAsync();
            if (found.Count != ids.Distinct().Count())
                errors.AddError("subCategoryIds", "Há subcategorias que não existem.");
            foreach (var s in found.Where(s => s.HoldingId != null && s.HoldingId != id))
                errors.AddError("subCategoryIds", $"A subcategoria \"{s.Name}\" já está ligada a \"{s.HoldingName}\".");
        }
        return errors;
    }

    private static Dictionary<string, List<string>> ValidateValuation(ValuationRequest req)
    {
        var errors = new Dictionary<string, List<string>>();
        if (req.Date is null) errors.AddError("date", "A data é obrigatória.");
        else if (req.Date > DateOnly.FromDateTime(DateTime.Today)) errors.AddError("date", "A data não pode ser no futuro.");
        if (req.Value is not { } value || value < 0) errors.AddError("value", "O valor tem de ser zero ou positivo.");
        else if (value != Math.Round(value, 2)) errors.AddError("value", "O valor só pode ter duas casas decimais.");
        if (req.Note?.Trim().Length > 200) errors.AddError("note", "A nota não pode ter mais de 200 caracteres.");
        return errors;
    }

    private static string? NormalizeColor(string? color) =>
        string.IsNullOrWhiteSpace(color) ? null : color.Trim().ToUpperInvariant();
}
