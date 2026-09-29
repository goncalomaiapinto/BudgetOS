using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public record TransferRequest(DateOnly? Date, int? FromAccountId, int? ToAccountId, decimal? Amount, string? Description);

public record TransferDto(
    int Id, DateOnly Date,
    int FromAccountId, string FromAccountName, AccountKind FromAccountKind, string? FromAccountColor,
    int ToAccountId, string ToAccountName, AccountKind ToAccountKind, string? ToAccountColor,
    decimal Amount, string? Description, DateTime CreatedAt, DateTime UpdatedAt);

public static class TransferEndpoints
{
    public static void MapTransferEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/transfers");

        // Not paged: there are only a handful per month. accountId matches either side.
        g.MapGet("/", async (DateOnly? from, DateOnly? to, int? accountId, string? search, AppDbContext db) =>
        {
            var query = db.Transfers.AsNoTracking();
            if (from is { } f) query = query.Where(t => t.Date >= f);
            if (to is { } tt) query = query.Where(t => t.Date <= tt);
            if (accountId is { } a) query = query.Where(t => t.FromAccountId == a || t.ToAccountId == a);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                query = query.Where(t => t.Description != null && t.Description.Contains(s));
            }
            return Results.Ok(await query.OrderByDescending(t => t.Date).ThenByDescending(t => t.Id).Select(ToDto).ToListAsync());
        });

        g.MapGet("/{id:int}", async (int id, AppDbContext db) =>
        {
            var dto = await db.Transfers.AsNoTracking().Where(t => t.Id == id).Select(ToDto).FirstOrDefaultAsync();
            return dto is null ? Problems.NotFound("Transferência não encontrada.") : Results.Ok(dto);
        });

        g.MapPost("/", async (TransferRequest req, AppDbContext db) =>
        {
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Problems.Validation(errors);
            var now = DateTime.UtcNow;
            var entity = new Transfer { CreatedAt = now };
            Apply(entity, req, now);
            db.Transfers.Add(entity);
            await db.SaveChangesAsync();
            return Results.Created($"/api/transfers/{entity.Id}",
                await db.Transfers.AsNoTracking().Where(t => t.Id == entity.Id).Select(ToDto).FirstAsync());
        });

        g.MapPut("/{id:int}", async (int id, TransferRequest req, AppDbContext db) =>
        {
            var entity = await db.Transfers.FindAsync(id);
            if (entity is null) return Problems.NotFound("Transferência não encontrada.");
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Problems.Validation(errors);
            Apply(entity, req, DateTime.UtcNow);
            await db.SaveChangesAsync();
            return Results.Ok(await db.Transfers.AsNoTracking().Where(t => t.Id == id).Select(ToDto).FirstAsync());
        });

        g.MapDelete("/{id:int}", async (int id, AppDbContext db) =>
        {
            var deleted = await db.Transfers.Where(t => t.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Problems.NotFound("Transferência não encontrada.") : Results.NoContent();
        });
    }

    private static readonly System.Linq.Expressions.Expression<Func<Transfer, TransferDto>> ToDto = t =>
        new TransferDto(
            t.Id, t.Date,
            t.FromAccountId, t.FromAccount.Name, t.FromAccount.Kind, t.FromAccount.Color,
            t.ToAccountId, t.ToAccount.Name, t.ToAccount.Kind, t.ToAccount.Color,
            t.Amount, t.Description, t.CreatedAt, t.UpdatedAt);

    private static void Apply(Transfer entity, TransferRequest req, DateTime now)
    {
        entity.Date = req.Date!.Value;
        entity.FromAccountId = req.FromAccountId!.Value;
        entity.ToAccountId = req.ToAccountId!.Value;
        entity.Amount = req.Amount!.Value;
        entity.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();
        entity.UpdatedAt = now;
    }

    private static async Task<Dictionary<string, List<string>>> ValidateAsync(TransferRequest req, AppDbContext db)
    {
        var errors = new Dictionary<string, List<string>>();
        if (req.Date is null) errors.AddError("date", "A data é obrigatória.");
        if (req.Amount is not { } amount || amount <= 0) errors.AddError("amount", "O valor tem de ser maior que zero.");
        else if (amount != Math.Round(amount, 2)) errors.AddError("amount", "O valor só pode ter duas casas decimais.");
        else if (amount >= 10_000_000_000m) errors.AddError("amount", "O valor é demasiado grande.");
        if (req.Description?.Trim().Length > 500) errors.AddError("description", "A descrição não pode ter mais de 500 caracteres.");

        if (req.FromAccountId is null) errors.AddError("fromAccountId", "Escolha a conta de origem.");
        else if (!await db.Accounts.AnyAsync(a => a.Id == req.FromAccountId)) errors.AddError("fromAccountId", "A conta de origem não existe.");
        if (req.ToAccountId is null) errors.AddError("toAccountId", "Escolha a conta de destino.");
        else if (!await db.Accounts.AnyAsync(a => a.Id == req.ToAccountId)) errors.AddError("toAccountId", "A conta de destino não existe.");
        if (req.FromAccountId is not null && req.FromAccountId == req.ToAccountId)
            errors.AddError("toAccountId", "A conta de destino tem de ser diferente da de origem.");
        return errors;
    }

    /// <summary>Net transfers (in − out) for one account in [from, to).</summary>
    public static async Task<decimal> NetAsync(AppDbContext db, int accountId, DateOnly from, DateOnly to)
    {
        if (from >= to) return 0;
        return await db.Transfers
            .Where(t => t.Date >= from && t.Date < to && (t.ToAccountId == accountId || t.FromAccountId == accountId))
            .SumAsync(t => t.ToAccountId == accountId ? t.Amount : -t.Amount);
    }

    /// <summary>Net transfers (in − out) per account in [from, to), aggregated in SQL.</summary>
    public static async Task<Dictionary<int, decimal>> NetPerAccountAsync(AppDbContext db, DateOnly from, DateOnly to)
    {
        if (from >= to) return [];
        var range = db.Transfers.Where(t => t.Date >= from && t.Date < to);
        var incoming = await range.GroupBy(t => t.ToAccountId).Select(x => new { x.Key, Sum = x.Sum(t => t.Amount) }).ToListAsync();
        var outgoing = await range.GroupBy(t => t.FromAccountId).Select(x => new { x.Key, Sum = x.Sum(t => t.Amount) }).ToListAsync();
        var result = new Dictionary<int, decimal>();
        foreach (var i in incoming) result[i.Key] = result.GetValueOrDefault(i.Key) + i.Sum;
        foreach (var o in outgoing) result[o.Key] = result.GetValueOrDefault(o.Key) - o.Sum;
        return result;
    }

    /// <summary>Net transfers (in − out) of one account per (year, month) in [from, to).</summary>
    public static async Task<Dictionary<(int Year, int Month), decimal>> MonthlyNetAsync(AppDbContext db, int accountId, DateOnly from, DateOnly to)
    {
        if (from >= to) return [];
        return await db.Transfers
            .Where(t => t.Date >= from && t.Date < to && (t.ToAccountId == accountId || t.FromAccountId == accountId))
            .GroupBy(t => new { t.Date.Year, t.Date.Month })
            .Select(x => new { x.Key.Year, x.Key.Month, Net = x.Sum(t => t.ToAccountId == accountId ? t.Amount : -t.Amount) })
            .ToDictionaryAsync(x => (x.Year, x.Month), x => x.Net);
    }
}
