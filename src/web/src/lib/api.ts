// Typed wrapper around the REST API (proxied to http://localhost:5100 by Vite).

export type EntryType = 'Income' | 'Expense'

export type AccountKind = 'Bank' | 'MealCard'

/** Where the money comes from / goes to (bank accounts, meal card). */
export interface Account {
  id: number
  name: string
  kind: AccountKind
  color: string | null
  sortOrder: number
  isActive: boolean
  isDefault: boolean
  openingBalance: number
  /** Opening balance + every transaction since the start month. */
  balance: number
  transactionCount: number
  transferCount: number
}

/** Money moved between two accounts: changes both balances, never counts as income or expense. */
export interface Transfer {
  id: number
  date: string
  fromAccountId: number
  fromAccountName: string
  fromAccountKind: AccountKind
  fromAccountColor: string | null
  toAccountId: number
  toAccountName: string
  toAccountKind: AccountKind
  toAccountColor: string | null
  amount: number
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface TransferInput {
  date: string
  fromAccountId: number
  toAccountId: number
  amount: number
  description: string | null
}

export interface AccountInput {
  name: string
  kind: AccountKind
  color: string | null
  isActive: boolean
  isDefault: boolean
  openingBalance: number
}

export interface SubCategory {
  id: number
  categoryId: number
  name: string
  sortOrder: number
  isActive: boolean
  transactionCount: number
}

export interface Category {
  id: number
  name: string
  type: EntryType
  color: string | null
  sortOrder: number
  isActive: boolean
  transactionCount: number
  subCategories: SubCategory[]
  /** Expense category that is savings/investment (not consumption). */
  isSavings: boolean
}

export interface Transaction {
  id: number
  date: string
  type: EntryType
  categoryId: number
  categoryName: string
  categoryColor: string | null
  subCategoryId: number | null
  subCategoryName: string | null
  accountId: number
  accountName: string
  accountKind: AccountKind
  accountColor: string | null
  amount: number
  description: string | null
  source: 'Manual' | 'Import'
  createdAt: string
  updatedAt: string
}

export interface TransactionInput {
  date: string
  type: EntryType
  categoryId: number
  subCategoryId: number | null
  accountId: number
  amount: number
  description: string | null
}

export interface TransactionFilter {
  from?: string
  to?: string
  type?: EntryType
  categoryId?: number
  subCategoryId?: number
  accountId?: number
  search?: string
  minAmount?: number
  maxAmount?: number
  sort?: string
  page?: number
  pageSize?: number
}

export interface TransactionPage {
  items: Transaction[]
  totalCount: number
  page: number
  pageSize: number
  /** expense = consumption; invested = savings/investment categories; net = income − expense − invested. */
  totals: { income: number; expense: number; net: number; invested: number }
}

export interface GridRow {
  subCategoryId: number | null
  name: string
  isActive: boolean
  months: number[]
  total: number
}

export interface GridCategory {
  id: number
  name: string
  color: string | null
  isActive: boolean
  rows: GridRow[]
  months: number[]
  total: number
}

export interface GridSection {
  type: EntryType
  categories: GridCategory[]
  months: number[]
  total: number
}

export interface MonthlyGrid {
  year: number
  startMonth: string
  income: GridSection
  expense: GridSection
  previousBalance: (number | null)[]
  /** "Saldo Anterior" split per account (only without an account filter). */
  previousBalanceByAccount?: {
    accountId: number
    name: string
    kind: AccountKind
    color: string | null
    isActive: boolean
    values: (number | null)[]
  }[] | null
  net: number[]
  endBalance: (number | null)[]
  /** With an account filter: that account's transfers (in − out) per month, already included in `net`. */
  transfers?: number[] | null
  /** Savings/investment categories, apart from expenses. net = income − expense; end = previous + net − savings (+ transfers). */
  savings?: GridSection | null
}

export interface MonthSummary {
  year: number
  month: number
  income: number
  expense: number
  net: number
  balance: number | null
  savingsRate: number | null
  /** Put into savings/investment categories (not part of expense). */
  invested: number
}

export interface Dashboard {
  current: MonthSummary
  /** Balance at the end of the selected month, per account. */
  accountBalances: { accountId: number; name: string; kind: AccountKind; color: string | null; balance: number | null }[]
  /** Estimated value of all investments at the end of the month. */
  investments: number
  /** Same, at the end of the previous month. */
  previousInvestments: number
  previous: MonthSummary
  series: MonthSummary[]
  expensesByCategory: { categoryId: number; name: string; color: string | null; amount: number; percent: number }[]
  topSubCategories: {
    categoryId: number
    categoryName: string
    categoryColor: string | null
    subCategoryId: number | null
    name: string
    amount: number
  }[]
  latestTransactions: Transaction[]
}

export interface BudgetLine {
  categoryId: number
  subCategoryId: number | null
  name: string
  isActive: boolean
  planned: number
  actual: number
  projected: number
  /** Account the line is planned on (null = the default account). */
  accountId: number | null
}

export interface BudgetAccount {
  id: number
  name: string
  kind: AccountKind
  color: string | null
  previousBalance: number | null
  actualNet: number
  plannedNet: number
  plannedEnd: number | null
  projectedEnd: number | null
  actualIncome: number
  actualExpense: number
  plannedIncome: number
  plannedExpense: number
  /** Transfers in − out this month (included in projectedEnd). */
  transferNet: number
  plannedSavings: number
  actualSavings: number
}

export interface BudgetGroup {
  id: number
  name: string
  color: string | null
  isActive: boolean
  lines: BudgetLine[]
  planned: number
  actual: number
  projected: number
}

export interface MonthBudget {
  year: number
  month: number
  status: 'past' | 'current' | 'future'
  hasPlan: boolean
  previousBalance: number | null
  income: BudgetGroup[]
  expense: BudgetGroup[]
  incomeTotals: { planned: number; actual: number; projected: number }
  expenseTotals: { planned: number; actual: number; projected: number }
  plannedEndBalance: number | null
  projectedEndBalance: number | null
  actualEndBalance: number | null
  defaultAccountId: number
  accounts: BudgetAccount[]
  savings: BudgetGroup[]
  savingsTotals: { planned: number; actual: number; projected: number }
}

export type BudgetItem = { subCategoryId: number; amount: number; accountId?: number | null }

export interface Valuation {
  id: number
  date: string
  value: number
  note: string | null
  investedAtDate: number
  /** Growth since the previous update, excluding money put in/taken out in between. */
  previousDate?: string | null
  previousValue?: number | null
  change?: number | null
  changePercent?: number | null
}

export interface Holding {
  id: number
  name: string
  color: string | null
  sortOrder: number
  isActive: boolean
  subCategories: { id: number; name: string; categoryId: number; categoryName: string; type: EntryType }[]
  /** Net amount put in (expenses in linked subcategories − income there). */
  invested: number
  lastValuation: Valuation | null
  gain: number | null
  gainPercent: number | null
  investedSinceValuation: number
  estimatedValue: number
}

export interface HoldingHistory {
  valuations: Valuation[]
  invested: { date: string; invested: number }[]
}

export interface HoldingInput {
  name: string
  color: string | null
  subCategoryIds: number[]
}

export interface Settings {
  startDate: string
}

export interface DeleteOptions {
  moveToCategoryId?: number
  moveToSubCategoryId?: number | null
  deleteTransactions?: boolean
}

/** Error carrying the ProblemDetails returned by the API. */
export class ApiError extends Error {
  status: number
  problem: Record<string, unknown>
  constructor(status: number, problem: Record<string, unknown>) {
    const errors = problem.errors as Record<string, string[]> | undefined
    const detail = errors ? Object.values(errors).flat().join(' ') : undefined
    super(detail || (problem.title as string) || `Erro ${status}`)
    this.status = status
    this.problem = problem
  }
}

function qs(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, { title: 'Não foi possível contactar a API. Está a correr (start.cmd)?' })
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, data ?? { title: `Erro ${res.status}` })
  return data as T
}

export const api = {
  transactions: {
    list: (f: TransactionFilter) => request<TransactionPage>('GET', `/transactions${qs(f)}`),
    create: (t: TransactionInput) => request<Transaction>('POST', '/transactions', t),
    update: (id: number, t: TransactionInput) => request<Transaction>('PUT', `/transactions/${id}`, t),
    remove: (id: number) => request<void>('DELETE', `/transactions/${id}`),
  },
  categories: {
    list: () => request<Category[]>('GET', '/categories'),
    create: (c: { name: string; type: EntryType; color: string | null; isSavings?: boolean }) =>
      request<Category>('POST', '/categories', c),
    update: (id: number, c: { name: string; type?: EntryType; color: string | null; isActive?: boolean; isSavings?: boolean }) =>
      request<Category>('PUT', `/categories/${id}`, c),
    reorder: (ids: number[]) => request<void>('POST', '/categories/reorder', { ids }),
    remove: (id: number, o: DeleteOptions = {}) => request<void>('DELETE', `/categories/${id}${qs(o)}`),
  },
  subCategories: {
    create: (s: { categoryId: number; name: string }) => request<SubCategory>('POST', '/subcategories', s),
    update: (id: number, s: { categoryId: number; name: string; isActive?: boolean }) =>
      request<SubCategory>('PUT', `/subcategories/${id}`, s),
    reorder: (ids: number[]) => request<void>('POST', '/subcategories/reorder', { ids }),
    remove: (id: number, o: DeleteOptions = {}) => request<void>('DELETE', `/subcategories/${id}${qs(o)}`),
  },
  reports: {
    grid: (year: number, accountId?: number) =>
      request<MonthlyGrid>('GET', `/reports/monthly-grid${qs({ year, accountId })}`),
    dashboard: (year: number, month: number) => request<Dashboard>('GET', `/reports/dashboard${qs({ year, month })}`),
  },
  transfers: {
    list: (f: { from?: string; to?: string; accountId?: number; search?: string }) =>
      request<Transfer[]>('GET', `/transfers${qs(f)}`),
    create: (t: TransferInput) => request<Transfer>('POST', '/transfers', t),
    update: (id: number, t: TransferInput) => request<Transfer>('PUT', `/transfers/${id}`, t),
    remove: (id: number) => request<void>('DELETE', `/transfers/${id}`),
  },
  accounts: {
    list: () => request<Account[]>('GET', '/accounts'),
    create: (a: AccountInput) => request<Account>('POST', '/accounts', a),
    update: (id: number, a: AccountInput) => request<Account>('PUT', `/accounts/${id}`, a),
    reorder: (ids: number[]) => request<void>('POST', '/accounts/reorder', { ids }),
    remove: (id: number, moveToAccountId?: number) =>
      request<void>('DELETE', `/accounts/${id}${qs({ moveToAccountId })}`),
  },
  budget: {
    get: (year: number, month: number) => request<MonthBudget>('GET', `/budget${qs({ year, month })}`),
    save: (year: number, month: number, items: BudgetItem[]) =>
      request<MonthBudget>('PUT', `/budget${qs({ year, month })}`, { items }),
    suggestions: (year: number, month: number, source: 'plan' | 'actual' | 'average') =>
      request<BudgetItem[]>('GET', `/budget/suggestions${qs({ year, month, source })}`),
  },
  holdings: {
    list: () => request<Holding[]>('GET', '/holdings'),
    history: (id: number) => request<HoldingHistory>('GET', `/holdings/${id}/history`),
    create: (h: HoldingInput) => request<Holding>('POST', '/holdings', h),
    update: (id: number, h: HoldingInput) => request<Holding>('PUT', `/holdings/${id}`, h),
    remove: (id: number) => request<void>('DELETE', `/holdings/${id}`),
    addValuation: (id: number, v: { date: string; value: number; note: string | null }) =>
      request<Holding>('POST', `/holdings/${id}/valuations`, v),
    updateValuation: (id: number, v: { date: string; value: number; note: string | null }) =>
      request<void>('PUT', `/valuations/${id}`, v),
    removeValuation: (id: number) => request<void>('DELETE', `/valuations/${id}`),
  },
  settings: {
    get: () => request<Settings>('GET', '/settings'),
    save: (s: Settings) => request<Settings>('PUT', '/settings', s),
  },
}
