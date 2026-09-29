using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Accounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Color = table.Column<string>(type: "nvarchar(9)", maxLength: 9, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    OpeningBalance = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Accounts", x => x.Id);
                });

            // Existing databases (they have the old opening-balance settings): the fixed "Main" / "MealCard" accounts
            // become real accounts carrying their opening balances. Fresh databases get theirs from the seed.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM AppSettings WHERE [Key] IN (N'OpeningBalance', N'MealCardOpeningBalance'))
                   OR EXISTS (SELECT 1 FROM Transactions)
                BEGIN
                    INSERT INTO Accounts (Name, Kind, Color, SortOrder, IsActive, IsDefault, OpeningBalance) VALUES
                        (N'Conta à ordem', N'Bank', N'#1F497D', 0, 1, 1,
                            ISNULL((SELECT TRY_CAST([Value] AS decimal(18,2)) FROM AppSettings WHERE [Key] = N'OpeningBalance'), 0)),
                        (N'Cartão Refeição', N'MealCard', N'#B8A444', 1, 1, 0,
                            ISNULL((SELECT TRY_CAST([Value] AS decimal(18,2)) FROM AppSettings WHERE [Key] = N'MealCardOpeningBalance'), 0));
                END
                """);

            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "Transactions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE Transactions SET AccountId =
                    CASE WHEN Account = N'MealCard'
                         THEN (SELECT Id FROM Accounts WHERE Kind = N'MealCard')
                         ELSE (SELECT Id FROM Accounts WHERE IsDefault = 1)
                    END;
                DELETE FROM AppSettings WHERE [Key] IN (N'OpeningBalance', N'MealCardOpeningBalance');
                """);

            migrationBuilder.DropColumn(
                name: "Account",
                table: "Transactions");

            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "BudgetPlans",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Transactions_AccountId_Date",
                table: "Transactions",
                columns: new[] { "AccountId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_BudgetPlans_AccountId",
                table: "BudgetPlans",
                column: "AccountId");

            migrationBuilder.AddForeignKey(
                name: "FK_BudgetPlans_Accounts_AccountId",
                table: "BudgetPlans",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Transactions_Accounts_AccountId",
                table: "Transactions",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BudgetPlans_Accounts_AccountId",
                table: "BudgetPlans");

            migrationBuilder.DropForeignKey(
                name: "FK_Transactions_Accounts_AccountId",
                table: "Transactions");

            migrationBuilder.DropTable(
                name: "Accounts");

            migrationBuilder.DropIndex(
                name: "IX_Transactions_AccountId_Date",
                table: "Transactions");

            migrationBuilder.DropIndex(
                name: "IX_BudgetPlans_AccountId",
                table: "BudgetPlans");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "Transactions");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "BudgetPlans");

            migrationBuilder.AddColumn<string>(
                name: "Account",
                table: "Transactions",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Main");
        }
    }
}
