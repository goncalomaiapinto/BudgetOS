# Orçamento Pessoal

Aplicação pessoal, **100% local**, para registar quanto ganho e quanto gasto por mês. Substitui a folha Excel
`OrcamentoPessoal.xlsx` que usei durante anos e mantém o seu aspeto: secção **RENDA** a azul, **DESPESAS** a
vermelho e totais a verde. A isso junta um dashboard, uma lista de transações com filtros e uma gestão de
categorias.

**O que a app não faz:**

- **Não tem ligação a bancos.** Não acede a contas bancárias nem a APIs de bancos e não precisa de credenciais.
  Todas as transações são inseridas à mão (a importação de extratos está no roadmap).
- **Não está exposta na rede.** A API só escuta em `localhost` e não tem autenticação, por ser de uso pessoal.
- **Não envia dados para lado nenhum.** Os dados ficam numa base de dados SQL Server local.

---

## Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Instalação e arranque](#instalação-e-arranque)
   - [App sempre ligada (instalada)](#app-sempre-ligada-instalada)
3. [Configuração da base de dados](#configuração-da-base-de-dados)
4. [Estrutura e arquitetura](#estrutura-e-arquitetura)
5. [Modelo de dados](#modelo-de-dados)
6. [API](#api)
7. [Ecrãs e atalhos](#ecrãs-e-atalhos)
8. [Saldo Anterior e saldo inicial](#saldo-anterior-e-saldo-inicial)
   - [Cartão Refeição](#cartão-refeição)
9. [Backup e restauro](#backup-e-restauro)
10. [Categorias](#categorias)
11. [Roadmap / Fase 2](#roadmap--fase-2)
12. [Troubleshooting](#troubleshooting)

---

## Pré-requisitos

| Ferramenta | Versão | Como confirmar |
|---|---|---|
| .NET SDK | **10.x** (LTS) | `dotnet --list-sdks` → deve aparecer uma linha `10.0.xxx` |
| Node.js | **20 ou superior** (testado com 24) | `node -v` |
| npm | vem com o Node | `npm -v` |
| SQL Server | LocalDB, Express ou Developer | `sqllocaldb info` (LocalDB) ou SSMS |
| sqlcmd | opcional (só para `backup-db.cmd`) | `sqlcmd -?` |

Neste PC está a ser usado o **SQL Server LocalDB** (`(localdb)\MSSQLLocalDB`, SQL Server 2025), que vem com o
Visual Studio e o SSMS. Para confirmar que responde:

```cmd
sqllocaldb info MSSQLLocalDB
sqlcmd -S "(localdb)\MSSQLLocalDB" -E -Q "SELECT @@VERSION"
```

O LocalDB arranca sozinho na primeira ligação, por isso não há nenhum serviço a manter ligado.

---

## Instalação e arranque

Todos os scripts estão na raiz do projeto e funcionam com **duplo clique**, mesmo com espaços no caminho.

| Script | O que faz |
|---|---|
| `setup.cmd` | Primeira instalação: verifica se existem `dotnet` (SDK 10) e `node`, e diz o que falta. Depois faz `dotnet tool restore` (instala o `dotnet-ef`), `dotnet restore`, `npm install` e aplica as migrations à BD. Pode ser corrido várias vezes sem problema. |
| `start.cmd` | Abre duas janelas, **"OrcamentoPessoal - API"** e **"OrcamentoPessoal - Web"**. Espera que a API responda e abre o browser em http://localhost:5173. Se a API já estiver a correr, só abre o browser. |
| `stop.cmd` | Fecha as duas janelas abertas pelo `start.cmd` e os processos filhos (dotnet, node). Só mexe nas janelas lançadas pelo `start.cmd`: identifica-as pela linha de comando, por isso não fecha outros terminais. |
| `backup-db.cmd` | Faz `BACKUP DATABASE` para `backups\OrcamentoPessoal_AAAAMMDD_HHMMSS.bak`. |
| `publish.cmd` | Compila o frontend e a API para a pasta `app\` (versão "instalada", um só processo na porta **5180**). Se a app instalada estiver a correr, pára-a e volta a arrancá-la. |
| `install-autostart.cmd` | Publica (se preciso) e cria a tarefa agendada que arranca a app **sem janela** sempre que inicia sessão no Windows. |
| `uninstall-autostart.cmd` | Pára a app instalada e remove a tarefa agendada. Não toca nos dados. |

| Serviço | URL |
|---|---|
| Frontend (Vite, desenvolvimento) | http://localhost:5173 |
| API (desenvolvimento) | http://localhost:5100/api (ex.: http://localhost:5100/api/health) |
| **App instalada** (frontend + API) | **http://localhost:5180** |

O frontend faz proxy de `/api` para a API, por isso no dia a dia não há CORS envolvido (a API aceita, ainda
assim, CORS de `localhost:5173`).

### App sempre ligada (instalada)

Para uso diário, a app corre sozinha em segundo plano e abre-se como qualquer programa do Windows.

1. **Instalar:** duplo clique em **`install-autostart.cmd`**. Isto faz três coisas:
   - publica a app para `app\`: o frontend compilado é servido pela própria API, por isso não é preciso Node nem
     Vite;
   - cria no Agendador de Tarefas a tarefa **"Orcamento Pessoal"**, que arranca `app\Api.exe` ao iniciar sessão,
     sem janela;
   - arranca-a e abre http://localhost:5180.
2. **Transformar em "aplicação"** (uma só vez), para ficar no Menu Iniciar e na barra de tarefas, numa janela
   própria sem barra de endereços:
   - **Edge:** menu `…` → *Aplicações* → *Instalar este site como aplicação*.
   - **Chrome:** ícone de instalar na barra de endereços (ou menu → *Transmitir, guardar e partilhar* → *Instalar
     página como app*).
   - Depois, botão direito no ícone da barra de tarefas → **Afixar**. No Edge, em `edge://apps`, pode também ativar
     *Iniciar automaticamente ao iniciar sessão*.
   - Só é possível instalar porque o endereço é `localhost`: os browsers apenas instalam apps de `https://` ou de
     `localhost`.

Como funciona por dentro:

| | |
|---|---|
| Processo | `app\Api.exe`, compilado como aplicação sem consola (`WinExe`); ~100 MB de memória |
| Porta | 5180, só em `localhost`. Não colide com o desenvolvimento (5100/5173), que pode continuar a usar. |
| Ambiente | `Production` (`appsettings.Production.json`); overrides locais em `app\appsettings.Production.local.json` |
| Arranque | Tarefa agendada com dois gatilhos: ao iniciar sessão, e um **watchdog a cada 5 minutos**. Se a app parar, volta sozinha; se já estiver a correr, o watchdog não faz nada. Corre com a sua conta, sem pedir password nem direitos de administrador. |
| Logs | `app\logs\orcamento-AAAAMMDD.log` (guardados 30 dias) |
| Migrations | Aplicadas sozinhas no arranque, com um **backup automático antes** (`backups\…_auto_antes-migration_….bak`) |
| Backup semanal | Enquanto a app corre, se o backup mais recente em `backups\` tiver mais de 7 dias, faz um novo (`…_auto_semanal_….bak`). Guarda os 10 automáticos mais recentes; os manuais (`backup-db.cmd`) nunca são apagados. |

**Porquê uma tarefa agendada e não um serviço do Windows?** O LocalDB é uma instância por utilizador. Um serviço a
correr como sistema não a veria. A tarefa corre com a sua conta ao iniciar sessão, o que chega para uma app
pessoal.

**Atualizar depois de mudar o código:** corra **`publish.cmd`**. Pára a app instalada, publica e volta a
arrancá-la; a app instalada no browser apanha a nova versão sozinha.

**Parar de vez:** `uninstall-autostart.cmd`. A pasta `app\` e a base de dados ficam; pode apagar `app\` à mão.

### Arrancar à mão (desenvolvimento)

```cmd
cd src\Api
dotnet run            :: API em http://localhost:5100 (ambiente Development)

cd src\web
npm run dev           :: frontend em http://localhost:5173
```

Em **Development**, a API aplica as migrations pendentes ao arrancar. Em qualquer ambiente, cria as categorias
iniciais se a tabela estiver vazia.

---

## Configuração da base de dados

A connection string está em `src\Api\appsettings.Development.json` (e igual em `appsettings.json`):

```json
{
  "ConnectionStrings": {
    "Default": "Server=(localdb)\\MSSQLLocalDB;Database=OrcamentoPessoal;Trusted_Connection=True;TrustServerCertificate=True"
  }
}
```

Usa autenticação Windows (`Trusted_Connection=True`) e a base de dados **OrcamentoPessoal**, que é criada pelas
migrations.

### Mudar de instância SQL

Para usar, por exemplo, uma instância SQL Server Express ou a instância por omissão:

1. Crie o ficheiro `src\Api\appsettings.Development.local.json`. O `.gitignore` ignora-o e ele sobrepõe-se ao
   `appsettings.Development.json`:
   ```json
   {
     "ConnectionStrings": {
       "Default": "Server=localhost\\SQLEXPRESS;Database=OrcamentoPessoal;Trusted_Connection=True;TrustServerCertificate=True"
     }
   }
   ```
   Exemplos de `Server=`: `localhost` (instância por omissão), `localhost\SQLEXPRESS`, `.\SQLEXPRESS`,
   `(localdb)\MSSQLLocalDB`.
2. Corra `setup.cmd` (ou `dotnet ef database update --project src\Api\Api.csproj`) para criar a BD na nova
   instância.
3. Atualize `SQL_INSTANCE` no topo de `backup-db.cmd`.
4. Se quiser levar os dados existentes, faça antes um backup e restaure-o na nova instância (ver
   [Backup e restauro](#backup-e-restauro)).

---

## Estrutura e arquitetura

```
/
├─ src/
│  ├─ Api/                       ASP.NET Core 10 (minimal APIs) + EF Core 10
│  │  ├─ Program.cs              arranque: Kestrel só em localhost (5100 dev / 5180 instalada), migrations + seed, serve o frontend
│  │  ├─ Hosting/                backups (antes de migrations e semanal) e log em ficheiro da app instalada
│  │  ├─ Data/
│  │  │  ├─ Entities.cs          Category, SubCategory, Transaction, AppSetting
│  │  │  ├─ AppDbContext.cs      mapeamento, índices, FKs
│  │  │  ├─ Seed.cs              categorias iniciais (as do Excel)
│  │  │  └─ Migrations/          migrations do EF Core
│  │  └─ Endpoints/              um ficheiro por recurso (transactions, categories, reports, settings)
│  └─ web/                       Vite + React 19 + TypeScript + Tailwind CSS 4 + Recharts
│     └─ src/
│        ├─ lib/                 api.ts (cliente tipado), format.ts (pt-PT), app-context.tsx (estado global)
│        ├─ components/          Modal, TransactionModal, DateInput, ConfirmDialog, Toasts, ...
│        └─ pages/               Dashboard, Orçamento, Transações, Categorias, Definições
├─ backups/                      backups da BD (ignorado pelo git)
├─ dotnet-tools.json             ferramenta local dotnet-ef
├─ app/                         versão publicada/instalada (gerada por publish.cmd; ignorada pelo git)
├─ scripts/autostart.ps1        tarefa agendada (usada pelos .cmd de instalação)
├─ setup.cmd · start.cmd · stop.cmd · backup-db.cmd
├─ publish.cmd · install-autostart.cmd · uninstall-autostart.cmd
└─ README.md
```

```
 Browser ──► http://localhost:5173 (Vite, React)
                 │  /api/* (proxy)
                 ▼
            http://localhost:5100 (ASP.NET Core, só loopback)
                 │  EF Core (as agregações correm em SQL: GROUP BY/SUM)
                 ▼
            SQL Server  (localdb)\MSSQLLocalDB  ·  BD OrcamentoPessoal
```

Decisões de arquitetura: não há camadas extra (repositórios, CQRS). Os endpoints usam o `DbContext`
diretamente. Os relatórios (grelha e dashboard) são calculados com `GroupBy`/`Sum` traduzidos para SQL, e só se
monta em memória a forma final do JSON. Os enums (`Income`/`Expense`, `Manual`/`Import`) são guardados como texto,
para ficarem legíveis no SSMS.

---

## Modelo de dados

**Categories**

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| Name | nvarchar(100) | único por tipo |
| Type | `Income` \| `Expense` | Renda ou Despesa |
| Color | `#RRGGBB`, opcional | usada nos gráficos e listas |
| SortOrder | int | ordem na grelha e nos selects |
| IsActive | bit | `0` esconde a categoria nos selects de nova transação e mantém o histórico |

**SubCategories**

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| CategoryId | int | FK → Categories |
| Name | nvarchar(100) | único dentro da categoria |
| SortOrder, IsActive | | como nas categorias |

**Transactions**

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| Date | date | só a data |
| Type | `Income` \| `Expense` | tem de ser igual ao tipo da categoria |
| CategoryId | int | FK → Categories |
| SubCategoryId | int, opcional | FK → SubCategories; tem de pertencer à categoria |
| Account | `Main` \| `MealCard` | de onde sai / para onde entra o dinheiro: conta à ordem (omissão) ou cartão refeição |
| Amount | decimal(18,2) | **sempre positivo**; o sinal vem do `Type` |
| Description | nvarchar(500), opcional | texto livre |
| CreatedAt / UpdatedAt | datetime2 (UTC) | |
| Source | `Manual` \| `Import` | origem da transação. Por omissão é `Manual`; `Import` fica reservado para a importação de extratos. |
| ImportHash | nvarchar(128), opcional | impressão digital da linha do extrato (ex.: hash de data+valor+descrição+conta). Tem um **índice único filtrado** (`WHERE ImportHash IS NOT NULL`): importar o mesmo extrato duas vezes nunca duplica transações e as manuais (sem hash) não são afetadas. |

Índices: `Date`, `(CategoryId, Date)` e `ImportHash` (único, filtrado).

**BudgetPlans** (previsão mensal)

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| Year, Month | int | mês da previsão |
| SubCategoryId | int | FK → SubCategories (apagada em cascata com a subcategoria) |
| Amount | decimal(18,2) | valor previsto (> 0). Renda ou despesa, conforme o tipo da categoria. |

Índice único `(Year, Month, SubCategoryId)`.

**Holdings** (investimentos: ações, fundo de emergência…)

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| Name | nvarchar(100) | ex.: "Ações (XTB)" |
| Color | `#RRGGBB`, opcional | |
| SortOrder, IsActive | | |

`SubCategories.HoldingId` (opcional, FK → Holdings, `SET NULL` ao apagar) liga uma subcategoria a um investimento.
Despesas nessa subcategoria são dinheiro **posto** no investimento; rendas são dinheiro **retirado**. Cada
subcategoria só pode estar ligada a um investimento.

**HoldingValuations** (atualizações de valor)

| Campo | Tipo | Notas |
|---|---|---|
| Id | int | PK |
| HoldingId | int | FK → Holdings (cascata) |
| Date | date | uma por dia (índice único `(HoldingId, Date)`) |
| Value | decimal(18,2) | valor lido na corretora/banco |
| Note | nvarchar(200), opcional | |

**AppSettings** (chave/valor)

| Key | Value |
|---|---|
| `OpeningBalance` | saldo inicial da conta à ordem (ex.: `500.05`) |
| `MealCardOpeningBalance` | saldo inicial do cartão refeição |
| `OpeningBalanceDate` | data a partir da qual conta (`yyyy-MM-dd`) |

Regras das FKs: as transações usam `ON DELETE RESTRICT`, e nunca são apagadas em cascata sem aviso (a API trata
disso explicitamente, ver [Categorias](#categorias)). As subcategorias são apagadas com a categoria.

---

## API

JSON, enums como texto. Os erros vêm em formato **ProblemDetails** (`application/problem+json`), com mensagens em
pt-PT. Os erros de validação são `400` com `errors: { campo: [mensagens] }`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | verificação de estado |
| GET | `/api/transactions` | lista. Filtros: `from`, `to` (yyyy-MM-dd), `type`, `categoryId`, `subCategoryId`, `account` (`Main`/`MealCard`), `search` (descrição), `minAmount`, `maxAmount`. `sort` = `date_desc` (omissão) \| `date_asc` \| `amount_desc` \| `amount_asc`. `page`, `pageSize` (omissão 50, máx. 1000). Devolve `{ items, totalCount, page, pageSize, totals: { income, expense, net } }`, e os totais cobrem o filtro inteiro, não só a página. |
| GET | `/api/transactions/{id}` | uma transação |
| POST | `/api/transactions` | criar: `{ date, type, categoryId, subCategoryId?, account?, amount, description? }` (`account` por omissão `Main`) |
| PUT | `/api/transactions/{id}` | editar (mesmo corpo) |
| DELETE | `/api/transactions/{id}` | apagar |
| GET | `/api/categories` | categorias com subcategorias e nº de transações. Opcional: `type`, `activeOnly=true` |
| GET | `/api/categories/{id}` | uma categoria |
| POST | `/api/categories` | `{ name, type, color?, sortOrder?, isActive? }` |
| PUT | `/api/categories/{id}` | `{ name, color?, type?, sortOrder?, isActive? }`. O tipo só pode mudar se a categoria não tiver transações. |
| POST | `/api/categories/reorder` | `{ ids: [...] }`: a ordem da lista passa a ser o `SortOrder` |
| DELETE | `/api/categories/{id}` | ver regras abaixo |
| GET | `/api/subcategories` | opcional: `categoryId`, `activeOnly` |
| GET | `/api/subcategories/{id}` | uma subcategoria |
| POST | `/api/subcategories` | `{ categoryId, name, sortOrder?, isActive? }` |
| PUT | `/api/subcategories/{id}` | `{ categoryId, name, sortOrder?, isActive? }`. Mudar o `categoryId` move também as transações associadas (tem de ser do mesmo tipo). |
| POST | `/api/subcategories/reorder` | `{ ids: [...] }` |
| DELETE | `/api/subcategories/{id}` | ver regras abaixo |
| GET | `/api/reports/monthly-grid?year=AAAA[&account=MealCard]` | matriz categoria/subcategoria × 12 meses com totais, `previousBalance[12]`, `net[12]` e `endBalance[12]`; com `account`, só essa conta (e o saldo inicial dela) |
| GET | `/api/reports/dashboard?year=AAAA&month=MM` | mês atual e anterior (renda, despesa, saldo, saldo acumulado, % poupada), saldo de cada conta no fim do mês (`accountBalances`), série dos últimos 12 meses, despesas por categoria, top 5 subcategorias e últimas 10 transações |
| GET | `/api/budget?year=AAAA&month=MM` | previsão do mês: por categoria/subcategoria `planned`, `actual` e `projected`, totais, saldo anterior e saldos finais previsto/projetado/real |
| PUT | `/api/budget?year=AAAA&month=MM` | substitui a previsão do mês: `{ items: [{ subCategoryId, amount }] }` (valor 0 ou ausente = sem previsão) |
| GET | `/api/budget/suggestions?year=AAAA&month=MM&source=plan\|actual\|average` | valores para pré-preencher: previsão do mês anterior, real do mês anterior ou média real dos últimos 3 meses |
| GET | `/api/holdings` | investimentos com investido, última atualização (com variação face à anterior), ganho e valor estimado |
| GET | `/api/holdings/{id}/history` | atualizações (com investido à data e variação) e série do investido acumulado |
| POST | `/api/holdings` | `{ name, color?, subCategoryIds: [] }` |
| PUT | `/api/holdings/{id}` | idem (substitui as subcategorias ligadas) |
| DELETE | `/api/holdings/{id}` | apaga o investimento e o histórico de valores; transações e subcategorias ficam |
| POST | `/api/holdings/{id}/valuations` | `{ date, value, note? }` (no mesmo dia substitui) |
| PUT / DELETE | `/api/valuations/{id}` | editar / apagar uma atualização |
| GET | `/api/settings` | `{ openingBalance, mealCardOpeningBalance, startDate }` |
| PUT | `/api/settings` | `{ openingBalance, mealCardOpeningBalance?, startDate }` |

**Regras de DELETE (categorias e subcategorias):**

- **Sem transações:** apaga logo. Uma categoria apaga também as suas subcategorias.
- **Com transações e sem parâmetros:** devolve **`409`** com `transactionCount` (e `subCategoryCount`, no caso de
  uma categoria).
- **`?moveToCategoryId=X&moveToSubCategoryId=Y`:** move as transações para o destino e só depois apaga, tudo numa
  transação de BD. O destino tem de existir e ser do mesmo tipo. `moveToSubCategoryId` é opcional; sem ele, as
  transações ficam sem subcategoria.
- **`?deleteTransactions=true`:** apaga também as transações.

Exemplo rápido (PowerShell):

```powershell
Invoke-RestMethod http://localhost:5100/api/transactions?from=2026-09-01`&to=2026-09-30
```

---

## Ecrãs e atalhos

### Botão "Nova transação" (topo, sempre visível)

Abre um modal com o tipo (**Renda**/**Despesa**), a conta (**Conta à ordem**/**Cartão Refeição**), o valor (foco automático; aceita `12,5`, `1.234,56` ou
`1 234,56`, e também **contas** como `12,40+3,10` ou `3*15`, que ficam com o resultado ao sair do campo), a data, a categoria e a subcategoria (filtradas pelo tipo) e uma descrição opcional.

- A data vem por omissão com a **última data usada na sessão** (ou hoje). Aceita `5` (dia 5 do mês atual), `5/9`,
  `05/09/26` e `05/09/2026`. **↑/↓** muda um dia e o ícone abre o calendário.
- A última categoria usada é lembrada para cada tipo.
- A conta é sugerida automaticamente (ver [Cartão Refeição](#cartão-refeição)).
- Categorias e subcategorias inativas não aparecem, exceto ao editar uma transação que já as usa.

| Atalho | Ação |
|---|---|
| **N** | abre "Nova transação" (em qualquer ecrã, fora de campos de texto) |
| **Enter** | guardar |
| **Shift+Enter** (ou Ctrl+Enter) | guardar e adicionar outra (mantém tipo, data e categoria; limpa valor e descrição) |
| **Esc** | fechar o modal |
| **↑ / ↓** no campo data | dia seguinte / anterior |

### Dashboard

Seletor de mês (‹ ›, "Hoje"). Mostra:

- Cartões com a renda, as despesas, o saldo do mês, o saldo acumulado (com o detalhe conta à ordem · cartão refeição), a **% poupada** (saldo ÷ renda) e os **Investimentos** (com o património total). Cada
  cartão compara com o mês anterior: seta e cor indicam se a variação é boa ou má (nas despesas, subir é mau).
- Um gráfico de barras dos últimos 12 meses (renda vs despesas), com o saldo do mês em linha. O tooltip mostra
  também o saldo acumulado.
- Um donut das despesas por categoria, com a lista ao lado (valor e %). Clicar abre as transações dessa categoria.
- O top 5 das subcategorias de despesa do mês.
- As últimas 10 transações (clicar edita).

### Orçamento (grelha estilo Excel)

- Ano e conta selecionáveis (**Todas as contas** / **Conta à ordem** / **Cartão Refeição**). Colunas **Jan–Dez**, **Total** e **Média**.
- Os meses passados sem transações não aparecem. A Média é o total a dividir pelos meses decorridos
  no ano corrente, ou por 12 nos outros anos.
- **RENDA**: cabeçalho azul-escuro, linhas azul-claro, linha **Saldo Anterior** calculada e **TOTAL** a verde. O
  TOTAL soma só as receitas do mês; o dinheiro acumulado aparece nas linhas de saldo no fundo.
- **DESPESAS**: cabeçalho vermelho, um grupo por categoria com subtotal em rosa mais escuro, e **TOTAL** geral.
- No fundo, **Saldo do mês** (renda − despesas) e **Saldo acumulado** (saldo no fim de cada mês).
- Valores a zero aparecem como **–** em cinzento claro.
- O cabeçalho e a primeira coluna ficam fixos ao fazer scroll.
- Clicar no nome de um grupo recolhe-o e o subtotal passa para essa linha. O estado fica guardado no browser.
- **Drill-down:** clicar num valor abre a lista de transações filtrada por essa subcategoria e mês. No Total, filtra
  pelo ano inteiro.
- **Duplo clique numa célula** abre "Nova transação" já preenchida com essa categoria/subcategoria e mês. A data é
  hoje no mês atual, o último dia nos meses passados e o dia 1 nos futuros. A conta é a do filtro, se estiver
  filtrado pelo cartão.
- Com **Todas as contas**, o Saldo Anterior mostra por baixo a divisão **Conta à ordem / Cartão Refeição**; o saldo
  inicial do cartão entra no total e aparece nessa sublinha.
- O mês atual aparece destacado, e os meses futuros sem valores ficam esbatidos.

### Previsão

É aqui que se planeia o mês e se compara com o que aconteceu.

- Os campos aceitam **contas**: `10+20` passa a `30,00` ao sair do campo (também `-`, `*`, `/` e parênteses).
- **No início do mês**, escreva em cada subcategoria quanto espera receber ou gastar, e carregue em **Guardar
  previsão** (ou Enter num campo). Os campos alterados ficam destacados até guardar.
- **Preencher com:** copia a previsão do mês anterior, o real do mês anterior ou a média real dos últimos 3 meses.
  Os valores só ficam gravados depois de "Guardar previsão".
- **Tabela:** para cada linha mostra Previsto, Real (clicar abre as transações), Diferença e uma barra de execução
  (% do previsto já gasto ou recebido). Nas despesas, passar do previsto fica a vermelho.
- **Diferença:** positiva é bom (recebeu mais, ou gastou menos). Enquanto o mês não fecha, o que ainda está por
  gastar ou receber aparece em cinzento, porque ainda não é um resultado.
- **Cartões no topo:**
  - Renda e Despesas, previsto → real.
  - **Saldo final previsto** = saldo anterior + renda prevista − despesas previstas.
  - **Projeção para o fim do mês** = saldo anterior + (para cada linha, o maior entre o previsto e o real) na
    renda, − o mesmo nas despesas. Ou seja, assume que o que está previsto e ainda não aconteceu vai acontecer, e
    que o que já passou do previsto fica como está. Nos meses fechados mostra o **saldo final real**. Por baixo
    aparece a diferença para o saldo previsto ("X € melhor/pior do que o previsto").
- **Só linhas com valores** esconde as linhas sem previsto nem real. A escolha fica guardada no browser.

### Investimentos

Serve para acompanhar dinheiro que sai da conta mas continua a ser teu: as ações na XTB, o fundo de emergência
numa conta a render, etc.

- **Pôr dinheiro:** é uma **despesa** normal numa subcategoria ligada ao investimento. Já existe a categoria
  **Investimentos**, com **Ações (XTB)** e **Fundo de emergência**, ligadas aos investimentos com o mesmo nome. No
  orçamento conta como despesa; aqui conta como **investido**.
- **Tirar dinheiro:** é uma renda numa subcategoria ligada (ex.: crie "Renda › Resgate fundo" e ligue-a ao fundo).
  Reduz o investido.
- **Atualizar valor:** de vez em quando veja quanto tem na XTB ou na conta e registe o valor com a data.
  - Enquanto escreve, o diálogo mostra **quanto cresceu desde a atualização anterior**, em € e %.
  - A mensagem de confirmação repete a % e fica tudo no histórico.
- **Cálculos:**
  - **Investido** = despesas − rendas nas subcategorias ligadas.
  - **Variação desde a atualização anterior** = valor novo − valor anterior − o investido entretanto. Assim, um
    reforço não é contado como crescimento. **%** = variação ÷ (valor anterior + investido entretanto). Exemplo:
    440 € → reforço de 200 € → 660 € dá +20 € (+3,1%).
  - **Ganho total** = último valor − investido até essa data.
  - **Valor atual (estimado)** = último valor + o que investiu depois dessa atualização (ao custo). Sem nenhuma
    atualização, é igual ao investido.
  - **Património** = saldo das contas + valor dos investimentos. Aparece nesta página e no Dashboard.
- **Cada cartão** tem um gráfico (valor vs investido), o histórico de atualizações (editáveis) e a ligação às
  transações de reforço.
- **Novo investimento:** nome, cor e as subcategorias que o alimentam.

### Transações

Uma tabela com Data, Tipo, Categoria, Subcategoria, Descrição e Valor (verde para renda, vermelho para despesa).

- **Filtros:** período (Mês/Ano/Tudo, com ‹ ›), tipo, categoria, subcategoria, conta e pesquisa na descrição. As
  transações do cartão refeição têm um ícone de cartão junto ao valor. Os filtros
  ficam no URL, por isso o botão "voltar" e o drill-down funcionam.
- O rodapé mostra os totais do filtro atual: receitas, despesas e saldo.
- Clicar numa linha edita-a. Os ícones à direita servem para editar e remover (com confirmação).
- A tabela é paginada de 100 em 100.

### Categorias

Ver [Categorias](#categorias).

### Definições

Aqui define-se o saldo inicial e a data de início (ver a secção seguinte).

---

## Saldo Anterior e saldo inicial

O **Saldo Anterior não é uma transação**: é calculado automaticamente, como no Excel (onde `C3 = B10 − B56`).

- Em **Definições** indica-se o **saldo inicial** (`OpeningBalance`, pode ser negativo) e a **data de início**
  (`OpeningBalanceDate`).
- O mês da data de início tem como Saldo Anterior o próprio saldo inicial.
- Para cada mês seguinte, **Saldo Anterior = saldo inicial + Σ(receitas − despesas)** de todos os meses desde o mês
  de início até ao mês anterior.
- **Saldo acumulado** (fim do mês) = Saldo Anterior + receitas do mês − despesas do mês.
- Os meses antes do mês de início não têm saldo (a célula fica vazia). As transações desses meses continuam a
  aparecer nas somas por categoria, mas não entram nos saldos.

Exemplo, com os dados do Excel: saldo inicial 500,05 € e início em 01/07/2025. O Saldo Anterior de julho/2025 é
500,05 €, e o de agosto é 500,05 € + (receitas − despesas de julho).

### Cartão Refeição

Cada transação indica **de onde sai (ou para onde entra) o dinheiro**: **Conta à ordem** ou **Cartão Refeição**.
A categoria continua a dizer *em quê* gastaste, e a conta diz *com quê* pagaste. Por exemplo, "Dia a Dia /
Restaurante" pago com o cartão.

- **Carregamento mensal:** registe-o como Renda / **Cartão Refeição**. Ao escolher essa subcategoria, o modal
  seleciona sozinho a conta Cartão Refeição.
- **Gastos:** escolha "Cartão Refeição" em "Pago com". A app lembra a conta usada da última vez em cada
  subcategoria, por isso se o Restaurante é sempre pago com o cartão, ele vem pré-selecionado.
- **Saldos:** o saldo do cartão acumula de mês para mês. Os totais e o saldo acumulado somam as duas contas. O
  Dashboard mostra o detalhe e a grelha pode ser filtrada só pelo cartão (carregamentos, gastos e saldo mês a mês).
- **Saldo inicial do cartão:** em Definições, com a mesma data de início da conta à ordem.
- A antiga subcategoria "Supermercado (cartão refeição)" foi desativada, porque agora é "Supermercado" pago com o
  cartão. A migration moveu para lá as transações que existissem.

---

## Backup e restauro

### Backup

Com a app instalada a correr há **backups automáticos** (semanal e antes de cada migration); ver
[App sempre ligada](#app-sempre-ligada-instalada). Para um backup manual, a qualquer altura:

Duplo clique em **`backup-db.cmd`**. Cria `backups\OrcamentoPessoal_AAAAMMDD_HHMMSS.bak` (backup completo, com
`COPY_ONLY` e `CHECKSUM`). A instância está configurada no topo do script (`SQL_INSTANCE`). A pasta `backups\` é
ignorada pelo git. Para ter uma cópia fora do PC, copie os `.bak` para um disco externo ou para uma cloud pessoal.

Alternativa sem `sqlcmd`: no SSMS, clique com o botão direito na BD, depois **Tasks → Back Up…**.

### Restauro

1. Feche a app (`stop.cmd`).
2. Numa linha de comandos (ajuste o caminho do ficheiro):
   ```cmd
   sqlcmd -S "(localdb)\MSSQLLocalDB" -E -d master -Q "ALTER DATABASE [OrcamentoPessoal] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [OrcamentoPessoal] FROM DISK = N'C:\Projects\BudgetOS\backups\OrcamentoPessoal_20260928_152834.bak' WITH REPLACE; ALTER DATABASE [OrcamentoPessoal] SET MULTI_USER;"
   ```
   Para restaurar noutra instância que ainda não tenha a BD, basta
   `RESTORE DATABASE [OrcamentoPessoal] FROM DISK = N'...' WITH MOVE ...`. No SSMS, use
   **Databases → Restore Database…**.
3. Arranque de novo com `start.cmd`. Se o backup for de uma versão mais antiga da app, as migrations pendentes são
   aplicadas no arranque.

---

## Categorias

Tudo se faz na página **Categorias**, sem ir à base de dados. As categorias iniciais vêm do Excel:

- **Renda** (tipo Renda): Vencimento, Cartão Refeição, Prendas, Subsídios / Bónus, IRS, Outros
- **Transportes**: Mensalidade Carro, Seguro Carro, Manutenção Carro, Combustível, IUC
- **Dia a Dia**: Supermercado, Restaurante, Café, Eletrónica, Barbeiro, Roupa
- **Lazer**: Cinema/concertos, Noite, Desporto, Férias
- **Saúde**: Consultas, Exames, Farmácia, Psicologia, Outros
- **Serviços**: Renda Casa, Condomínio, Seguros, Água, Luz, TV + NET, Telemóvel, Levantamentos, Prendas, Uber,
  Poupança, Outros
- **Investimentos**: Ações (XTB), Fundo de emergência (ligadas aos investimentos com o mesmo nome)

Na Renda, as linhas do Excel (Vencimento, Cartão Refeição, …) passaram a ser subcategorias de uma categoria
"Renda", para que receitas e despesas tenham a mesma estrutura Categoria → Subcategoria.

| Ação | Como |
|---|---|
| Criar categoria | botão **Nova categoria** no cabeçalho de RENDA ou DESPESAS (nome, tipo, cor) |
| Criar subcategoria | expandir a categoria e usar **+ Nova subcategoria** (Enter adiciona e deixa o campo pronto para a seguinte) |
| Renomear / mudar cor | ícone ✎. **As transações não mudam**, porque estão ligadas por Id. |
| Mudar subcategoria de categoria | ✎ na subcategoria, escolhendo outra categoria do mesmo tipo. As transações dessa subcategoria passam também para a nova categoria. |
| Reordenar | setas ↑ ↓ (a ordem reflete-se na grelha e nos selects) |
| Ativar / desativar | ícone 👁. Uma categoria inativa desaparece dos selects de nova transação, mas mantém o histórico e continua a aparecer na grelha se tiver valores. |
| Apagar | ícone 🗑 (ver abaixo) |

Cada linha mostra **quantas transações** tem, para se perceber o impacto antes de apagar. Ao apagar:

- **Sem transações**, basta confirmar.
- **Com transações**, abre um diálogo com o número de transações afetadas e duas opções:
  - **Mover para…**: escolher a categoria e a subcategoria de destino (do mesmo tipo). As transações são movidas e
    só depois o item é apagado, tudo numa transação de BD.
  - **Apagar também as transações**: exige escrever o nome do item para confirmar.

---

## Roadmap / Fase 2

- **Importação de extratos (CSV/Excel/PDF)** de ~6 meses:
  - um parser por banco, que mapeia colunas para data, valor, descrição e sinal;
  - calcular o `ImportHash` (ex.: SHA-256 de `conta|data|valor|descrição normalizada|nº de ocorrência no dia`) e
    gravar com `Source = Import`. O índice único filtrado garante que reimportar o mesmo extrato não duplica
    transações;
  - um ecrã de pré-visualização para rever e categorizar antes de gravar.
- **Regras de auto-categorização** por palavras da descrição (ex.: "CONTINENTE" → Dia a Dia / Supermercado), com
  prioridade e aprendizagem a partir das correções manuais.
- ~~Orçamentos-alvo por categoria~~ → feito na página **Previsão**. Falta ainda: alertas ao ultrapassar o previsto,
  e uma vista anual "previsto vs real" por mês.
- **Transações recorrentes** (renda da casa, TV + NET, seguros), geradas automaticamente todos os meses e
  confirmadas com um clique.
- **Exportação para Excel** da grelha anual e da lista de transações.

---

## Troubleshooting

**A porta 5100 ou 5173 está ocupada**

Corra `stop.cmd`, que também avisa se as portas continuam ocupadas e diz por que processo. Para descobrir quem
usa a porta à mão:

```cmd
netstat -ano | findstr :5100
tasklist /FI "PID eq <pid>"
```

As portas estão fixas: a da API em `Program.cs` (`ListenLocalhost(5100)`) e em `vite.config.ts` (proxy); a do
frontend em `vite.config.ts` (`strictPort`).

**SQL Server inacessível ("A network-related or instance-specific error…")**

- Confirme a instância: `sqllocaldb info MSSQLLocalDB`. Se estiver `Stopped`, faça `sqllocaldb start MSSQLLocalDB`
  (normalmente arranca sozinha).
- Se o LocalDB estiver corrompido: `sqllocaldb stop MSSQLLocalDB`, `sqllocaldb delete MSSQLLocalDB` e
  `sqllocaldb create MSSQLLocalDB -s`. **Atenção:** a BD tem de ser depois restaurada a partir de um backup.
- Se usar outra instância, veja [Mudar de instância SQL](#mudar-de-instância-sql). Para SQL Express, confirme que
  o serviço `SQL Server (SQLEXPRESS)` está a correr (`services.msc`).

**Erro de certificado ("The certificate chain was issued by an authority that is not trusted")**

A connection string tem de incluir `TrustServerCertificate=True` (o Microsoft.Data.SqlClient cifra a ligação por
omissão). Em alternativa, use `Encrypt=False`, que só é aceitável em ligações locais.

**"Cannot open database OrcamentoPessoal requested by the login"**

A BD ainda não existe. Corra `setup.cmd` ou `dotnet ef database update --project src\Api\Api.csproj`.

**A app instalada não abre (http://localhost:5180)**

- Veja `app\logs\` (o ficheiro do dia).
- No Agendador de Tarefas (`taskschd.msc`), a tarefa "Orcamento Pessoal" deve estar *Em execução*. O watchdog
  volta a arrancá-la em até 5 minutos.
- Para a arrancar já: `powershell -File scripts\autostart.ps1 start`.
- Se mudou a instância SQL, crie `app\appsettings.Production.local.json` com a nova connection string.

**`publish.cmd` falha ao copiar ficheiros ("being used by another process")**

A app instalada ainda estava a correr. O script tenta pará-la primeiro; se falhar, corra `uninstall-autostart.cmd`,
volte a publicar e reinstale.

**`start.cmd` diz que a API não respondeu**

Veja a janela "OrcamentoPessoal - API", onde aparece o erro real (normalmente SQL ou porta ocupada).

**A página abre mas diz "Sem ligação à API"**

A API não está a correr ou falhou no arranque. Confirme em http://localhost:5100/api/health.

**`dotnet ef` não é reconhecido**

Corra `dotnet tool restore` na raiz do projeto (a ferramenta é local, em `dotnet-tools.json`).

**Criar uma nova migration depois de mudar as entidades**

```cmd
dotnet ef migrations add NomeDaAlteracao --project src\Api\Api.csproj --output-dir Data\Migrations
```

Em Development, a migration é aplicada ao arrancar a API.

---

> **Privacidade:** o código é público, mas **os dados nunca entram no repositório**. Ficam na base de dados local
> e na pasta `backups/`. O `.gitignore` exclui backups (`*.bak`), extratos (`*.xlsx`, `*.csv`, `*.pdf`, …), logs,
> a app publicada (`app/`) e configurações locais (`appsettings.*.local.json`). Antes de fazer commit, confirme com
> `git status` que não aparece nenhum destes ficheiros.

## Licença

[MIT](LICENSE)
