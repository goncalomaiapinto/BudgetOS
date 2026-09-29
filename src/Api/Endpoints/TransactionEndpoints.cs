using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public record TransactionRequest(
    DateOnly? Date,
    EntryType? Type,
    int? CategoryId,
    int? SubCategoryId,
    decimal? Amount,
    string? Description,
    int? AccountId = null);

public record TransactionDto(
    int Id,
    DateOnly Date,
    EntryType Type,
    int CategoryId,
    string CategoryName,
    string? CategoryColor,
    int? SubCategoryId,
    string? SubCategoryName,
    int AccountId,
    string AccountName,
    AccountKind AccountKind,
    string? AccountColor,
    decimal Amount,
    string? Description,
    TransactionSource Source,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record TransactionQuery(
    DateOnly? From,
    DateOnly? To,
    EntryType? Type,
    int? CategoryId,
    int? SubCategoryId,
    int? AccountId,
    string? Search,
    decimal? MinAmount,
    decimal? MaxAmount,
    string? Sort,
    int? Page,
    int? PageSize);

public record TransactionTotals(decimal Income, decimal Expense, decimal Net);

public record TransactionPage(List<TransactionDto> Items, int TotalCount, int Page, int PageSize, TransactionTotals Totals);

public static class TransactionEndpoints
{
    public static void MapTransactionEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/transactions");

        g.MapGet("/", async ([AsParameters] TransactionQuery q, AppDbContext db) =>
        {
            var query = db.Transactions.AsNoTracking().AsQueryable();

            if (q.From is { } from) query = query.Where(t => t.Date >= from);
            if (q.To is { } to) query = query.Where(t => t.Date <= to);
            if (q.Type is { } type) query = query.Where(t => t.Type == type);
            if (q.CategoryId is { } categoryId) query = query.Where(t => t.CategoryId == categoryId);
            if (q.SubCategoryId is { } subId) query = query.Where(t => t.SubCategoryId == subId);
            if (q.AccountId is { } accountId) query = query.Where(t => t.AccountId == accountId);
            if (!string.IsNullOrWhiteSpace(q.Search))
            {
                var search = q.Search.Trim();
                query = query.Where(t => t.Description != null && t.Description.Contains(search));
            }
            if (q.MinAmount is { } min) query = query.Where(t => t.Amount >= min);
            if (q.MaxAmount is { } max) query = query.Where(t => t.Amount <= max);

            // Single-row aggregate (GROUP BY a constant) so the footer totals come straight from SQL.
            var totalsRows = await query
                .GroupBy(_ => 1)
                .Select(x => new TransactionTotals(
                    x.Sum(t => t.Type == EntryType.Income ? t.Amount : 0),
                    x.Sum(t => t.Type == EntryType.Expense ? t.Amount : 0),
                    x.Sum(t => t.Type == EntryType.Income ? t.Amount : -t.Amount)))
                .ToListAsync();
            var totalCount = await query.CountAsync();
            var totals = totalsRows.FirstOrDefault() ?? new TransactionTotals(0, 0, 0);

            query = q.Sort switch
            {
                "date_asc" => query.OrderBy(t => t.Date).ThenBy(t => t.Id),
                "amount_desc" => query.OrderByDescending(t => t.Amount).ThenByDescending(t => t.Date),
                "amount_asc" => query.OrderBy(t => t.Amount).ThenByDescending(t => t.Date),
                _ => query.OrderByDescending(t => t.Date).ThenByDescending(t => t.Id),
            };

            var page = Math.Max(1, q.Page ?? 1);
            var pageSize = Math.Clamp(q.PageSize ?? 50, 1, 1000);
            var items = await query
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(ToDto)
                .ToListAsync();

            return Results.Ok(new TransactionPage(items, totalCount, page, pageSize, totals));
        });

        g.MapGet("/{id:int}", async (int id, AppDbContext db) =>
        {
            var dto = await db.Transactions.AsNoTracking().Where(t => t.Id == id).Select(ToDto).FirstOrDefaultAsync();
            return dto is null ? Problems.NotFound("Transação não encontrada.") : Results.Ok(dto);
        });

        g.MapPost("/", async (TransactionRequest req, AppDbContext db) =>
        {
            req = req with { AccountId = req.AccountId ?? await AccountEndpoints.DefaultIdAsync(db) };
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Problems.Validation(errors);

            var now = DateTime.UtcNow;
            var entity = new Transaction { CreatedAt = now };
            Apply(entity, req, now);
            db.Transactions.Add(entity);
            await db.SaveChangesAsync();

            var dto = await db.Transactions.AsNoTracking().Where(t => t.Id == entity.Id).Select(ToDto).FirstAsync();
            return Results.Created($"/api/transactions/{entity.Id}", dto);
        });

        g.MapPut("/{id:int}", async (int id, TransactionRequest req, AppDbContext db) =>
        {
            var entity = await db.Transactions.FindAsync(id);
            if (entity is null) return Problems.NotFound("Transação não encontrada.");

            req = req with { AccountId = req.AccountId ?? await AccountEndpoints.DefaultIdAsync(db) };
            var errors = await ValidateAsync(req, db);
            if (errors.Count > 0) return Problems.Validation(errors);

            Apply(entity, req, DateTime.UtcNow);
            await db.SaveChangesAsync();

            var dto = await db.Transactions.AsNoTracking().Where(t => t.Id == id).Select(ToDto).FirstAsync();
            return Results.Ok(dto);
        });

        g.MapDelete("/{id:int}", async (int id, AppDbContext db) =>
        {
            var deleted = await db.Transactions.Where(t => t.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Problems.NotFound("Transação não encontrada.") : Results.NoContent();
        });
    }

    public static readonly System.Linq.Expressions.Expression<Func<Transaction, TransactionDto>> ToDto = t =>
        new TransactionDto(
            t.Id, t.Date, t.Type,
            t.CategoryId, t.Category.Name, t.Category.Color,
            t.SubCategoryId, t.SubCategory != null ? t.SubCategory.Name : null,
            t.AccountId, t.Account.Name, t.Account.Kind, t.Account.Color, t.Amount, t.Description, t.Source, t.CreatedAt, t.UpdatedAt);

    private static void Apply(Transaction entity, TransactionRequest req, DateTime now)
    {
        entity.Date = req.Date!.Value;
        entity.Type = req.Type!.Value;
        entity.CategoryId = req.CategoryId!.Value;
        entity.SubCategoryId = req.SubCategoryId;
        entity.AccountId = req.AccountId!.Value;
        entity.Amount = req.Amount!.Value;
        entity.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();
        entity.UpdatedAt = now;
    }

    private static async Task<Dictionary<string, List<string>>> ValidateAsync(TransactionRequest req, AppDbContext db)
    {
        var errors = new Dictionary<string, List<string>>();

        if (req.Date is null) errors.AddError("date", "A data é obrigatória.");
        if (req.Type is null) errors.AddError("type", "O tipo é obrigatório.");

        if (req.Amount is not { } amount || amount <= 0)
            errors.AddError("amount", "O valor tem de ser maior que zero.");
        else if (amount != Math.Round(amount, 2))
            errors.AddError("amount", "O valor só pode ter duas casas decimais.");
        else if (amount >= 10_000_000_000m)
            errors.AddError("amount", "O valor é demasiado grande.");

        if (req.AccountId is { } accountId && !await db.Accounts.AnyAsync(a => a.Id == accountId))
            errors.AddError("accountId", "A conta não existe.");

        if (req.Description?.Trim().Length > 500)
            errors.AddError("description", "A descrição não pode ter mais de 500 caracteres.");

        if (req.CategoryId is null)
        {
            errors.AddError("categoryId", "A categoria é obrigatória.");
            return errors;
        }

        var category = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == req.CategoryId);
        if (category is null)
        {
            errors.AddError("categoryId", "A categoria não existe.");
            return errors;
        }
        if (req.Type is { } type && category.Type != type)
            errors.AddError("categoryId", "O tipo da categoria não corresponde ao tipo da transação.");

        if (req.SubCategoryId is { } subId)
        {
            var belongs = await db.SubCategories.AnyAsync(s => s.Id == subId && s.CategoryId == category.Id);
            if (!belongs) errors.AddError("subCategoryId", "A subcategoria não pertence à categoria escolhida.");
        }

        return errors;
    }
}
