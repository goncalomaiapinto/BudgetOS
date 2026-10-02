import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PeriodNav } from '../components/PeriodNav'
import {
  api,
  type EntryType,
  type GridCategory,
  type GridSection,
  type MonthlyGrid,
} from '../lib/api'
import { useApp } from '../lib/app-context'
import { cx, daysInMonth, formatNumber, MONTHS_SHORT, toIso } from '../lib/format'

const COLLAPSED_KEY = 'grid.collapsed'

function loadCollapsed(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as number[])
  } catch {
    return new Set()
  }
}

// Row look-ups mirror the Excel: coloured label column, white value cells, light-blue total column.
type RowKind = 'item' | 'group' | 'subtotal' | 'incTotal' | 'expTotal' | 'balance' | 'savGroup' | 'savSubtotal' | 'savTotal'

const labelBg: Record<RowKind, string> = {
  item: '',
  group: 'bg-exp-row',
  subtotal: 'bg-exp-sub',
  incTotal: 'bg-tot',
  expTotal: 'bg-exp-total',
  balance: 'bg-surface',
  savGroup: 'bg-sav-row',
  savSubtotal: 'bg-sav-sub',
  savTotal: 'bg-sav-total',
}
const valueBg: Record<RowKind, string> = {
  item: 'bg-surface',
  group: 'bg-surface',
  subtotal: 'bg-exp-sub',
  incTotal: 'bg-tot',
  expTotal: 'bg-exp-total',
  balance: 'bg-surface',
  savGroup: 'bg-surface',
  savSubtotal: 'bg-sav-sub',
  savTotal: 'bg-sav-total',
}

function Value({ v, strong, signed }: { v: number | null; strong?: boolean; signed?: boolean }) {
  if (v === null) return null
  if (v === 0) return <span className="text-cell-muted">–</span>
  return (
    <span className={cx(strong && 'font-semibold', signed && (v < 0 ? 'text-neg' : 'text-pos'))}>
      {formatNumber(v)}
    </span>
  )
}

// Pending single-click on a cell (delayed so a double-click can replace it).
let pendingClick: ReturnType<typeof setTimeout> | undefined
const cancelClick = () => clearTimeout(pendingClick)
const scheduleClick = (action: () => void) => {
  cancelClick()
  pendingClick = setTimeout(action, 450)
}

/** Column highlight info shared by all rows. */
interface ColumnInfo {
  /** Months (1–12) shown as columns. */
  visible: number[]
  currentMonth: number
  faded: (month: number) => boolean
}

function Row({
  cols,
  kind,
  label,
  months,
  total,
  average,
  onCell,
  onAdd,
  labelClass,
  signed,
  labelExtra,
}: {
  cols: ColumnInfo
  kind: RowKind
  label: ReactNode
  months: (number | null)[]
  total?: number | null
  average?: number | null
  onCell?: (month?: number) => void
  /** Double-click on a month cell: new transaction for this row and month. */
  onAdd?: (month: number) => void
  labelClass?: string
  signed?: boolean
  labelExtra?: string
}) {
  const strong = kind !== 'item' && kind !== 'group' && kind !== 'savGroup'
  const totalBg =
    kind === 'item' || kind === 'group' || kind === 'savGroup' || kind === 'balance' ? 'bg-inc-row' : valueBg[kind]
  return (
    <tr className={cx('group/row', kind === 'item' && 'hover:[&>td]:brightness-[0.97] dark:hover:[&>td]:brightness-125')}>
      <td
        className={cx(
          'sticky left-0 z-10 border-r border-b border-line/70 px-3 py-1 whitespace-nowrap',
          labelBg[kind] || labelExtra,
          strong && 'font-semibold',
          labelClass,
        )}
      >
        {label}
      </td>
      {cols.visible.map((m) => {
        const v = months[m - 1]
        const clickable = !!onCell && v !== null && v !== 0
        return (
          <td
            key={m}
            // A single click opens the transactions a moment later, so a double-click can cancel it and add instead.
            onClick={clickable ? () => scheduleClick(() => onCell(m)) : undefined}
            onDoubleClick={
              onAdd
                ? (e) => {
                    e.preventDefault()
                    cancelClick()
                    onAdd(m)
                  }
                : undefined
            }
            title={
              [clickable && 'Clique: ver transações', onAdd && 'Duplo clique: nova transação'].filter(Boolean).join(' · ') ||
              undefined
            }
            className={cx(
              'border-b border-line/70 px-2 py-1 text-right whitespace-nowrap',
              valueBg[kind],
              m === cols.currentMonth && 'shadow-[inset_2px_0_0_var(--month),inset_-2px_0_0_var(--month)]',
              cols.faded(m) && 'opacity-40',
              clickable && 'cursor-pointer hover:underline',
              onAdd && 'cursor-cell select-none',
            )}
          >
            <Value v={v} strong={strong} signed={signed} />
          </td>
        )
      })}
      <td
        onClick={onCell && total ? () => onCell() : undefined}
        className={cx(
          'border-b border-l border-line/70 px-2 py-1 text-right font-semibold whitespace-nowrap',
          totalBg,
          onCell && total ? 'cursor-pointer hover:underline' : '',
        )}
      >
        {total === undefined ? null : <Value v={total} strong signed={signed} />}
      </td>
      <td className={cx('border-b border-line/70 px-2 py-1 text-right whitespace-nowrap', !strong && 'text-muted', totalBg)}>
        {average === undefined || average === null ? null : <Value v={average} strong={strong} signed={signed} />}
      </td>
    </tr>
  )
}

function SectionHeader({ label, color, span }: { label: string; color: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className={cx('py-1.5 text-sm font-bold tracking-wider text-white', color)}>
        {/* The cell spans the full width; the inner sticky span keeps the title visible on horizontal scroll. */}
        <span className="sticky left-0 px-3">{label}</span>
      </td>
    </tr>
  )
}

export default function BudgetPage() {
  const { version, openTransaction, accounts } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const year = Number(params.get('y')) || today.getFullYear()
  const account = Number(params.get('acc')) || undefined
  const [grid, setGrid] = useState<MonthlyGrid | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  useEffect(() => {
    let cancelled = false
    api.reports
      .grid(year, account)
      .then((g) => {
        if (cancelled) return
        setGrid(g)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [year, account, version])

  const setFilter = (y: number, acc: number | undefined) => {
    const next: Record<string, string> = {}
    if (y !== today.getFullYear()) next.y = String(y)
    if (acc) next.acc = String(acc)
    setParams(next, { replace: true })
  }
  const setYear = (y: number) => setFilter(y, account)

  const toggle = (id: number) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
  }

  const isCurrentYear = year === today.getFullYear()
  const currentMonth = isCurrentYear ? today.getMonth() + 1 : 0
  const isFuture = (m: number) => year > today.getFullYear() || (isCurrentYear && m > currentMonth)
  const isEmpty = (m: number) =>
    !!grid &&
    grid.income.months[m - 1] === 0 &&
    grid.expense.months[m - 1] === 0 &&
    (grid.savings?.months[m - 1] ?? 0) === 0

  // Past months without transactions are hidden; future months stay visible but faded.
  const visible = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => isFuture(m) || m === currentMonth || !isEmpty(m))
  const faded = (m: number) => isFuture(m) && isEmpty(m)

  // The average only counts the months shown up to today (hidden empty months don't drag it down).
  const monthsForAverage = Math.max(1, visible.filter((m) => !isFuture(m)).length)

  const drill = (q: { type?: EntryType | 'Transfer'; cat?: number; sub?: number | null; month?: number }) => {
    const s = new URLSearchParams({ y: String(year) })
    if (q.month) s.set('m', String(q.month))
    else s.set('period', 'year')
    if (q.type) s.set('type', q.type)
    if (q.cat) s.set('cat', String(q.cat))
    if (q.sub) s.set('sub', String(q.sub))
    if (account) s.set('acc', String(account))
    navigate(`/transacoes?${s}`)
  }

  const cols: ColumnInfo = { visible, currentMonth, faded }

  /** New transaction preset for a grid cell: today if it's the current month, otherwise the 1st (or last day for past months). */
  const addFor = (type: EntryType, categoryId?: number, subCategoryId?: number | null, acc = account) => (m: number) => {
    const now = new Date()
    const isNow = year === now.getFullYear() && m === now.getMonth() + 1
    const isPast = year < now.getFullYear() || (year === now.getFullYear() && m < now.getMonth() + 1)
    const day = isNow ? now.getDate() : isPast ? daysInMonth(year, m) : 1
    openTransaction(undefined, { type, categoryId, subCategoryId, date: toIso(year, m, day), accountId: acc })
  }
  const avg = (total: number) => total / monthsForAverage

  const renderCategory = (cat: GridCategory, section: GridSection, grouped: boolean, savings = false) => {
    const rowBg = savings ? 'bg-sav-row' : section.type === 'Income' ? 'bg-inc-row' : 'bg-exp-row'
    const items = cat.rows.map((r) => (
      <Row
        cols={cols}
        key={`${cat.id}-${r.subCategoryId ?? 'none'}`}
        kind="item"
        labelExtra={rowBg}
        label={
          <span className={cx(grouped && 'pl-5', !r.isActive && 'text-muted italic')}>
            {r.name}
            {!r.isActive && <span className="ml-1 text-xs">(inativa)</span>}
          </span>
        }
        months={r.months}
        total={r.total}
        average={avg(r.total)}
        onCell={(m) => drill({ cat: cat.id, sub: r.subCategoryId, month: m })}
        onAdd={addFor(section.type, cat.id, r.subCategoryId)}
      />
    ))
    if (!grouped) return items

    const isCollapsed = collapsed.has(cat.id)
    const header = (
      <Row
        cols={cols}
        key={`${cat.id}-h`}
        kind={savings ? 'savGroup' : 'group'}
        labelExtra={rowBg}
        label={
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-1.5 text-left font-bold tracking-wide uppercase"
            onClick={() => toggle(cat.id)}
            aria-expanded={!isCollapsed}
          >
            <Icon name={isCollapsed ? 'right' : 'down'} size={14} className="text-muted" />
            <span className="size-2 rounded-full" style={{ background: cat.color ?? '#999' }} />
            {cat.name}
          </button>
        }
        // Collapsed groups show their subtotal on the header line.
        months={isCollapsed ? cat.months : cat.months.map(() => null)}
        total={isCollapsed ? cat.total : undefined}
        average={isCollapsed ? avg(cat.total) : undefined}
        onCell={isCollapsed ? (m) => drill({ cat: cat.id, month: m }) : undefined}
      />
    )
    if (isCollapsed) return [header]

    return [
      header,
      ...items,
      <Row
        cols={cols}
        key={`${cat.id}-s`}
        kind={savings ? 'savSubtotal' : 'subtotal'}
        label={<span className="pl-5 text-xs font-medium tracking-wide text-fg/70 uppercase">Subtotal</span>}
        months={cat.months}
        total={cat.total}
        average={avg(cat.total)}
        onCell={(m) => drill({ cat: cat.id, month: m })}
      />,
    ]
  }

  // Income line used to top up the meal card ("Receitas › Cartão Refeição"), if it exists.
  const mealTopUp = grid?.income.categories
    .flatMap((c) => c.rows.map((r) => ({ categoryId: c.id, subCategoryId: r.subCategoryId, name: r.name })))
    .find((r) => r.subCategoryId !== null && r.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('cartao refeicao'))

  const span = visible.length + 3 // label + months + Total + Média
  const lastBalance = grid?.endBalance.findLast((v) => v !== null) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Orçamento</h1>
          <p className="text-xs text-muted">
            Valores em euros · clique num valor para ver as transações · duplo clique numa célula para adicionar ·
            clique num grupo para o recolher
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs font-medium" role="radiogroup" aria-label="Conta">
            {[undefined, ...accounts.filter((a) => a.isActive || a.id === account)].map((a) => (
              <button
                key={a?.id ?? 'all'}
                type="button"
                role="radio"
                aria-checked={account === a?.id}
                onClick={() => setFilter(year, a?.id)}
                className={cx(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 transition-colors',
                  account === a?.id ? 'bg-inc text-white' : 'text-muted hover:text-fg',
                )}
              >
                {a?.kind === 'MealCard' ? (
                  <Icon name="card" size={13} />
                ) : (
                  a && <span className="size-2 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                )}
                {a ? a.name : 'Todas as contas'}
              </button>
            ))}
          </div>
          <PeriodNav
          label={String(year)}
          onPrev={() => setYear(year - 1)}
          onNext={() => setYear(year + 1)}
          onToday={isCurrentYear ? undefined : () => setYear(today.getFullYear())}
          />
        </div>
      </div>

      {error && <div className="card border-exp/40 bg-exp-row px-4 py-3 text-sm">{error}</div>}

      {grid && visible.length === 0 && (
        <div className="card px-4 py-10 text-center text-sm text-muted">Sem transações em {year}.</div>
      )}

      {grid && visible.length > 0 && (
        <div className="card max-h-[calc(100vh-150px)] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px] tabular">
            <thead className="sticky top-0 z-20">
              <tr className="text-white">
                <th className="sticky left-0 z-30 w-52 min-w-52 border-r border-line/70 bg-month px-3 py-2 text-left font-semibold">
                  {year}
                </th>
                {visible.map((m) => (
                  <th
                    key={m}
                    className={cx(
                      'min-w-[4.4rem] px-2 py-2 text-right font-semibold uppercase',
                      m === currentMonth ? 'bg-surface text-fg shadow-[inset_0_-3px_0_var(--month)]' : 'bg-month',
                      faded(m) && 'opacity-70',
                    )}
                  >
                    {MONTHS_SHORT[m - 1]}
                  </th>
                ))}
                <th className="min-w-[5.5rem] border-l border-line/70 bg-inc px-2 py-2 text-right font-semibold">Total</th>
                <th className="min-w-[4.4rem] bg-inc px-2 py-2 text-right font-semibold" title={`Total ÷ ${monthsForAverage} meses`}>
                  Média
                </th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="RECEITA" color="bg-inc" span={span} />
              <Row
                cols={cols}
                kind="item"
                labelExtra="bg-inc-row"
                label={
                  <span className="italic" title="Saldo inicial + (receitas − despesas) de todos os meses anteriores">
                    Saldo Anterior
                  </span>
                }
                months={grid.previousBalance}
                signed
              />
              {/* With "Todas as contas", the Saldo Anterior split per account. Double-click adds income to that account
                  (for the meal card: a top-up in "Receitas › Cartão Refeição"). */}
              {(grid.previousBalanceByAccount?.length ?? 0) > 1 &&
                grid.previousBalanceByAccount!.map((a) => (
                  <Row
                    key={`acc-${a.accountId}`}
                    cols={cols}
                    kind="item"
                    labelExtra="bg-inc-row"
                    label={
                      <span
                        className="inline-flex items-center gap-1.5 pl-4 text-xs text-muted italic"
                        title={`Parte do Saldo Anterior que está em ${a.name}`}
                      >
                        ↳ saldo {a.name}
                        {a.kind === 'MealCard' ? (
                          <Icon name="card" size={12} />
                        ) : (
                          <span className="size-1.5 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                        )}
                      </span>
                    }
                    months={a.values}
                    signed
                    onAdd={
                      a.kind === 'MealCard' && mealTopUp
                        ? addFor('Income', mealTopUp.categoryId, mealTopUp.subCategoryId, a.accountId)
                        : addFor('Income', undefined, undefined, a.accountId)
                    }
                  />
                ))}
              {grid.income.categories.flatMap((c) => renderCategory(c, grid.income, grid.income.categories.length > 1))}
              <Row
                cols={cols}
                kind="incTotal"
                label="TOTAL"
                months={grid.income.months}
                total={grid.income.total}
                average={avg(grid.income.total)}
                onCell={(m) => drill({ type: 'Income', month: m })}
              />

              <tr aria-hidden="true">
                <td colSpan={span} className="h-4 bg-surface" />
              </tr>

              <SectionHeader label="DESPESAS" color="bg-exp" span={span} />
              {grid.expense.categories.flatMap((c) => renderCategory(c, grid.expense, true))}
              <Row
                cols={cols}
                kind="expTotal"
                label="TOTAL"
                months={grid.expense.months}
                total={grid.expense.total}
                average={avg(grid.expense.total)}
                onCell={(m) => drill({ type: 'Expense', month: m })}
              />

              {/* Savings / investments: money that leaves the accounts but isn't consumption. */}
              {grid.savings && grid.savings.categories.length > 0 && (
                <>
                  <tr aria-hidden="true">
                    <td colSpan={span} className="h-4 bg-surface" />
                  </tr>
                  <SectionHeader label="POUPANÇA E INVESTIMENTOS" color="bg-sav" span={span} />
                  {grid.savings.categories.flatMap((c) => renderCategory(c, grid.savings!, true, true))}
                  <Row
                    cols={cols}
                    kind="savTotal"
                    label="TOTAL"
                    months={grid.savings.months}
                    total={grid.savings.total}
                    average={avg(grid.savings.total)}
                  />
                </>
              )}

              <tr aria-hidden="true">
                <td colSpan={span} className="h-4 border-b-2 border-line bg-surface" />
              </tr>

              <Row
                cols={cols}
                kind="balance"
                label={<span title="Receita − despesas (o que foi investido não conta como despesa)">Saldo do mês</span>}
                months={grid.net}
                total={grid.net.reduce((a, b) => a + b, 0)}
                average={avg(grid.net.reduce((a, b) => a + b, 0))}
                signed
              />
              {grid.savings && grid.savings.total !== 0 && (
                <Row
                  cols={cols}
                  kind="balance"
                  label={<span title="Dinheiro posto em poupança/investimentos (sai das contas)">Investido</span>}
                  months={grid.savings.months.map((v) => -v)}
                  total={-grid.savings.total}
                  average={avg(-grid.savings.total)}
                  signed
                />
              )}
              {/* With an account filter, that account's transfers (in − out): part of its balance, not income/expense. */}
              {grid.transfers?.some((v) => v !== 0) && (
                <Row
                  cols={cols}
                  kind="balance"
                  label={
                    <span className="inline-flex items-center gap-1.5" title="Entradas − saídas por transferência entre contas">
                      <Icon name="swap" size={13} /> Transferências
                    </span>
                  }
                  months={grid.transfers}
                  total={grid.transfers.reduce((a, b) => a + b, 0)}
                  signed
                  onCell={(m) => drill({ type: 'Transfer', month: m })}
                />
              )}
              <Row
                cols={cols}
                kind="balance"
                label={
                  <span title="Saldo das contas no fim de cada mês (saldo anterior + saldo do mês − investido ± transferências)">
                    Saldo acumulado
                  </span>
                }
                months={grid.endBalance}
                total={lastBalance}
                signed
              />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
