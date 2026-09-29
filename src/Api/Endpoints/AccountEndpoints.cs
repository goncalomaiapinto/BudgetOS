using System.Text.RegularExpressions;
using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

/// <param name="Balance">Current balance: opening balance + every transaction since the start month.</param>
public record AccountDto(
    int Id, string Name, AccountKind Kind, string? Color, int SortOrder, bool IsActive, bool IsDefault,
    decimal OpeningBalance, decimal Balance, int TransactionCount, int TransferCount = 0);

public record AccountRequest(string? Name, AccountKind? Kind, string? Color, bool? IsActive, bool? IsDefault, decimal? OpeningBalance);

public static partial class AccountEndpoints
{
    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();

    public static void MapAccountEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/accounts");

        g.MapGet("/", async (AppDbContext db) => Results.Ok(await ListAsync(db)));

        g.MapPost("/", async (AccountRequest req, AppDbContext db) =>
        {
            var errors = await ValidateAsync(req, db, null);
            if (errors.Count > 0) return Problems.Validation(errors);

            var account = new Account { SortOrder = (await db.Accounts.MaxAsync(a => (int?)a.SortOrder) ?? -1) + 1 };
            Apply(account, req);
            // The first account is always the default one.
            if (!await db.Accounts.AnyAsync()) account.IsDefault = true;
            db.Accounts.Add(account);
            await db.SaveChangesAsync();
            await EnsureSingleDefaultAsync(db, account.IsDefault ? account.Id : null);
            return Results.Created($"/api/accounts/{account.Id}", (await ListAsync(db)).First(a => a.Id == account.Id));
        });

        g.MapPut("/{id:int}", async (int id, AccountRequest req, AppDbContext db) =>
        {
            var account = await db.Accounts.FindAsync(id);
            if (account is null) return Problems.NotFound("Conta não encontrada.");
            var errors = await ValidateAsync(req, db, id);
            if (account.IsDefault && req.IsActive == false)
                errors.AddError("isActive", "A conta principal não pode ser desativada. Escolha outra como principal primeiro.");
            if (account.IsDefault && req.IsDefault == false)
                errors.AddError("isDefault", "Tem de haver uma conta principal: marque outra como principal.");
            if (errors.Count > 0) return Problems.Validation(errors);

            Apply(account, req);
            await db.SaveChangesAsync();
            await EnsureSingleDefaultAsync(db, account.IsDefault ? account.Id : null);
            return Results.Ok((await ListAsync(db)).First(a => a.Id == id));
        });

        g.MapPost("/reorder", async (ReorderRequest req, AppDbContext db) =>
        {
            var items = await db.Accounts.Where(a => req.Ids.Contains(a.Id)).ToListAsync();
            foreach (var a in items) a.SortOrder = req.Ids.IndexOf(a.Id);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Accounts with transactions can only be deleted by moving them to another account first.
        g.MapDelete("/{id:int}", async (int id, int? moveToAccountId, AppDbContext db) =>
        {
            var account = await db.Accounts.FindAsync(id);
            if (account is null) return Problems.NotFound("Conta não encontrada.");
            if (account.IsDefault)
                return Problems.Conflict("A conta principal não pode ser apagada. Escolha outra como principal primeiro.");

            var count = await db.Transactions.CountAsync(t => t.AccountId == id);
            var transfers = await db.Transfers.CountAsync(t => t.FromAccountId == id || t.ToAccountId == id);
            if (count + transfers > 0 && moveToAccountId is null)
                return Problems.Conflict($"A conta \"{account.Name}\" tem {count} transação(ões) e {transfers} transferência(s).",
                    new Dictionary<string, object?> { ["transactionCount"] = count, ["transferCount"] = transfers });
            if (moveToAccountId is { } target && (target == id || !await db.Accounts.AnyAsync(a => a.Id == target)))
                return Problems.Validation("moveToAccountId", "Conta de destino inválida.");

            await using var tx = await db.Database.BeginTransactionAsync();
            if (moveToAccountId is { } to)
            {
                var now = DateTime.UtcNow;
                await db.Transactions.Where(t => t.AccountId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.AccountId, to)
                    .SetProperty(t => t.UpdatedAt, now));
                // Transfers between this account and the target would become "to itself": they simply disappear.
                await db.Transfers.Where(t => (t.FromAccountId == id && t.ToAccountId == to) || (t.FromAccountId == to && t.ToAccountId == id))
                    .ExecuteDeleteAsync();
                await db.Transfers.Where(t => t.FromAccountId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.FromAccountId, to).SetProperty(t => t.UpdatedAt, now));
                await db.Transfers.Where(t => t.ToAccountId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.ToAccountId, to).SetProperty(t => t.UpdatedAt, now));
            }
            // Plans pointing at it fall back to the default account (FK is SET NULL).
            await db.Accounts.Where(a => a.Id == id).ExecuteDeleteAsync();
            await tx.CommitAsync();
            return Results.NoContent();
        });
    }

    public static async Task<List<AccountDto>> ListAsync(AppDbContext db)
    {
        var settings = await SettingsEndpoints.LoadAsync(db);
        var start = ReportEndpoints.FirstOfMonth(settings.StartDate);
        var transfers = await TransferEndpoints.NetPerAccountAsync(db, start, DateOnly.MaxValue);
        var transferCounts = await db.Transfers
            .Select(t => t.FromAccountId).Concat(db.Transfers.Select(t => t.ToAccountId))
            .GroupBy(id => id).Select(x => new { x.Key, Count = x.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        var list = await db.Accounts.AsNoTracking()
            .OrderBy(a => a.SortOrder).ThenBy(a => a.Name)
            .Select(a => new AccountDto(
                a.Id, a.Name, a.Kind, a.Color, a.SortOrder, a.IsActive, a.IsDefault, a.OpeningBalance,
                a.OpeningBalance + a.Transactions
                    .Where(t => t.Date >= start)
                    .Sum(t => t.Type == EntryType.Income ? t.Amount : -t.Amount),
                a.Transactions.Count()))
            .ToListAsync();
        return list
            .Select(a => a with
            {
                Balance = a.Balance + transfers.GetValueOrDefault(a.Id),
                TransferCount = transferCounts.GetValueOrDefault(a.Id),
            })
            .ToList();
    }

    /// <summary>Id of the default account (there is always one).</summary>
    public static async Task<int> DefaultIdAsync(AppDbContext db) =>
        await db.Accounts.Where(a => a.IsDefault).Select(a => (int?)a.Id).FirstOrDefaultAsync()
        ?? await db.Accounts.OrderBy(a => a.SortOrder).Select(a => a.Id).FirstAsync();

    private static void Apply(Account account, AccountRequest req)
    {
        account.Name = req.Name!.Trim();
        if (req.Kind is { } kind) account.Kind = kind;
        account.Color = string.IsNullOrWhiteSpace(req.Color) ? null : req.Color.Trim().ToUpperInvariant();
        if (req.IsActive is { } active) account.IsActive = active;
        if (req.IsDefault == true) { account.IsDefault = true; account.IsActive = true; }
        if (req.OpeningBalance is { } opening) account.OpeningBalance = opening;
    }

    private static async Task EnsureSingleDefaultAsync(AppDbContext db, int? newDefaultId)
    {
        if (newDefaultId is { } id)
            await db.Accounts.Where(a => a.Id != id && a.IsDefault).ExecuteUpdateAsync(s => s.SetProperty(a => a.IsDefault, false));
    }

    private static async Task<Dictionary<string, List<string>>> ValidateAsync(AccountRequest req, AppDbContext db, int? id)
    {
        var errors = new Dictionary<string, List<string>>();
        var name = req.Name?.Trim();
        if (string.IsNullOrEmpty(name)) errors.AddError("name", "O nome é obrigatório.");
        else if (name.Length > 100) errors.AddError("name", "O nome não pode ter mais de 100 caracteres.");
        else if (await db.Accounts.AnyAsync(a => a.Id != id && a.Name == name))
            errors.AddError("name", "Já existe uma conta com esse nome.");
        if (!string.IsNullOrWhiteSpace(req.Color) && !HexColor().IsMatch(req.Color.Trim()))
            errors.AddError("color", "A cor tem de estar no formato #RRGGBB.");
        if (req.OpeningBalance is { } o && o != Math.Round(o, 2))
            errors.AddError("openingBalance", "O saldo inicial só pode ter duas casas decimais.");
        return errors;
    }
}
