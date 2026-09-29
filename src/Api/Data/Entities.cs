namespace Api.Data;

public enum EntryType
{
    Income,
    Expense
}

/// <summary>Where the money comes from / goes to. Only two fixed accounts for now.</summary>
public enum PaymentAccount
{
    Main,     // Conta à ordem
    MealCard  // Cartão Refeição
}

public enum TransactionSource
{
    Manual,
    Import
}

public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public EntryType Type { get; set; }
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public List<SubCategory> SubCategories { get; set; } = [];
    public List<Transaction> Transactions { get; set; } = [];
}

public class SubCategory
{
    public int Id { get; set; }
    public int CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// When set, money booked in this subcategory goes to (expense) or comes from (income) that holding,
    /// e.g. "Investimentos / Ações (XTB)".
    /// </summary>
    public int? HoldingId { get; set; }
    public Holding? Holding { get; set; }

    public List<Transaction> Transactions { get; set; } = [];
}

/// <summary>Something whose value is updated by hand from time to time (brokerage account, emergency fund…).</summary>
public class Holding
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Color { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public List<SubCategory> SubCategories { get; set; } = [];
    public List<HoldingValuation> Valuations { get; set; } = [];
}

/// <summary>Value of a holding on a given date, as read from the broker/bank.</summary>
public class HoldingValuation
{
    public int Id { get; set; }
    public int HoldingId { get; set; }
    public Holding Holding { get; set; } = null!;
    public DateOnly Date { get; set; }
    public decimal Value { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Transaction
{
    public int Id { get; set; }
    public DateOnly Date { get; set; }
    public EntryType Type { get; set; }
    public int CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public int? SubCategoryId { get; set; }
    public SubCategory? SubCategory { get; set; }

    public PaymentAccount Account { get; set; } = PaymentAccount.Main;

    /// <summary>Always positive; the sign comes from <see cref="Type"/>.</summary>
    public decimal Amount { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public TransactionSource Source { get; set; } = TransactionSource.Manual;

    /// <summary>Hash of the bank statement line, used to avoid duplicates when importing (phase 2).</summary>
    public string? ImportHash { get; set; }
}

/// <summary>Planned amount (income or expense, per the category type) for one subcategory in one month.</summary>
public class BudgetPlan
{
    public int Id { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public int SubCategoryId { get; set; }
    public SubCategory SubCategory { get; set; } = null!;
    public decimal Amount { get; set; }
}

public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public static class SettingKeys
{
    public const string OpeningBalance = "OpeningBalance";
    public const string OpeningBalanceDate = "OpeningBalanceDate";
    public const string MealCardOpeningBalance = "MealCardOpeningBalance";
    public const string HoldingsSeeded = "HoldingsSeeded";
}
