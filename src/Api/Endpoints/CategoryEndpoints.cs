using System.Text.RegularExpressions;
using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public record SubCategoryDto(int Id, int CategoryId, string Name, int SortOrder, bool IsActive, int TransactionCount);

public record CategoryDto(
    int Id, string Name, EntryType Type, string? Color, int SortOrder, bool IsActive,
    int TransactionCount, List<SubCategoryDto> SubCategories);

public record CategoryRequest(string? Name, EntryType? Type, string? Color, int? SortOrder, bool? IsActive);

public record SubCategoryRequest(int? CategoryId, string? Name, int? SortOrder, bool? IsActive);

public record ReorderRequest(List<int> Ids);

/// <summary>Query string for DELETE when the item still has transactions.</summary>
public record DeleteOptions(int? MoveToCategoryId, int? MoveToSubCategoryId, bool? DeleteTransactions);

public static partial class CategoryEndpoints
{
    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();

    public static void MapCategoryEndpoints(this RouteGroupBuilder api)
    {
        MapCategories(api.MapGroup("/categories"));
        MapSubCategories(api.MapGroup("/subcategories"));
    }

    private static void MapCategories(RouteGroupBuilder g)
    {
        g.MapGet("/", async (EntryType? type, bool? activeOnly, AppDbContext db) =>
        {
            var query = db.Categories.AsNoTracking();
            if (type is { } t) query = query.Where(c => c.Type == t);
            if (activeOnly == true) query = query.Where(c => c.IsActive);

            var list = await query
                .OrderBy(c => c.Type == EntryType.Income ? 0 : 1).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new CategoryDto(
                    c.Id, c.Name, c.Type, c.Color, c.SortOrder, c.IsActive,
                    c.Transactions.Count(),
                    c.SubCategories
                        .Where(s => activeOnly != true || s.IsActive)
                        .OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
                        .Select(s => new SubCategoryDto(s.Id, s.CategoryId, s.Name, s.SortOrder, s.IsActive, s.Transactions.Count()))
                        .ToList()))
                .ToListAsync();
            return Results.Ok(list);
        });

        g.MapGet("/{id:int}", async (int id, AppDbContext db) =>
        {
            var dto = await LoadCategoryDto(db, id);
            return dto is null ? Problems.NotFound("Categoria não encontrada.") : Results.Ok(dto);
        });

        g.MapPost("/", async (CategoryRequest req, AppDbContext db) =>
        {
            var errors = new Dictionary<string, List<string>>();
            if (req.Type is null) errors.AddError("type", "O tipo é obrigatório.");
            await ValidateCategoryAsync(req, db, null, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var type = req.Type!.Value;
            var nextOrder = await db.Categories.Where(c => c.Type == type).MaxAsync(c => (int?)c.SortOrder) ?? -1;
            var entity = new Category
            {
                Name = req.Name!.Trim(),
                Type = type,
                Color = NormalizeColor(req.Color),
                SortOrder = req.SortOrder ?? nextOrder + 1,
                IsActive = req.IsActive ?? true,
            };
            db.Categories.Add(entity);
            await db.SaveChangesAsync();
            return Results.Created($"/api/categories/{entity.Id}", await LoadCategoryDto(db, entity.Id));
        });

        g.MapPut("/{id:int}", async (int id, CategoryRequest req, AppDbContext db) =>
        {
            var entity = await db.Categories.FindAsync(id);
            if (entity is null) return Problems.NotFound("Categoria não encontrada.");

            var errors = new Dictionary<string, List<string>>();
            await ValidateCategoryAsync(req with { Type = req.Type ?? entity.Type }, db, id, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            if (req.Type is { } newType && newType != entity.Type)
            {
                if (await db.Transactions.AnyAsync(t => t.CategoryId == id))
                    return Problems.Conflict("Não é possível mudar o tipo de uma categoria que já tem transações.");
                entity.Type = newType;
            }

            // Only the category row changes; transactions keep pointing at the same Id.
            entity.Name = req.Name!.Trim();
            entity.Color = NormalizeColor(req.Color);
            if (req.SortOrder is { } order) entity.SortOrder = order;
            if (req.IsActive is { } active) entity.IsActive = active;
            await db.SaveChangesAsync();
            return Results.Ok(await LoadCategoryDto(db, id));
        });

        g.MapPost("/reorder", async (ReorderRequest req, AppDbContext db) =>
        {
            var items = await db.Categories.Where(c => req.Ids.Contains(c.Id)).ToListAsync();
            foreach (var c in items) c.SortOrder = req.Ids.IndexOf(c.Id);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        g.MapDelete("/{id:int}", async (int id, [AsParameters] DeleteOptions opt, AppDbContext db) =>
        {
            var category = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
            if (category is null) return Problems.NotFound("Categoria não encontrada.");

            var txCount = await db.Transactions.CountAsync(t => t.CategoryId == id);
            var subCount = await db.SubCategories.CountAsync(s => s.CategoryId == id);

            if (txCount > 0)
            {
                var moving = opt.MoveToCategoryId is not null;
                var deleting = opt.DeleteTransactions == true;
                if (!moving && !deleting)
                    return Problems.Conflict(
                        $"A categoria \"{category.Name}\" tem {txCount} transação(ões) associada(s).",
                        new Dictionary<string, object?> { ["transactionCount"] = txCount, ["subCategoryCount"] = subCount });
                if (moving && deleting)
                    return Problems.Validation("deleteTransactions", "Escolha mover ou apagar as transações, não ambos.");

                if (moving)
                {
                    var error = await ValidateMoveTargetAsync(db, category.Type, opt, excludeCategoryId: id, excludeSubCategoryId: null);
                    if (error is not null) return error;
                }
            }

            await using var tx = await db.Database.BeginTransactionAsync();
            if (txCount > 0 && opt.MoveToCategoryId is { } targetId)
            {
                var targetSub = opt.MoveToSubCategoryId;
                var now = DateTime.UtcNow;
                await db.Transactions.Where(t => t.CategoryId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.CategoryId, targetId)
                    .SetProperty(t => t.SubCategoryId, targetSub)
                    .SetProperty(t => t.UpdatedAt, now));
            }
            else if (txCount > 0)
            {
                await db.Transactions.Where(t => t.CategoryId == id).ExecuteDeleteAsync();
            }
            await db.SubCategories.Where(s => s.CategoryId == id).ExecuteDeleteAsync();
            await db.Categories.Where(c => c.Id == id).ExecuteDeleteAsync();
            await tx.CommitAsync();

            return Results.NoContent();
        });
    }

    private static void MapSubCategories(RouteGroupBuilder g)
    {
        g.MapGet("/", async (int? categoryId, bool? activeOnly, AppDbContext db) =>
        {
            var query = db.SubCategories.AsNoTracking();
            if (categoryId is { } cid) query = query.Where(s => s.CategoryId == cid);
            if (activeOnly == true) query = query.Where(s => s.IsActive);
            var list = await query
                .OrderBy(s => s.Category.SortOrder).ThenBy(s => s.SortOrder).ThenBy(s => s.Name)
                .Select(s => new SubCategoryDto(s.Id, s.CategoryId, s.Name, s.SortOrder, s.IsActive, s.Transactions.Count()))
                .ToListAsync();
            return Results.Ok(list);
        });

        g.MapGet("/{id:int}", async (int id, AppDbContext db) =>
        {
            var dto = await LoadSubCategoryDto(db, id);
            return dto is null ? Problems.NotFound("Subcategoria não encontrada.") : Results.Ok(dto);
        });

        g.MapPost("/", async (SubCategoryRequest req, AppDbContext db) =>
        {
            var errors = new Dictionary<string, List<string>>();
            await ValidateSubCategoryAsync(req, db, null, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var categoryId = req.CategoryId!.Value;
            var nextOrder = await db.SubCategories.Where(s => s.CategoryId == categoryId).MaxAsync(s => (int?)s.SortOrder) ?? -1;
            var entity = new SubCategory
            {
                CategoryId = categoryId,
                Name = req.Name!.Trim(),
                SortOrder = req.SortOrder ?? nextOrder + 1,
                IsActive = req.IsActive ?? true,
            };
            db.SubCategories.Add(entity);
            await db.SaveChangesAsync();
            return Results.Created($"/api/subcategories/{entity.Id}", await LoadSubCategoryDto(db, entity.Id));
        });

        g.MapPut("/{id:int}", async (int id, SubCategoryRequest req, AppDbContext db) =>
        {
            var entity = await db.SubCategories.Include(s => s.Category).FirstOrDefaultAsync(s => s.Id == id);
            if (entity is null) return Problems.NotFound("Subcategoria não encontrada.");

            var errors = new Dictionary<string, List<string>>();
            var targetCategoryId = req.CategoryId ?? entity.CategoryId;
            await ValidateSubCategoryAsync(req with { CategoryId = targetCategoryId }, db, id, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            await using var tx = await db.Database.BeginTransactionAsync();
            if (targetCategoryId != entity.CategoryId)
            {
                var target = await db.Categories.AsNoTracking().FirstAsync(c => c.Id == targetCategoryId);
                if (target.Type != entity.Category.Type)
                    return Problems.Validation("categoryId", "A categoria de destino tem de ser do mesmo tipo (Renda/Despesa).");

                // Moving a subcategory drags its transactions along to the new category.
                var now = DateTime.UtcNow;
                await db.Transactions.Where(t => t.SubCategoryId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.CategoryId, targetCategoryId)
                    .SetProperty(t => t.UpdatedAt, now));

                entity.CategoryId = targetCategoryId;
                entity.SortOrder = req.SortOrder
                    ?? (await db.SubCategories.Where(s => s.CategoryId == targetCategoryId).MaxAsync(s => (int?)s.SortOrder) ?? -1) + 1;
            }
            else if (req.SortOrder is { } order)
            {
                entity.SortOrder = order;
            }

            entity.Name = req.Name!.Trim();
            if (req.IsActive is { } active) entity.IsActive = active;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Ok(await LoadSubCategoryDto(db, id));
        });

        g.MapPost("/reorder", async (ReorderRequest req, AppDbContext db) =>
        {
            var items = await db.SubCategories.Where(s => req.Ids.Contains(s.Id)).ToListAsync();
            foreach (var s in items) s.SortOrder = req.Ids.IndexOf(s.Id);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        g.MapDelete("/{id:int}", async (int id, [AsParameters] DeleteOptions opt, AppDbContext db) =>
        {
            var sub = await db.SubCategories.AsNoTracking().Include(s => s.Category).FirstOrDefaultAsync(s => s.Id == id);
            if (sub is null) return Problems.NotFound("Subcategoria não encontrada.");

            var txCount = await db.Transactions.CountAsync(t => t.SubCategoryId == id);
            if (txCount > 0)
            {
                var moving = opt.MoveToCategoryId is not null;
                var deleting = opt.DeleteTransactions == true;
                if (!moving && !deleting)
                    return Problems.Conflict(
                        $"A subcategoria \"{sub.Name}\" tem {txCount} transação(ões) associada(s).",
                        new Dictionary<string, object?> { ["transactionCount"] = txCount });
                if (moving && deleting)
                    return Problems.Validation("deleteTransactions", "Escolha mover ou apagar as transações, não ambos.");

                if (moving)
                {
                    var error = await ValidateMoveTargetAsync(db, sub.Category.Type, opt, excludeCategoryId: null, excludeSubCategoryId: id);
                    if (error is not null) return error;
                }
            }

            await using var tx = await db.Database.BeginTransactionAsync();
            if (txCount > 0 && opt.MoveToCategoryId is { } targetId)
            {
                var targetSub = opt.MoveToSubCategoryId;
                var now = DateTime.UtcNow;
                await db.Transactions.Where(t => t.SubCategoryId == id).ExecuteUpdateAsync(s => s
                    .SetProperty(t => t.CategoryId, targetId)
                    .SetProperty(t => t.SubCategoryId, targetSub)
                    .SetProperty(t => t.UpdatedAt, now));
            }
            else if (txCount > 0)
            {
                await db.Transactions.Where(t => t.SubCategoryId == id).ExecuteDeleteAsync();
            }
            await db.SubCategories.Where(s => s.Id == id).ExecuteDeleteAsync();
            await tx.CommitAsync();

            return Results.NoContent();
        });
    }

    private static async Task<IResult?> ValidateMoveTargetAsync(
        AppDbContext db, EntryType type, DeleteOptions opt, int? excludeCategoryId, int? excludeSubCategoryId)
    {
        var target = await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == opt.MoveToCategoryId);
        if (target is null)
            return Problems.Validation("moveToCategoryId", "A categoria de destino não existe.");
        if (target.Id == excludeCategoryId)
            return Problems.Validation("moveToCategoryId", "A categoria de destino tem de ser diferente da que vai ser apagada.");
        if (target.Type != type)
            return Problems.Validation("moveToCategoryId", "A categoria de destino tem de ser do mesmo tipo (Renda/Despesa).");

        if (opt.MoveToSubCategoryId is { } subId)
        {
            if (subId == excludeSubCategoryId)
                return Problems.Validation("moveToSubCategoryId", "A subcategoria de destino tem de ser diferente da que vai ser apagada.");
            if (!await db.SubCategories.AnyAsync(s => s.Id == subId && s.CategoryId == target.Id))
                return Problems.Validation("moveToSubCategoryId", "A subcategoria de destino não pertence à categoria de destino.");
        }
        return null;
    }

    private static async Task ValidateCategoryAsync(CategoryRequest req, AppDbContext db, int? id, Dictionary<string, List<string>> errors)
    {
        var name = req.Name?.Trim();
        if (string.IsNullOrEmpty(name))
            errors.AddError("name", "O nome é obrigatório.");
        else if (name.Length > 100)
            errors.AddError("name", "O nome não pode ter mais de 100 caracteres.");
        else if (req.Type is { } type && await db.Categories.AnyAsync(c => c.Id != id && c.Type == type && c.Name == name))
            errors.AddError("name", "Já existe uma categoria com esse nome.");

        if (!string.IsNullOrWhiteSpace(req.Color) && !HexColor().IsMatch(req.Color.Trim()))
            errors.AddError("color", "A cor tem de estar no formato #RRGGBB.");
    }

    private static async Task ValidateSubCategoryAsync(SubCategoryRequest req, AppDbContext db, int? id, Dictionary<string, List<string>> errors)
    {
        if (req.CategoryId is null)
            errors.AddError("categoryId", "A categoria é obrigatória.");
        else if (!await db.Categories.AnyAsync(c => c.Id == req.CategoryId))
            errors.AddError("categoryId", "A categoria não existe.");

        var name = req.Name?.Trim();
        if (string.IsNullOrEmpty(name))
            errors.AddError("name", "O nome é obrigatório.");
        else if (name.Length > 100)
            errors.AddError("name", "O nome não pode ter mais de 100 caracteres.");
        else if (req.CategoryId is { } cid && await db.SubCategories.AnyAsync(s => s.Id != id && s.CategoryId == cid && s.Name == name))
            errors.AddError("name", "Já existe uma subcategoria com esse nome nesta categoria.");
    }

    private static string? NormalizeColor(string? color) =>
        string.IsNullOrWhiteSpace(color) ? null : color.Trim().ToUpperInvariant();

    private static Task<CategoryDto?> LoadCategoryDto(AppDbContext db, int id) =>
        db.Categories.AsNoTracking().Where(c => c.Id == id)
            .Select(c => new CategoryDto(
                c.Id, c.Name, c.Type, c.Color, c.SortOrder, c.IsActive,
                c.Transactions.Count(),
                c.SubCategories.OrderBy(s => s.SortOrder).ThenBy(s => s.Name)
                    .Select(s => new SubCategoryDto(s.Id, s.CategoryId, s.Name, s.SortOrder, s.IsActive, s.Transactions.Count()))
                    .ToList()))
            .FirstOrDefaultAsync();

    private static Task<SubCategoryDto?> LoadSubCategoryDto(AppDbContext db, int id) =>
        db.SubCategories.AsNoTracking().Where(s => s.Id == id)
            .Select(s => new SubCategoryDto(s.Id, s.CategoryId, s.Name, s.SortOrder, s.IsActive, s.Transactions.Count()))
            .FirstOrDefaultAsync();
}
