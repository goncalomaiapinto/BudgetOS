using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTransactionAccount : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Account",
                table: "Transactions",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Main");

            // Income booked as "Renda / Cartão Refeição" goes into the meal card.
            migrationBuilder.Sql("""
                UPDATE t SET t.Account = 'MealCard'
                FROM Transactions t
                JOIN SubCategories s ON s.Id = t.SubCategoryId
                JOIN Categories c ON c.Id = s.CategoryId
                WHERE c.Type = 'Income' AND s.Name = N'Cartão Refeição';
                """);

            // "Supermercado (cartão refeição)" becomes "Supermercado" paid with the meal card; the old subcategory is deactivated.
            migrationBuilder.Sql("""
                UPDATE t SET t.SubCategoryId = sup.Id, t.Account = 'MealCard'
                FROM Transactions t
                JOIN SubCategories old ON old.Id = t.SubCategoryId
                JOIN SubCategories sup ON sup.CategoryId = old.CategoryId AND sup.Name = N'Supermercado'
                WHERE old.Name = N'Supermercado (cartão refeição)';

                UPDATE SubCategories SET IsActive = 0 WHERE Name = N'Supermercado (cartão refeição)';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Account",
                table: "Transactions");
        }
    }
}
