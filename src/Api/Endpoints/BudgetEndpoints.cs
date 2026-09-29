using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

/// <summary>
/// One line of the month plan. <c>Projected</c> is what we expect by the end of the month:
/// the actual value for past months, otherwise the larger of planned and actual
/// (what's planned but not yet spent/received is assumed to still happen).
/// </summary>
/// <param name="AccountId">Account the line is planned on (null = the default account).</param>
public record BudgetLine(
    int CategoryId, int? SubCategoryId, string Name, bool IsActive, decimal Planned, decimal Actual, decimal Projected,
    int? AccountId = null);

/// <summary>
/// Per-account view of the month: <c>ActualNet</c> is what really moved in the account this month;
/// planned/projected ends use the lines assigned to the account.
/// Projected end = previous + actual net + what is still planned and hasn't happened yet (per line).
/// </summary>
public record BudgetAccount(
    int Id, string Name, AccountKind Kind, string? Color,
    decimal? PreviousBalance, decimal ActualNet, decimal PlannedNet, decimal? PlannedEnd, decimal? ProjectedEnd,
    decimal ActualIncome = 0, decimal ActualExpense = 0, decimal PlannedIncome = 0, decimal PlannedExpense = 0,
    decimal TransferNet = 0); // transfers in − out this month (already in ProjectedEnd, not in ActualNet)

public record BudgetGroup(
    int Id, string Name, string? Color, bool IsActive, List<BudgetLine> Lines, decimal Planned, decimal Actual, decimal Projected);

public record BudgetTotals(decimal Planned, decimal Actual, decimal Projected);

public record MonthBudget(
    int Year,
    int Month,
    string Status, // "past" | "current" | "future"
    bool HasPlan,
    decimal? PreviousBalance,
    List<BudgetGroup> Income,
    List<BudgetGroup> Expense,
    BudgetTotals IncomeTotals,
    BudgetTotals ExpenseTotals,
    decimal? PlannedEndBalance,
    decimal? ProjectedEndBalance,
    decimal? ActualEndBalance,
    int DefaultAccountId,
    List<BudgetAccount> Accounts);

public record BudgetItem(int SubCategoryId, decimal Amount, int? AccountId = null);

public record BudgetSaveRequest(List<BudgetItem>? Items);

public static class BudgetEndpoints
{
    public static void MapBudgetEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/budget");
        g.MapGet("/", GetMonth);
        g.MapPut("/", Save);
        g.MapGet("/suggestions", Suggestions);
    }

    private static async Task<IResult> GetMonth(int? year, int? month, AppDbContext db)
    {
        if (Validate(year, month) is { } error) return error;
        var (y, m) = (year!.Value, month!.Value);
        var monthStart = new DateOnly(y, m, 1);
        var monthEnd = monthStart.AddMonths(1);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var status = monthEnd <= today ? "past" : monthStart > today ? "future" : "current";

        var plans = await db.BudgetPlans
            .Where(p => p.Year == y && p.Month == m)
            .ToDictionaryAsync(p => p.SubCategoryId, p => new { p.Amount, p.AccountId });

        // Actuals aggregated in SQL; transactions without subcategory are grouped per category.
        var actuals = await db.Transactions
            .Where(t => t.Date >= monthStart && t.Date < monthEnd)
            .GroupBy(t => new { t.CategoryId, t.SubCategoryId })
            .Select(x => new { x.Key.CategoryId, x.Key.SubCategoryId, Total = x.Sum(t => t.Amount) })
            .ToListAsync();

        var categories = await db.Categories.AsNoTracking()
            .Include(c => c.SubCategories)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
            .ToListAsync();

        decimal Project(decimal planned, decimal actual) => status == "past" ? actual : Math.Max(planned, actual);

        List<BudgetGroup> BuildGroups(EntryType type)
        {
            var groups = new List<BudgetGroup>();
            foreach (var cat in categories.Where(c => c.Type == type))
            {
                var lines = new List<BudgetLine>();
                foreach (var sub in cat.SubCategories.OrderBy(s => s.SortOrder).ThenBy(s => s.Name))
                {
                    var plan = plans.GetValueOrDefault(sub.Id);
                    var planned = plan?.Amount ?? 0;
                    var actual = actuals.Where(a => a.SubCategoryId == sub.Id).Sum(a => a.Total);
                    // Inactive subcategories only show up when they still carry numbers this month.
                    if (!sub.IsActive && planned == 0 && actual == 0) continue;
                    lines.Add(new BudgetLine(cat.Id, sub.Id, sub.Name, sub.IsActive, planned, actual, Project(planned, actual), plan?.AccountId));
                }

                var loose = actuals.Where(a => a.CategoryId == cat.Id && a.SubCategoryId == null).Sum(a => a.Total);
                if (loose != 0)
                    lines.Add(new BudgetLine(cat.Id, null, "(sem subcategoria)", true, 0, loose, loose));

                if (!cat.IsActive && lines.All(l => l.Planned == 0 && l.Actual == 0)) continue;
                groups.Add(new BudgetGroup(cat.Id, cat.Name, cat.Color, cat.IsActive, lines,
                    lines.Sum(l => l.Planned), lines.Sum(l => l.Actual), lines.Sum(l => l.Projected)));
            }
            return groups;
        }

        var income = BuildGroups(EntryType.Income);
        var expense = BuildGroups(EntryType.Expense);
        var incomeTotals = Totals(income);
        var expenseTotals = Totals(expense);

        // Same "Saldo Anterior" as the monthly grid: opening balance + net of every month since the start month.
        var settings = await SettingsEndpoints.LoadAsync(db);
        var startMonth = ReportEndpoints.FirstOfMonth(settings.StartDate);
        var beforeStart = monthStart < startMonth;
        decimal? previous = beforeStart
            ? null
            : await SettingsEndpoints.OpeningAsync(db, null) + await ReportEndpoints.SignedSumAsync(db.Transactions, startMonth, monthStart);

        // ---- per account ----
        var defaultAccountId = await AccountEndpoints.DefaultIdAsync(db);
        var netBefore = beforeStart ? [] : await db.Transactions
            .Where(t => t.Date >= startMonth && t.Date < monthStart)
            .GroupBy(t => t.AccountId)
            .Select(x => new { x.Key, Net = x.Sum(t => t.Type == EntryType.Income ? t.Amount : -t.Amount) })
            .ToDictionaryAsync(x => x.Key, x => x.Net);
        var transfersBefore = beforeStart ? [] : await TransferEndpoints.NetPerAccountAsync(db, startMonth, monthStart);
        var transfersThisMonth = await TransferEndpoints.NetPerAccountAsync(db, monthStart, monthEnd);
        var thisMonth = await db.Transactions
            .Where(t => t.Date >= monthStart && t.Date < monthEnd)
            .GroupBy(t => t.AccountId)
            .Select(x => new
            {
                x.Key,
                Income = x.Sum(t => t.Type == EntryType.Income ? t.Amount : 0),
                Expense = x.Sum(t => t.Type == EntryType.Expense ? t.Amount : 0),
            })
            .ToDictionaryAsync(x => x.Key);

        var allLines = income.SelectMany(g => g.Lines.Select(l => (Line: l, Sign: 1m)))
            .Concat(expense.SelectMany(g => g.Lines.Select(l => (Line: l, Sign: -1m))))
            .ToList();
        var accounts = new List<BudgetAccount>();
        foreach (var a in await db.Accounts.AsNoTracking().OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync())
        {
            var mine = allLines.Where(x => (x.Line.AccountId ?? defaultAccountId) == a.Id).ToList();
            var plannedIncome = mine.Where(x => x.Sign > 0).Sum(x => x.Line.Planned);
            var plannedExpense = mine.Where(x => x.Sign < 0).Sum(x => x.Line.Planned);
            var plannedNet = plannedIncome - plannedExpense;
            // What is planned on this account but hasn't happened yet (nothing left once the month is closed).
            var remaining = status == "past" ? 0 : mine.Sum(x => x.Sign * Math.Max(x.Line.Planned - x.Line.Actual, 0));
            var actual = thisMonth.GetValueOrDefault(a.Id);
            var actualIncome = actual?.Income ?? 0;
            var actualExpense = actual?.Expense ?? 0;
            var actualNet = actualIncome - actualExpense;
            decimal? prev = beforeStart ? null
                : a.OpeningBalance + netBefore.GetValueOrDefault(a.Id) + transfersBefore.GetValueOrDefault(a.Id);
            var transferNet = transfersThisMonth.GetValueOrDefault(a.Id);
            if (!a.IsActive && plannedNet == 0 && actualNet == 0 && transferNet == 0 && (prev ?? 0) == 0) continue;
            accounts.Add(new BudgetAccount(a.Id, a.Name, a.Kind, a.Color, prev, actualNet, plannedNet,
                prev + plannedNet, prev + actualNet + transferNet + remaining, actualIncome, actualExpense, plannedIncome, plannedExpense,
                transferNet));
        }

        return Results.Ok(new MonthBudget(
            y, m, status, plans.Count > 0, previous,
            income, expense, incomeTotals, expenseTotals,
            previous + incomeTotals.Planned - expenseTotals.Planned,
            previous + incomeTotals.Projected - expenseTotals.Projected,
            previous + incomeTotals.Actual - expenseTotals.Actual,
            defaultAccountId, accounts));
    }

    /// <summary>Replaces the whole plan of a month. Amounts of 0 remove the line.</summary>
    private static async Task<IResult> Save(int? year, int? month, BudgetSaveRequest req, AppDbContext db)
    {
        if (Validate(year, month) is { } error) return error;
        var (y, m) = (year!.Value, month!.Value);
        var items = req.Items ?? [];

        var errors = new Dictionary<string, List<string>>();
        if (items.Any(i => i.Amount < 0 || i.Amount != Math.Round(i.Amount, 2) || i.Amount >= 10_000_000_000m))
            errors.AddError("items", "Os valores previstos têm de ser positivos e ter no máximo duas casas decimais.");
        if (items.GroupBy(i => i.SubCategoryId).Any(x => x.Count() > 1))
            errors.AddError("items", "Há subcategorias repetidas.");
        var ids = items.Select(i => i.SubCategoryId).Distinct().ToList();
        var existing = await db.SubCategories.CountAsync(s => ids.Contains(s.Id));
        if (existing != ids.Count)
            errors.AddError("items", "Há subcategorias que não existem.");
        var accountIds = items.Where(i => i.AccountId != null).Select(i => i.AccountId!.Value).Distinct().ToList();
        if (await db.Accounts.CountAsync(a => accountIds.Contains(a.Id)) != accountIds.Count)
            errors.AddError("items", "Há contas que não existem.");
        if (errors.Count > 0) return Problems.Validation(errors);

        await using var tx = await db.Database.BeginTransactionAsync();
        await db.BudgetPlans.Where(p => p.Year == y && p.Month == m).ExecuteDeleteAsync();
        db.BudgetPlans.AddRange(items
            .Where(i => i.Amount > 0)
            .Select(i => new BudgetPlan { Year = y, Month = m, SubCategoryId = i.SubCategoryId, Amount = i.Amount, AccountId = i.AccountId }));
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        return await GetMonth(y, m, db);
    }

    /// <summary>
    /// Values to pre-fill a month's plan:
    /// "plan" = previous month's plan, "actual" = previous month's actuals, "average" = average actual of the last 3 months.
    /// </summary>
    private static async Task<IResult> Suggestions(int? year, int? month, string? source, AppDbContext db)
    {
        if (Validate(year, month) is { } error) return error;
        var monthStart = new DateOnly(year!.Value, month!.Value, 1);
        var prev = monthStart.AddMonths(-1);

        List<BudgetItem> items;
        switch (source)
        {
            case "plan":
                items = await db.BudgetPlans
                    .Where(p => p.Year == prev.Year && p.Month == prev.Month)
                    .Select(p => new BudgetItem(p.SubCategoryId, p.Amount, p.AccountId))
                    .ToListAsync();
                break;
            case "actual":
            case "average":
                var months = source == "actual" ? 1 : 3;
                var from = monthStart.AddMonths(-months);
                var sums = await db.Transactions
                    .Where(t => t.Date >= from && t.Date < monthStart && t.SubCategoryId != null)
                    .GroupBy(t => t.SubCategoryId!.Value)
                    .Select(x => new { SubCategoryId = x.Key, Total = x.Sum(t => t.Amount) })
                    .ToListAsync();
                items = sums.Select(s => new BudgetItem(s.SubCategoryId, Math.Round(s.Total / months, 2))).ToList();
                break;
            default:
                return Problems.Validation("source", "Origem inválida (plan, actual ou average).");
        }
        return Results.Ok(items);
    }

    private static BudgetTotals Totals(List<BudgetGroup> groups) =>
        new(groups.Sum(g => g.Planned), groups.Sum(g => g.Actual), groups.Sum(g => g.Projected));

    private static IResult? Validate(int? year, int? month)
    {
        if (year is null or < 1900 or > 2999) return Problems.Validation("year", "Ano inválido.");
        if (month is null or < 1 or > 12) return Problems.Validation("month", "Mês inválido.");
        return null;
    }
}
