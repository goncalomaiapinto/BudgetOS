import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Icon } from '../components/Icon'
import { PeriodNav, monthLabel } from '../components/PeriodNav'
import { api, type Dashboard } from '../lib/api'
import { useApp } from '../lib/app-context'
import { cx, formatDate, formatMoney, formatPercent, MONTHS, MONTHS_SHORT, shiftMonth } from '../lib/format'

const compact = new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 })

export default function DashboardPage() {
  const { version, openTransaction } = useApp()
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const year = Number(params.get('y')) || today.getFullYear()
  const month = Number(params.get('m')) || today.getMonth() + 1
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.reports
      .dashboard(year, month)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [year, month, version])

  const go = (delta: number) => {
    const n = shiftMonth(year, month, delta)
    setParams({ y: String(n.year), m: String(n.month) }, { replace: true })
  }

  const prevName = MONTHS_SHORT[(month + 10) % 12]

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <PeriodNav
          label={monthLabel(year, month)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onToday={() => setParams({}, { replace: true })}
        />
      </div>

      {error && <div className="card border-exp/40 bg-exp-row px-4 py-3 text-sm">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Receita do mês"
              value={formatMoney(data.current.income)}
              delta={relDelta(data.current.income, data.previous.income)}
              goodWhenUp
              prevName={prevName}
            />
            <StatCard
              label="Despesas do mês"
              value={formatMoney(data.current.expense)}
              delta={relDelta(data.current.expense, data.previous.expense)}
              goodWhenUp={false}
              prevName={prevName}
            />
            <StatCard
              label="Saldo do mês"
              value={formatMoney(data.current.net)}
              valueClass={data.current.net < 0 ? 'text-neg' : undefined}
              delta={absDelta(data.current.net, data.previous.net)}
              goodWhenUp
              prevName={prevName}
            />
            <StatCard
              label="Saldo acumulado"
              value={data.current.balance === null ? '—' : formatMoney(data.current.balance)}
              valueClass={(data.current.balance ?? 0) < 0 ? 'text-neg' : undefined}
              extra={
                data.accountBalances.length > 1 && data.accountBalances.some((a) => a.balance !== null) ? (
                  <ul className="space-y-0.5">
                    {data.accountBalances.map((a) => (
                      <li key={a.accountId} className="flex items-center gap-1.5">
                        {a.kind === 'MealCard' ? (
                          <Icon name="card" size={12} />
                        ) : (
                          <span className="size-1.5 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                        )}
                        <span className="truncate">{a.name}</span>
                        <span className={cx('ml-auto tabular', (a.balance ?? 0) < 0 && 'text-neg')}>
                          {a.balance === null ? '—' : formatMoney(a.balance)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
              delta={
                data.current.balance !== null && data.previous.balance !== null
                  ? absDelta(data.current.balance, data.previous.balance)
                  : null
              }
              goodWhenUp
              prevName={prevName}
            />
            <StatCard
              label="% poupada"
              value={data.current.savingsRate === null ? '—' : formatPercent(data.current.savingsRate)}
              valueClass={(data.current.savingsRate ?? 0) < 0 ? 'text-neg' : undefined}
              delta={
                data.current.savingsRate !== null && data.previous.savingsRate !== null
                  ? {
                      up: data.current.savingsRate >= data.previous.savingsRate,
                      text: `${fmtPp(data.current.savingsRate - data.previous.savingsRate)} p.p.`,
                      zero: data.current.savingsRate === data.previous.savingsRate,
                    }
                  : null
              }
              goodWhenUp
              prevName={prevName}
            />
            <Link to="/investimentos" className="contents">
              <StatCard
                label="Investimentos"
                value={formatMoney(data.investments)}
                extra={
                  data.current.balance !== null ? (
                    <>
                      Património <span className="font-medium text-fg">{formatMoney(data.current.balance + data.investments)}</span>
                    </>
                  ) : undefined
                }
                delta={null}
                deltaText="ações, fundo de emergência…"
                goodWhenUp
                prevName={prevName}
              />
            </Link>
          </div>

          <div className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Últimos 12 meses</h2>
            <p className="mb-3 text-xs text-muted">Receita e despesas por mês, com o saldo do mês em linha</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data.series.map((s) => ({
                    ...s,
                    label: `${MONTHS_SHORT[s.month - 1]}${s.month === 1 || s === data.series[0] ? ` ${String(s.year).slice(2)}` : ''}`,
                  }))}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  barGap={2}
                  barCategoryGap="22%"
                >
                  <CartesianGrid vertical={false} stroke="var(--c-grid)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    tick={{ fill: 'var(--muted)', fontSize: 12 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tick={{ fill: 'var(--muted)', fontSize: 12 }}
                    tickFormatter={(v: number) => compact.format(v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--fg)', fillOpacity: 0.05 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const s = payload[0].payload as Dashboard['series'][number]
                      return (
                        <div className="card px-3 py-2 text-xs shadow-lg">
                          <div className="mb-1 font-semibold">
                            {MONTHS[s.month - 1]} {s.year}
                          </div>
                          <TipRow color="var(--c-inc)" label="Receita" value={s.income} />
                          <TipRow color="var(--c-exp)" label="Despesas" value={s.expense} />
                          <TipRow color="var(--c-net)" label="Saldo do mês" value={s.net} line />
                          {s.balance !== null && (
                            <div className="mt-1 border-t border-line pt-1 text-muted">
                              Saldo acumulado: <span className="text-fg tabular">{formatMoney(s.balance)}</span>
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={28}
                    iconSize={10}
                    itemSorter={null}
                    formatter={(v) => <span className="text-xs text-fg">{v}</span>}
                  />
                  <Bar dataKey="income" name="Receita" fill="var(--c-inc)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Bar dataKey="expense" name="Despesas" fill="var(--c-exp)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Line
                    dataKey="net"
                    name="Saldo do mês"
                    type="monotone"
                    stroke="var(--c-net)"
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={{ r: 3.5, fill: 'var(--c-net)', stroke: 'var(--surface)', strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="card p-4 lg:col-span-3">
              <h2 className="mb-3 text-sm font-semibold">Despesas por categoria</h2>
              {data.expensesByCategory.length === 0 ? (
                <Empty text="Sem despesas neste mês." />
              ) : (
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="relative size-52 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.expensesByCategory}
                          dataKey="amount"
                          nameKey="name"
                          innerRadius="62%"
                          outerRadius="100%"
                          paddingAngle={1}
                          stroke="var(--surface)"
                          strokeWidth={2}
                          startAngle={90}
                          endAngle={-270}
                          isAnimationActive={false}
                        >
                          {data.expensesByCategory.map((c) => (
                            <Cell key={c.categoryId} fill={c.color ?? '#8a94a3'} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const c = payload[0].payload as Dashboard['expensesByCategory'][number]
                            return (
                              <div className="card px-3 py-2 text-xs shadow-lg">
                                <div className="font-semibold">{c.name}</div>
                                <div className="tabular">
                                  {formatMoney(c.amount)} · {formatPercent(c.percent)}
                                </div>
                              </div>
                            )
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xs text-muted">Total</span>
                      <span className="text-base font-semibold tabular">{formatMoney(data.current.expense)}</span>
                    </div>
                  </div>
                  <ul className="w-full space-y-1.5 text-sm">
                    {data.expensesByCategory.map((c) => (
                      <li key={c.categoryId}>
                        <Link
                          to={`/transacoes?y=${year}&m=${month}&cat=${c.categoryId}`}
                          className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-fg/5"
                        >
                          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: c.color ?? '#8a94a3' }} />
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="font-medium tabular">{formatMoney(c.amount)}</span>
                          <span className="w-14 text-right text-muted tabular">{formatPercent(c.percent)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="card p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold">Top 5 subcategorias de despesa</h2>
              {data.topSubCategories.length === 0 ? (
                <Empty text="Sem despesas neste mês." />
              ) : (
                <ol className="space-y-3">
                  {data.topSubCategories.map((s, i) => {
                    const max = data.topSubCategories[0].amount
                    return (
                      <li key={`${s.categoryId}-${s.subCategoryId}`}>
                        <Link
                          to={`/transacoes?y=${year}&m=${month}&cat=${s.categoryId}${s.subCategoryId ? `&sub=${s.subCategoryId}` : ''}`}
                          className="block rounded hover:bg-fg/5"
                        >
                          <div className="mb-1 flex items-baseline gap-2 text-sm">
                            <span className="w-4 text-muted tabular">{i + 1}.</span>
                            <span className="flex-1 truncate">
                              {s.name} <span className="text-xs text-muted">· {s.categoryName}</span>
                            </span>
                            <span className="font-medium tabular">{formatMoney(s.amount)}</span>
                          </div>
                          <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-fg/[0.06]">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(s.amount / max) * 100}%`, background: s.categoryColor ?? 'var(--c-exp)' }}
                            />
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Últimas transações</h2>
              <Link to="/transacoes" className="text-xs text-inc hover:underline dark:text-[#9fc0ea]">
                Ver todas →
              </Link>
            </div>
            {data.latestTransactions.length === 0 ? (
              <Empty text="Ainda não há transações. Carregue em N para adicionar a primeira." />
            ) : (
              <ul className="divide-y divide-line">
                {data.latestTransactions.map((t) => (
                  <li
                    key={t.id}
                    className="flex cursor-pointer items-center gap-3 px-1 py-2 text-sm hover:bg-fg/[0.03]"
                    onClick={() => openTransaction(t)}
                  >
                    <span className="w-20 text-muted tabular">{formatDate(t.date)}</span>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: t.categoryColor ?? '#999' }} />
                    <span className="min-w-0 flex-1 truncate">
                      {t.subCategoryName ?? t.categoryName}
                      {t.description && <span className="text-muted"> · {t.description}</span>}
                    </span>
                    <span className={cx('font-medium tabular', t.type === 'Income' ? 'text-pos' : 'text-neg')}>
                      {t.type === 'Income' ? '+' : '−'}
                      {formatMoney(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface Delta {
  up: boolean
  zero: boolean
  text: string
}

function relDelta(cur: number, prev: number): Delta | null {
  if (prev === 0) return null
  const change = (cur - prev) / Math.abs(prev)
  return { up: change >= 0, zero: change === 0, text: formatPercent(Math.abs(change)) }
}

function absDelta(cur: number, prev: number): Delta {
  const diff = cur - prev
  return { up: diff >= 0, zero: diff === 0, text: formatMoney(Math.abs(diff)) }
}

const fmtPp = (v: number) =>
  `${v >= 0 ? '+' : '−'}${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(Math.abs(v * 100))}`

function StatCard({
  label,
  value,
  valueClass,
  extra,
  deltaText,
  delta,
  goodWhenUp,
  prevName,
}: {
  label: string
  value: string
  valueClass?: string
  /** Optional detail line under the value (e.g. balance per account). */
  extra?: ReactNode
  /** Replaces the "vs previous month" line when there is no comparison to show. */
  deltaText?: string
  delta: Delta | null
  goodWhenUp: boolean
  prevName: string
}) {
  const good = delta && !delta.zero && delta.up === goodWhenUp
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('mt-1 text-xl font-semibold tracking-tight tabular', valueClass)}>{value}</div>
      {extra && <div className="mt-0.5 text-xs text-muted tabular" title="Conta à ordem · Cartão Refeição">{extra}</div>}
      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted">
        {delta ? (
          delta.zero ? (
            <span>igual a {prevName}</span>
          ) : (
            <>
              <span className={cx('inline-flex items-center gap-0.5 font-medium', good ? 'text-pos' : 'text-neg')}>
                <Icon name={delta.up ? 'arrowUpRight' : 'arrowDownRight'} size={13} />
                {delta.text.startsWith('+') || delta.text.startsWith('−') ? delta.text : `${delta.up ? '+' : '−'}${delta.text}`}
              </span>
              <span>vs {prevName}</span>
            </>
          )
        ) : (
          <span>{deltaText ?? `sem comparação com ${prevName}`}</span>
        )}
      </div>
    </div>
  )
}

function TipRow({ color, label, value, line }: { color: string; label: string; value: number; line?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx('shrink-0', line ? 'h-0.5 w-3' : 'size-2.5 rounded-sm')} style={{ background: color }} />
      <span className="flex-1 text-muted">{label}</span>
      <span className="ml-4 tabular">{formatMoney(value)}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted">{text}</p>
}
