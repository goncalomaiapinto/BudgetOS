using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<SubCategory> SubCategories => Set<SubCategory>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<BudgetPlan> BudgetPlans => Set<BudgetPlan>();
    public DbSet<Holding> Holdings => Set<Holding>();
    public DbSet<HoldingValuation> HoldingValuations => Set<HoldingValuation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Category>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Color).HasMaxLength(9);
        });

        b.Entity<SubCategory>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.HasOne(x => x.Category).WithMany(x => x.SubCategories)
                .HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            // Deleting a holding just unlinks its subcategories.
            e.HasOne(x => x.Holding).WithMany(x => x.SubCategories)
                .HasForeignKey(x => x.HoldingId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Holding>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.Property(x => x.Color).HasMaxLength(9);
        });

        b.Entity<HoldingValuation>(e =>
        {
            e.Property(x => x.Value).HasPrecision(18, 2);
            e.Property(x => x.Note).HasMaxLength(200);
            e.HasOne(x => x.Holding).WithMany(x => x.Valuations)
                .HasForeignKey(x => x.HoldingId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.HoldingId, x.Date }).IsUnique();
        });

        b.Entity<Transaction>(e =>
        {
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(10)
                .HasDefaultValue(TransactionSource.Manual).HasSentinel(TransactionSource.Manual);
            e.Property(x => x.Account).HasConversion<string>().HasMaxLength(10)
                .HasDefaultValue(PaymentAccount.Main).HasSentinel(PaymentAccount.Main);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.ImportHash).HasMaxLength(128);

            // Transactions are never removed implicitly: category deletes are handled explicitly by the API.
            e.HasOne(x => x.Category).WithMany(x => x.Transactions)
                .HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.SubCategory).WithMany(x => x.Transactions)
                .HasForeignKey(x => x.SubCategoryId).OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => x.Date);
            e.HasIndex(x => new { x.CategoryId, x.Date });
            e.HasIndex(x => x.ImportHash).IsUnique().HasFilter("[ImportHash] IS NOT NULL");
        });

        b.Entity<BudgetPlan>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(18, 2);
            // A plan belongs to its subcategory: it follows it when moved and goes away when it is deleted.
            e.HasOne(x => x.SubCategory).WithMany()
                .HasForeignKey(x => x.SubCategoryId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.Year, x.Month, x.SubCategoryId }).IsUnique();
        });

        b.Entity<AppSetting>(e =>
        {
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(100);
            e.Property(x => x.Value).HasMaxLength(1000);
        });
    }
}
