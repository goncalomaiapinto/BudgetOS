using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

// ---- Monthly grid (the Excel-like view) ----

public record GridRow(int? SubCategoryId, string Name, bool IsActive, decimal[] Months, decimal Total);

public record GridCategory(int Id, string Name, string? Color, bool IsActive, List<GridRow> Rows, decimal[] Months, decimal Total);

public record GridSection(EntryType Type, List<GridCategory> Categories, decimal[] Months, decimal Total);

public record MonthlyGrid(
    int Year,
    DateOnly StartMonth,
    GridSection Income,
    GridSection Expense,
    decimal?[] PreviousBalance,
    decimal[] Net,
    decimal?[] EndBalance,
    // Only when no account filter is applied: the "Saldo Anterior" split per account.
    decimal?[]? PreviousBalanceMain = null,
    decimal?[]? PreviousBalanceMealCard = null);

// ---- Dashboard ----

public record MonthSummary(int Year, int Month, decimal Income, decimal Expense, decimal Net, decimal? Balance, decimal? SavingsRate);

public record CategoryAmount(int CategoryId, string Name, string? Color, decimal Amount, decimal Percent);

public record SubCategoryAmount(int CategoryId, string CategoryName, string? CategoryColor, int? SubCategoryId, string Name, decimal Amount);

/// <summary>Balance at the end of the selected month, per account (null before the start date).</summary>
public record AccountBalances(decimal? Main, decimal? MealCard);

public record Dashboard(
    MonthSummary Current,
    AccountBalances AccountBalances,
    decimal Investments, // estimated value of all holdings at the end of the month

    MonthSummary Previous,
    List<MonthSummary> Series,
    List<CategoryAmount> ExpensesByCategory,
    List<SubCategoryAmount> TopSubCategories,
    List<TransactionDto> LatestTransactions);

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/reports");
        g.MapGet("/monthly-grid", GetMonthlyGrid);
        g.MapGet("/dashboard", GetDashboard);
    }

    private static async Task<IResult> GetMonthlyGrid(int? year, PaymentAccount? account, AppDbContext db)
    {
        var y = year ?? DateTime.Today.Year;
        if (y is < 1900 or > 2999) return Problems.Validation("year", "Ano inválido.");

        var settings = await SettingsEndpoints.LoadAsync(db);
        var startMonth = FirstOfMonth(settings.StartDate);
        var yearStart = new DateOnly(y, 1, 1);
        var yearEnd = yearStart.AddYears(1);

        // Optional account filter (Conta à ordem / Cartão Refeição); balances then use that account's opening balance.
        var transactions = db.Transactions.AsQueryable();
        if (account is { } acc) transactions = transactions.Where(t => t.Account == acc);

        // One aggregated query for all cells of the year (runs as GROUP BY in SQL Server).
        var cells = await transactions
            .Where(t => t.Date >= yearStart && t.Date < yearEnd)
            .GroupBy(t => new { t.Type, t.CategoryId, t.SubCategoryId, t.Date.Month })
            .Select(x => new { x.Key.Type, x.Key.CategoryId, x.Key.SubCategoryId, x.Key.Month, Total = x.Sum(t => t.Amount) })
            .ToListAsync();

        var categories = await db.Categories.AsNoTracking()
            .Include(c => c.SubCategories)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
            .ToListAsync();

        GridSection BuildSection(EntryType type)
        {
            var sectionCells = cells.Where(c => c.Type == type).ToList();
            var result = new List<GridCategory>();

            foreach (var cat in categories.Where(c => c.Type == type))
            {
                var catCells = sectionCells.Where(c => c.CategoryId == cat.Id).ToList();
                if (!cat.IsActive && catCells.Count == 0) continue;

                var rows = new List<GridRow>();
                foreach (var sub in cat.SubCategories.OrderBy(s => s.SortOrder).ThenBy(s => s.Name))
                {
                    var months = ToMonths(catCells.Where(c => c.SubCategoryId == sub.Id).Select(c => (c.Month, c.Total)));
                    if (!sub.IsActive && months.All(m => m == 0)) continue;
                    rows.Add(new GridRow(sub.Id, sub.Name, sub.IsActive, months, months.Sum()));
                }

                var loose = ToMonths(catCells.Where(c => c.SubCategoryId == null).Select(c => (c.Month, c.Total)));
                if (loose.Any(m => m != 0))
                    rows.Add(new GridRow(null, "(sem subcategoria)", true, loose, loose.Sum()));

                var catMonths = ToMonths(catCells.Select(c => (c.Month, c.Total)));
                result.Add(new GridCategory(cat.Id, cat.Name, cat.Color, cat.IsActive, rows, catMonths, catMonths.Sum()));
            }

            var totals = ToMonths(sectionCells.Select(c => (c.Month, c.Total)));
            return new GridSection(type, result, totals, totals.Sum());
        }

        var income = BuildSection(EntryType.Income);
        var expense = BuildSection(EntryType.Expense);
        var net = Enumerable.Range(0, 12).Select(i => income.Months[i] - expense.Months[i]).ToArray();

        // Balance only counts from the month of the start date onwards (that month's "Saldo Anterior" is the opening balance).
        async Task<(decimal?[] Previous, decimal?[] End)> Balances(IQueryable<Transaction> source, decimal opening)
        {
            var countedFrom = yearStart > startMonth ? yearStart : startMonth;
            var netBefore = await SignedSumAsync(source, startMonth, yearStart);
            var countedNet = await MonthlyNetAsync(source, countedFrom, yearEnd);

            var previous = new decimal?[12];
            var end = new decimal?[12];
            decimal? running = null;
            for (var m = 1; m <= 12; m++)
            {
                var first = new DateOnly(y, m, 1);
                if (first < startMonth) continue;
                running ??= opening + netBefore;
                previous[m - 1] = running;
                running += countedNet.GetValueOrDefault((y, m));
                end[m - 1] = running;
            }
            return (previous, end);
        }

        var (previous, end) = await Balances(transactions, settings.OpeningFor(account));
        decimal?[]? previousMain = null, previousMealCard = null;
        if (account is null)
        {
            previousMain = (await Balances(db.Transactions.Where(t => t.Account == PaymentAccount.Main),
                settings.OpeningFor(PaymentAccount.Main))).Previous;
            previousMealCard = (await Balances(db.Transactions.Where(t => t.Account == PaymentAccount.MealCard),
                settings.OpeningFor(PaymentAccount.MealCard))).Previous;
        }

        return Results.Ok(new MonthlyGrid(y, startMonth, income, expense, previous, net, end, previousMain, previousMealCard));
    }

    private static async Task<IResult> GetDashboard(int? year, int? month, AppDbContext db)
    {
        var today = DateTime.Today;
        var y = year ?? today.Year;
        var m = month ?? today.Month;
        if (y is < 1900 or > 2999) return Problems.Validation("year", "Ano inválido.");
        if (m is < 1 or > 12) return Problems.Validation("month", "Mês inválido.");

        var settings = await SettingsEndpoints.LoadAsync(db);
        var startMonth = FirstOfMonth(settings.StartDate);
        var monthStart = new DateOnly(y, m, 1);
        var monthEnd = monthStart.AddMonths(1);
        var seriesStart = monthStart.AddMonths(-11);

        var perMonth = await db.Transactions
            .Where(t => t.Date >= seriesStart && t.Date < monthEnd)
            .GroupBy(t => new { t.Date.Year, t.Date.Month })
            .Select(x => new
            {
                x.Key.Year,
                x.Key.Month,
                Income = x.Sum(t => t.Type == EntryType.Income ? t.Amount : 0),
                Expense = x.Sum(t => t.Type == EntryType.Expense ? t.Amount : 0),
            })
            .ToDictionaryAsync(x => (x.Year, x.Month));

        var countedFrom = seriesStart > startMonth ? seriesStart : startMonth;
        var countedNet = await MonthlyNetAsync(db.Transactions, countedFrom, monthEnd);
        var netBefore = await SignedSumAsync(db.Transactions, startMonth, seriesStart);

        var series = new List<MonthSummary>();
        decimal? running = null;
        for (var d = seriesStart; d < monthEnd; d = d.AddMonths(1))
        {
            var key = (d.Year, d.Month);
            var income = perMonth.TryGetValue(key, out var pm) ? pm.Income : 0;
            var expense = pm?.Expense ?? 0;
            if (d >= startMonth)
            {
                running ??= settings.OpeningFor(null) + netBefore;
                running += countedNet.GetValueOrDefault(key);
            }
            var net = income - expense;
            series.Add(new MonthSummary(d.Year, d.Month, income, expense, net, running,
                income > 0 ? Math.Round(net / income, 4) : null));
        }

        async Task<decimal?> BalanceAt(PaymentAccount acc) => monthEnd <= startMonth
            ? null
            : settings.OpeningFor(acc) + await SignedSumAsync(db.Transactions.Where(t => t.Account == acc), startMonth, monthEnd);
        var accountBalances = new AccountBalances(await BalanceAt(PaymentAccount.Main), await BalanceAt(PaymentAccount.MealCard));
        var todayDate = DateOnly.FromDateTime(today);
        var lastDay = monthEnd.AddDays(-1);
        var investments = await HoldingEndpoints.TotalValueAsync(db, lastDay < todayDate ? lastDay : todayDate);

        var byCategory = await db.Transactions
            .Where(t => t.Type == EntryType.Expense && t.Date >= monthStart && t.Date < monthEnd)
            .GroupBy(t => new { t.CategoryId, t.Category.Name, t.Category.Color })
            .Select(x => new { x.Key.CategoryId, x.Key.Name, x.Key.Color, Amount = x.Sum(t => t.Amount) })
            .OrderByDescending(x => x.Amount)
            .ToListAsync();
        var expenseTotal = byCategory.Sum(x => x.Amount);
        var expensesByCategory = byCategory
            .Select(x => new CategoryAmount(x.CategoryId, x.Name, x.Color, x.Amount,
                expenseTotal > 0 ? Math.Round(x.Amount / expenseTotal, 4) : 0))
            .ToList();

        var top = await db.Transactions
            .Where(t => t.Type == EntryType.Expense && t.Date >= monthStart && t.Date < monthEnd)
            .GroupBy(t => new
            {
                t.CategoryId,
                CategoryName = t.Category.Name,
                t.Category.Color,
                t.SubCategoryId,
                SubName = t.SubCategory != null ? t.SubCategory.Name : null,
            })
            .Select(x => new { x.Key, Amount = x.Sum(t => t.Amount) })
            .OrderByDescending(x => x.Amount)
            .Take(5)
            .ToListAsync();
        var topSubCategories = top
            .Select(x => new SubCategoryAmount(x.Key.CategoryId, x.Key.CategoryName, x.Key.Color, x.Key.SubCategoryId,
                x.Key.SubName ?? $"{x.Key.CategoryName} (sem subcategoria)", x.Amount))
            .ToList();

        var latest = await db.Transactions.AsNoTracking()
            .Where(t => t.Date < monthEnd)
            .OrderByDescending(t => t.Date).ThenByDescending(t => t.Id)
            .Take(10)
            .Select(TransactionEndpoints.ToDto)
            .ToListAsync();

        return Results.Ok(new Dashboard(series[^1], accountBalances, investments, series[^2], series, expensesByCategory, topSubCategories, latest));
    }

    internal static DateOnly FirstOfMonth(DateOnly d) => new(d.Year, d.Month, 1);

    private static decimal[] ToMonths(IEnumerable<(int Month, decimal Total)> values)
    {
        var months = new decimal[12];
        foreach (var (month, total) in values) months[month - 1] += total;
        return months;
    }

    /// <summary>Income minus expense for transactions in [from, to).</summary>
    internal static async Task<decimal> SignedSumAsync(IQueryable<Transaction> transactions, DateOnly from, DateOnly to)
    {
        if (from >= to) return 0;
        return await transactions
            .Where(t => t.Date >= from && t.Date < to)
            .SumAsync(t => t.Type == EntryType.Income ? t.Amount : -t.Amount);
    }

    /// <summary>Net (income − expense) per (year, month) for transactions in [from, to).</summary>
    private static async Task<Dictionary<(int Year, int Month), decimal>> MonthlyNetAsync(IQueryable<Transaction> transactions, DateOnly from, DateOnly to)
    {
        if (from >= to) return [];
        return await transactions
            .Where(t => t.Date >= from && t.Date < to)
            .GroupBy(t => new { t.Date.Year, t.Date.Month })
            .Select(x => new { x.Key.Year, x.Key.Month, Net = x.Sum(t => t.Type == EntryType.Income ? t.Amount : -t.Amount) })
            .ToDictionaryAsync(x => (x.Year, x.Month), x => x.Net);
    }
}
