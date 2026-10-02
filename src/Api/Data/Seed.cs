using Microsoft.EntityFrameworkCore;

namespace Api.Data;

/// <summary>Initial categories, taken from the original Excel sheet "Orçamento".</summary>
public static class Seed
{
    public static async Task RunAsync(AppDbContext db)
    {
        if (!await db.Categories.AnyAsync())
        {
            var categories = new (string Name, EntryType Type, string Color, string[] Subs)[]
            {
                ("Receitas", EntryType.Income, "#1F497D",
                    ["Vencimento", "Cartão Refeição", "Prendas", "Subsídios / Bónus", "IRS", "Outros"]),
                ("Transportes", EntryType.Expense, "#4F81BD",
                    ["Mensalidade Carro", "Seguro Carro", "Manutenção Carro", "Combustível", "IUC"]),
                ("Dia a Dia", EntryType.Expense, "#D2711C",
                    ["Supermercado", "Restaurante", "Café", "Eletrónica", "Barbeiro", "Roupa"]),
                ("Lazer", EntryType.Expense, "#7A4FB5",
                    ["Cinema/concertos", "Noite", "Desporto", "Férias"]),
                ("Saúde", EntryType.Expense, "#0FA3C4",
                    ["Consultas", "Exames", "Farmácia", "Psicologia", "Outros"]),
                ("Serviços", EntryType.Expense, "#C0504D",
                    ["Renda Casa", "Condomínio", "Seguros", "Água", "Luz", "TV + NET", "Telemóvel", "Levantamentos", "Prendas", "Uber", "Poupança", "Outros"]),
            };

            var order = 0;
            foreach (var (name, type, color, subs) in categories)
            {
                db.Categories.Add(new Category
                {
                    Name = name,
                    Type = type,
                    Color = color,
                    SortOrder = order++,
                    SubCategories = subs.Select((s, i) => new SubCategory { Name = s, SortOrder = i }).ToList(),
                });
            }
        }

        // Fresh databases get a generic main account + meal card (existing ones got theirs from the migration).
        if (!await db.Accounts.AnyAsync())
        {
            db.Accounts.Add(new Account { Name = "Conta à ordem", Kind = AccountKind.Bank, Color = "#1F497D", IsDefault = true, SortOrder = 0 });
            db.Accounts.Add(new Account { Name = "Cartão Refeição", Kind = AccountKind.MealCard, Color = "#B8A444", SortOrder = 1 });
        }

        if (!await db.AppSettings.AnyAsync(s => s.Key == SettingKeys.OpeningBalanceDate))
            db.AppSettings.Add(new AppSetting
            {
                Key = SettingKeys.OpeningBalanceDate,
                Value = new DateOnly(DateTime.Today.Year, 1, 1).ToString("yyyy-MM-dd"),
            });

        await db.SaveChangesAsync();
        await SeedHoldingsAsync(db);
    }

    /// <summary>
    /// One-off (guarded by a setting, so deleting them later sticks): the "Investimentos" expense category with
    /// "Ações (XTB)" and "Fundo de emergência", each linked to a holding of the same name.
    /// </summary>
    private static async Task SeedHoldingsAsync(AppDbContext db)
    {
        if (await db.AppSettings.AnyAsync(s => s.Key == SettingKeys.HoldingsSeeded)) return;

        var category = await db.Categories.Include(c => c.SubCategories)
            .FirstOrDefaultAsync(c => c.Type == EntryType.Expense && c.Name == "Investimentos");
        if (category is null)
        {
            var nextOrder = await db.Categories.Where(c => c.Type == EntryType.Expense).MaxAsync(c => (int?)c.SortOrder) ?? -1;
            category = new Category { Name = "Investimentos", Type = EntryType.Expense, Color = "#1E8C6E", SortOrder = nextOrder + 1, IsSavings = true };
            db.Categories.Add(category);
        }

        var order = 0;
        foreach (var (name, color) in new[] { ("Ações (XTB)", "#1E8C6E"), ("Fundo de emergência", "#4F81BD") })
        {
            var holding = new Holding { Name = name, Color = color, SortOrder = order };
            db.Holdings.Add(holding);

            var sub = category.SubCategories.FirstOrDefault(s => s.Name == name);
            if (sub is null)
            {
                sub = new SubCategory { Name = name, SortOrder = category.SubCategories.Count };
                category.SubCategories.Add(sub);
            }
            sub.Holding = holding;
            order++;
        }

        db.AppSettings.Add(new AppSetting { Key = SettingKeys.HoldingsSeeded, Value = "1" });
        await db.SaveChangesAsync();
    }
}
