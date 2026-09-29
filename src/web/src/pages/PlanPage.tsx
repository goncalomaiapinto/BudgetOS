import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PeriodNav, monthLabel } from '../components/PeriodNav'
import { suggestAccount } from '../lib/accounts'
import { api, type BudgetGroup, type BudgetLine, type EntryType, type MonthBudget } from '../lib/api'
import { useApp } from '../lib/app-context'
import { amountToInput, cx, evalAmount, formatMoney, formatNumber, isExpression, MONTHS, shiftMonth } from '../lib/format'

type Source = 'plan' | 'actual' | 'average'

const STATUS_LABEL: Record<MonthBudget['status'], string> = {
  past: 'Mês fechado',
  current: 'Mês a decorrer',
  future: 'Mês futuro',
}

/** Planned value typed by the user (empty = 0); null when the text isn't a valid amount. */
const plannedOf = (text: string | undefined): number | null => {
  if (!text || !text.trim()) return 0
  const v = evalAmount(text) // accepts "10+20"
  return v === null || v < 0 ? null : v
}

export default function PlanPage() {
  const { version, toast, refresh, accounts, categories } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = new Date()
  const year = Number(params.get('y')) || today.getFullYear()
  const month = Number(params.get('m')) || today.getMonth() + 1

  const [data, setData] = useState<MonthBudget | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Input text per subcategory id; compared with the saved plan to know if there are unsaved changes.
  const [values, setValues] = useState<Record<number, string>>({})
  // Account per subcategory line (where the money is expected to come from / go to).
  const [lineAccounts, setLineAccounts] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [onlyFilled, setOnlyFilled] = useState(() => {
    try {
      return localStorage.getItem('plan.onlyFilled') === '1'
    } catch {
      return false
    }
  })
  const toggleOnlyFilled = (v: boolean) => {
    setOnlyFilled(v)
    try {
      localStorage.setItem('plan.onlyFilled', v ? '1' : '0')
    } catch {
      // not persisted
    }
  }

  const load = (d: MonthBudget) => {
    setData(d)
    const v: Record<number, string> = {}
    const acc: Record<number, number> = {}
    for (const [type, groups] of [['Income', d.income], ['Expense', d.expense]] as const) {
      for (const line of groups.flatMap((g) => g.lines)) {
        if (line.subCategoryId === null) continue
        v[line.subCategoryId] = line.planned ? amountToInput(line.planned) : ''
        // Saved lines keep their account; new ones get the usual suggestion (last used, meal card, default).
        acc[line.subCategoryId] = line.planned
          ? (line.accountId ?? d.defaultAccountId)
          : Number(suggestAccount(accounts, categories, type, line.subCategoryId)) || d.defaultAccountId
      }
    }
    setValues(v)
    setLineAccounts(acc)
  }

  useEffect(() => {
    let cancelled = false
    api.budget
      .get(year, month)
      .then((d) => {
        if (cancelled) return
        load(d)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, version, accounts.length])

  const lines = useMemo(() => (data ? [...data.income, ...data.expense].flatMap((g) => g.lines) : []), [data])
  const savedAccount = (l: BudgetLine) => l.accountId ?? data?.defaultAccountId
  const accountChanged = (l: BudgetLine) =>
    l.subCategoryId !== null && l.planned > 0 && lineAccounts[l.subCategoryId] !== savedAccount(l)
  const dirty = lines.some(
    (l) => l.subCategoryId !== null && ((plannedOf(values[l.subCategoryId]) ?? -1) !== l.planned || accountChanged(l)),
  )
  const invalid = lines.some((l) => l.subCategoryId !== null && plannedOf(values[l.subCategoryId]) === null)

  // Everything below is recomputed from the inputs, so the summary follows as you type.
  const planned = (l: BudgetLine) => (l.subCategoryId === null ? 0 : (plannedOf(values[l.subCategoryId]) ?? 0))
  const projected = (l: BudgetLine) => (data?.status === 'past' ? l.actual : Math.max(planned(l), l.actual))
  const sum = (groups: BudgetGroup[], f: (l: BudgetLine) => number) =>
    groups.flatMap((g) => g.lines).reduce((a, l) => a + f(l), 0)

  const totals = data && {
    income: { planned: sum(data.income, planned), actual: data.incomeTotals.actual, projected: sum(data.income, projected) },
    expense: { planned: sum(data.expense, planned), actual: data.expenseTotals.actual, projected: sum(data.expense, projected) },
  }
  const prev = data?.previousBalance ?? null
  const plannedEnd = totals && prev !== null ? prev + totals.income.planned - totals.expense.planned : null
  const projectedEnd = totals && prev !== null ? prev + totals.income.projected - totals.expense.projected : null

  // Per account, recomputed live: planned end = previous + planned lines on the account;
  // projection = previous + what really moved this month + what is planned on it and hasn't happened yet.
  const lineAccount = (l: BudgetLine) => (l.subCategoryId === null ? undefined : lineAccounts[l.subCategoryId])
  const signedLines = data
    ? [
        ...data.income.flatMap((g) => g.lines.map((l) => ({ l, sign: 1 }))),
        ...data.expense.flatMap((g) => g.lines.map((l) => ({ l, sign: -1 }))),
      ]
    : []
  const perAccount = (data?.accounts ?? []).map((a) => {
    const mine = signedLines.filter(({ l }) => lineAccount(l) === a.id)
    const plannedIncome = mine.reduce((sum, { l, sign }) => sum + (sign > 0 ? planned(l) : 0), 0)
    const plannedExpense = mine.reduce((sum, { l, sign }) => sum + (sign < 0 ? planned(l) : 0), 0)
    const plannedNet = plannedIncome - plannedExpense
    const remaining =
      data?.status === 'past' ? 0 : mine.reduce((sum, { l, sign }) => sum + sign * Math.max(planned(l) - l.actual, 0), 0)
    return {
      ...a,
      plannedIncome,
      plannedExpense,
      plannedNet,
      plannedEnd: a.previousBalance === null ? null : a.previousBalance + plannedNet,
      // transfers already made this month move money between accounts (they don't touch income/expense)
      projectedEnd: a.previousBalance === null ? null : a.previousBalance + a.actualNet + a.transferNet + remaining,
    }
  })

  const sumOf = (f: (a: (typeof perAccount)[number]) => number | null) =>
    perAccount.reduce((sum, a) => sum + (f(a) ?? 0), 0)
  const anyBalance = perAccount.some((a) => a.previousBalance !== null)

  const go = (delta: number) => {
    if (dirty && !confirm('Há alterações por guardar. Mudar de mês sem guardar?')) return
    const n = shiftMonth(year, month, delta)
    setParams({ y: String(n.year), m: String(n.month) }, { replace: true })
  }

  const save = async () => {
    if (invalid) {
      toast('Há valores inválidos (use por ex. 150 ou 12,50).', 'error')
      return
    }
    setBusy(true)
    try {
      const items = lines
        .filter((l) => l.subCategoryId !== null)
        .map((l) => ({
          subCategoryId: l.subCategoryId!,
          amount: plannedOf(values[l.subCategoryId!]) ?? 0,
          accountId: lineAccounts[l.subCategoryId!] ?? null,
        }))
        .filter((i) => i.amount > 0)
      load(await api.budget.save(year, month, items))
      toast(`Previsão de ${MONTHS[month - 1].toLowerCase()} guardada.`)
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const fill = async (source: Source) => {
    try {
      const items = await api.budget.suggestions(year, month, source)
      if (items.length === 0) {
        toast(
          source === 'plan' ? 'O mês anterior não tem previsão.' : 'Não há transações nesse período para usar.',
          'error',
        )
        return
      }
      const next = { ...values }
      for (const key of Object.keys(next)) next[Number(key)] = ''
      const nextAccounts = { ...lineAccounts }
      for (const i of items) {
        if (!(i.subCategoryId in next)) continue
        next[i.subCategoryId] = amountToInput(i.amount)
        if (i.accountId) nextAccounts[i.subCategoryId] = i.accountId
      }
      setValues(next)
      setLineAccounts(nextAccounts)
      toast('Valores preenchidos. Reveja e carregue em Guardar.')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const drill = (l: BudgetLine) => {
    const s = new URLSearchParams({ y: String(year), m: String(month), cat: String(l.categoryId) })
    if (l.subCategoryId) s.set('sub', String(l.subCategoryId))
    navigate(`/transacoes?${s}`)
  }

  const open = data?.status !== 'past'
  const hasNumbers = (l: BudgetLine) => l.actual !== 0 || planned(l) !== 0 || l.planned !== 0

  const section = (type: EntryType, allGroups: BudgetGroup[]) => {
    const isIncome = type === 'Income'
    const groups = onlyFilled
      ? allGroups.map((g) => ({ ...g, lines: g.lines.filter(hasNumbers) })).filter((g) => g.lines.length > 0)
      : allGroups
    const t = totals![isIncome ? 'income' : 'expense']
    return (
      <>
        <tr>
          <td colSpan={6} className={cx('px-3 py-1.5 text-sm font-bold tracking-wider text-white', isIncome ? 'bg-inc' : 'bg-exp')}>
            {isIncome ? 'RECEITA' : 'DESPESAS'}
          </td>
        </tr>
        {groups.map((g) => {
          const gPlanned = g.lines.reduce((a, l) => a + planned(l), 0)
          return [
            <tr key={`g${g.id}`} className={isIncome ? 'bg-inc-row' : 'bg-exp-row'}>
              <td className="px-3 py-1.5 font-bold tracking-wide uppercase">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: g.color ?? '#999' }} />
                  {g.name}
                </span>
              </td>
              <Num v={gPlanned} strong />
              <td />
              <Num v={g.actual} strong />
              <Diff type={type} planned={gPlanned} actual={g.actual} strong open={open} />
              <td className="px-3">
                <Progress type={type} planned={gPlanned} actual={g.actual} />
              </td>
            </tr>,
            ...g.lines.map((l) => (
              <tr key={`l${g.id}-${l.subCategoryId}`} className="border-b border-line/60 hover:bg-fg/[0.02]">
                <td className={cx('py-1 pr-3 pl-8', !l.isActive && 'text-muted italic')}>{l.name}</td>
                <td className="px-2 py-0.5">
                  {l.subCategoryId === null ? (
                    <span className="block pr-2 text-right text-cell-muted">–</span>
                  ) : (
                    <input
                      className={cx(
                        'input h-7 text-right tabular',
                        plannedOf(values[l.subCategoryId]) === null && 'border-exp',
                        (plannedOf(values[l.subCategoryId]) ?? -1) !== l.planned && 'bg-[#fff8db] dark:bg-[#2d2a17]',
                      )}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={`Previsto para ${l.name}`}
                      value={values[l.subCategoryId] ?? ''}
                      title="Pode escrever contas, ex.: 10+20 ou 3*15"
                      onChange={(e) => setValues({ ...values, [l.subCategoryId!]: e.target.value })}
                      onBlur={(e) => {
                        // "10+20" becomes "30,00" when leaving the field
                        const text = e.target.value
                        if (isExpression(text)) setValues({ ...values, [l.subCategoryId!]: amountToInput(evalAmount(text)!) })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const text = (e.target as HTMLInputElement).value
                          if (isExpression(text)) setValues({ ...values, [l.subCategoryId!]: amountToInput(evalAmount(text)!) })
                          void save()
                        }
                      }}
                    />
                  )}
                </td>
                <td className="px-1 py-0.5">
                  {l.subCategoryId !== null && (
                    <select
                      className={cx('input h-7 px-1.5 text-xs', accountChanged(l) && 'bg-[#fff8db] dark:bg-[#2d2a17]')}
                      aria-label={`Conta de ${l.name}`}
                      value={lineAccounts[l.subCategoryId] ?? ''}
                      onChange={(e) => setLineAccounts({ ...lineAccounts, [l.subCategoryId!]: Number(e.target.value) })}
                    >
                      {accounts
                        .filter((a) => a.isActive || a.id === lineAccounts[l.subCategoryId!])
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
                <td
                  className={cx('px-3 py-1 text-right tabular', l.actual !== 0 && 'cursor-pointer hover:underline')}
                  onClick={l.actual !== 0 ? () => drill(l) : undefined}
                  title={l.actual !== 0 ? 'Ver transações' : undefined}
                >
                  {l.actual === 0 ? <span className="text-cell-muted">–</span> : formatNumber(l.actual)}
                </td>
                <Diff type={type} planned={planned(l)} actual={l.actual} open={open} />
                <td className="px-3">
                  <Progress type={type} planned={planned(l)} actual={l.actual} />
                </td>
              </tr>
            )),
          ]
        })}
        <tr className={cx('font-semibold', isIncome ? 'bg-tot' : 'bg-exp-total')}>
          <td className="px-3 py-1.5">TOTAL {isIncome ? 'RECEITA' : 'DESPESAS'}</td>
          <Num v={t.planned} strong />
          <td />
          <Num v={t.actual} strong />
          <Diff type={type} planned={t.planned} actual={t.actual} strong plain open={open} />
          <td className="px-3">
            <Progress type={type} planned={t.planned} actual={t.actual} />
          </td>
        </tr>
        <tr aria-hidden="true">
          <td colSpan={6} className="h-4" />
        </tr>
      </>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Previsão</h1>
          <p className="text-xs text-muted">
            Defina quanto espera receber e gastar e compare com o que realmente aconteceu.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span
              className={cx(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                data.status === 'current' ? 'bg-month text-white' : 'bg-fg/10 text-muted',
              )}
            >
              {STATUS_LABEL[data.status]}
            </span>
          )}
          <PeriodNav
            label={monthLabel(year, month)}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onToday={() => {
              if (dirty && !confirm('Há alterações por guardar. Mudar de mês sem guardar?')) return
              setParams({}, { replace: true })
            }}
          />
        </div>
      </div>

      {error && <div className="card border-exp/40 bg-exp-row px-4 py-3 text-sm">{error}</div>}

      {data && totals && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card label="Receita" hint="previsto → real">
              <Pair planned={totals.income.planned} actual={totals.income.actual} />
              <Progress type="Income" planned={totals.income.planned} actual={totals.income.actual} wide />
            </Card>
            <Card label="Despesas" hint="previsto → real">
              <Pair planned={totals.expense.planned} actual={totals.expense.actual} />
              <Progress type="Expense" planned={totals.expense.planned} actual={totals.expense.actual} wide />
            </Card>
            <Card label="Receita − despesa" hint="previsto → real">
              <Pair
                planned={totals.income.planned - totals.expense.planned}
                actual={totals.income.actual - totals.expense.actual}
                signed
              />
            </Card>
            <Card label="Saldo final previsto" hint={prev === null ? 'sem saldo (antes da data de início)' : `a partir do saldo anterior de ${formatMoney(prev)}`}>
              <Big v={plannedEnd} />
            </Card>
            <Card
              label={data.status === 'past' ? 'Saldo final real' : 'Projeção para o fim do mês'}
              hint={data.status === 'past' ? undefined : 'real + o que falta do previsto'}
            >
              <Big v={projectedEnd} />
              {plannedEnd !== null && projectedEnd !== null && (
                <div className="text-xs text-muted">
                  {projectedEnd >= plannedEnd ? (
                    <span className="text-pos">
                      {formatMoney(projectedEnd - plannedEnd)} melhor
                    </span>
                  ) : (
                    <span className="text-neg">
                      {formatMoney(plannedEnd - projectedEnd)} pior
                    </span>
                  )}{' '}
                  do que o previsto
                </div>
              )}
            </Card>
          </div>

          {perAccount.length > 1 && (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-bg text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Por conta</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo anterior</th>
                    <th className="px-3 py-2 text-right font-medium" title="Previsto nas linhas desta conta · por baixo, o real">
                      Receita
                    </th>
                    <th className="px-3 py-2 text-right font-medium" title="Previsto nas linhas desta conta · por baixo, o real">
                      Despesa
                    </th>
                    <th className="px-3 py-2 text-right font-medium" title="Previsto · por baixo, o real">
                      Receita − despesa
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Saldo final previsto</th>
                    <th
                      className="px-3 py-2 text-right font-medium"
                      title="Saldo anterior + o que já entrou/saiu da conta + o que está previsto e ainda não aconteceu"
                    >
                      {data.status === 'past' ? 'Saldo final real' : 'Projeção fim do mês'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perAccount.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="px-4 py-1.5">
                        <span className="inline-flex items-center gap-2 font-medium">
                          {a.kind === 'MealCard' ? (
                            <Icon name="card" size={13} className="text-[#b8a444]" />
                          ) : (
                            <span className="size-2 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                          )}
                          {a.name}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted tabular">
                        {a.previousBalance === null ? '—' : formatMoney(a.previousBalance)}
                      </td>
                      <PlanActual planned={a.plannedIncome} actual={a.actualIncome} />
                      <PlanActual planned={a.plannedExpense} actual={a.actualExpense} expense />
                      <PlanActual planned={a.plannedNet} actual={a.actualNet} signed />
                      <td className={cx('px-3 py-1.5 text-right font-medium tabular', (a.plannedEnd ?? 0) < 0 && 'text-neg')}>
                        {a.plannedEnd === null ? '—' : formatMoney(a.plannedEnd)}
                      </td>
                      <td className={cx('px-3 py-1.5 text-right font-semibold tabular', (a.projectedEnd ?? 0) < 0 && 'text-neg')}>
                        {a.projectedEnd === null ? '—' : formatMoney(a.projectedEnd)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line bg-bg font-semibold">
                    <td className="px-4 py-1.5">Total</td>
                    <td className="px-3 py-1.5 text-right tabular">{anyBalance ? formatMoney(sumOf((a) => a.previousBalance)) : '—'}</td>
                    <PlanActual planned={sumOf((a) => a.plannedIncome)} actual={sumOf((a) => a.actualIncome)} />
                    <PlanActual planned={sumOf((a) => a.plannedExpense)} actual={sumOf((a) => a.actualExpense)} expense />
                    <PlanActual planned={sumOf((a) => a.plannedNet)} actual={sumOf((a) => a.actualNet)} signed />
                    <td className="px-3 py-1.5 text-right tabular">{anyBalance ? formatMoney(sumOf((a) => a.plannedEnd)) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular">{anyBalance ? formatMoney(sumOf((a) => a.projectedEnd)) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="card flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Preencher com</span>
            <button type="button" className="btn h-8 text-xs" onClick={() => fill('plan')}>
              Previsão do mês anterior
            </button>
            <button type="button" className="btn h-8 text-xs" onClick={() => fill('actual')}>
              Real do mês anterior
            </button>
            <button type="button" className="btn h-8 text-xs" onClick={() => fill('average')}>
              Média dos últimos 3 meses
            </button>
            <span className="ml-auto" />
            {dirty && <span className="text-xs text-muted">Alterações por guardar</span>}
            <button type="button" className="btn h-8" disabled={!dirty || busy} onClick={() => load(data)}>
              Descartar
            </button>
            <button type="button" className="btn-primary h-8" disabled={!dirty || busy} onClick={save}>
              Guardar previsão
            </button>
          </div>

          {!data.hasPlan && !dirty && (
            <div className="flex items-center gap-2 rounded-lg bg-inc-row px-4 py-2.5 text-sm">
              <Icon name="target" className="shrink-0" />
              Ainda não há previsão para {MONTHS[month - 1].toLowerCase()}. Escreva os valores esperados ou use um dos
              botões “Preencher com”.
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
              <thead className="text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-medium normal-case">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 tracking-normal">
                      <input type="checkbox" checked={onlyFilled} onChange={(e) => toggleOnlyFilled(e.target.checked)} />
                      Só linhas com valores
                    </label>
                  </th>
                  <th className="w-32 px-3 py-2 text-right font-medium">Previsto</th>
                  <th className="w-32 px-2 py-2 text-left font-medium">Conta</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Real</th>
                  <th className="w-28 px-3 py-2 text-right font-medium" title="Receita: real − previsto · Despesas: previsto − real">
                    Diferença
                  </th>
                  <th className="w-40 px-3 py-2 text-left font-medium">Execução</th>
                </tr>
              </thead>
              <tbody>
                {section('Income', data.income)}
                {section('Expense', data.expense)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card space-y-1.5 p-4">
      <div className="leading-tight">
        <div className="text-xs font-medium text-muted">{label}</div>
        {hint && <div className="text-[11px] text-muted/80">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Pair({ planned, actual, signed }: { planned: number; actual: number; signed?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 tabular">
      <span className="text-sm text-muted">{formatMoney(planned)}</span>
      <Icon name="right" size={12} className="text-muted" />
      <span className={cx('text-xl font-semibold tracking-tight', signed && actual < 0 && 'text-neg', signed && actual > 0 && 'text-pos')}>
        {formatMoney(actual)}
      </span>
    </div>
  )
}

/** Table cell with the planned value on top and the actual one underneath. */
function PlanActual({ planned, actual, expense, signed }: { planned: number; actual: number; expense?: boolean; signed?: boolean }) {
  const fmt = (v: number) => (signed ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMoney(Math.abs(v))}` : formatMoney(v))
  const over = expense && planned > 0 && actual > planned
  return (
    <td className="px-3 py-1 text-right leading-tight tabular">
      <div className={cx(signed && planned < 0 && 'text-neg', signed && planned > 0 && 'text-pos')}>
        {planned === 0 && actual === 0 ? <span className="text-cell-muted">–</span> : fmt(planned)}
      </div>
      {(planned !== 0 || actual !== 0) && (
        <div className={cx('text-[11px] font-normal', over ? 'text-neg' : 'text-muted')} title="Real">
          real {fmt(actual)}
        </div>
      )}
    </td>
  )
}

function Big({ v }: { v: number | null }) {
  return (
    <div className={cx('text-xl font-semibold tracking-tight tabular', v !== null && v < 0 && 'text-neg')}>
      {v === null ? '—' : formatMoney(v)}
    </div>
  )
}

function Num({ v, strong }: { v: number; strong?: boolean }) {
  return (
    <td className={cx('px-3 py-1.5 text-right tabular', strong && 'font-semibold')}>
      {v === 0 ? <span className="text-cell-muted">–</span> : formatNumber(v)}
    </td>
  )
}

/** Positive = good: income above plan, or expenses below plan. */
function Diff({
  type,
  planned,
  actual,
  strong,
  plain,
  open,
}: {
  type: EntryType
  planned: number
  actual: number
  strong?: boolean
  plain?: boolean
  /** Month not closed yet: a positive difference is still "to spend/receive", not a result. */
  open?: boolean
}) {
  const diff = type === 'Income' ? actual - planned : planned - actual
  const settled = !open || (type === 'Income' ? diff >= 0 : diff <= 0)
  return (
    <td
      className={cx(
        'px-3 py-1 text-right tabular',
        strong && 'font-semibold',
        !plain && settled && diff > 0 && 'text-pos',
        !plain && diff < 0 && (open && type === 'Income' ? 'text-muted' : 'text-neg'),
        !settled && 'text-muted',
      )}
      title={!settled ? (type === 'Income' ? 'Ainda por receber' : 'Ainda por gastar') : undefined}
    >
      {diff === 0 ? <span className="text-cell-muted">–</span> : `${diff > 0 ? '+' : '−'}${formatNumber(Math.abs(diff))}`}
    </td>
  )
}

/** How much of the plan was used (expenses) or reached (income). */
function Progress({ type, planned, actual, wide }: { type: EntryType; planned: number; actual: number; wide?: boolean }) {
  if (planned === 0) {
    return actual === 0 ? null : <span className="text-[11px] text-muted">sem previsão</span>
  }
  const ratio = actual / planned
  const over = type === 'Expense' && ratio > 1
  const reached = type === 'Income' && ratio >= 1
  return (
    <div className={cx('flex items-center gap-2', wide && 'pt-1')}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
        <div
          className={cx('h-full rounded-full', over ? 'bg-neg' : reached ? 'bg-pos' : 'bg-inc')}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
      <span className={cx('w-10 text-right text-[11px] tabular', over ? 'font-semibold text-neg' : 'text-muted')}>
        {Math.round(ratio * 100)}%
      </span>
    </div>
  )
}
