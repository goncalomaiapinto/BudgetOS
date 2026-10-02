using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCategoryIsSavings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSavings",
                table: "Categories",
                type: "bit",
                nullable: false,
                defaultValue: false);

            // Existing data: the investments category (and any category feeding a holding) is savings, not consumption.
            migrationBuilder.Sql("""
                UPDATE Categories SET IsSavings = 1
                WHERE Type = N'Expense'
                  AND (Name = N'Investimentos' OR Id IN (SELECT CategoryId FROM SubCategories WHERE HoldingId IS NOT NULL));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSavings",
                table: "Categories");
        }
    }
}
