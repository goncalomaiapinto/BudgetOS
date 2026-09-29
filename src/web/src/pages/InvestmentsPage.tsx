import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateInput } from '../components/DateInput'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { api, type Category, type Holding, type HoldingHistory, type Valuation } from '../lib/api'
import { useApp } from '../lib/app-context'
import { amountToInput, cx, formatDate, formatMoney, formatPercent, parseAmount, todayIso } from '../lib/format'

const SWATCHES = ['#1E8C6E', '#4F81BD', '#7A4FB5', '#D2711C', '#0FA3C4', '#C0504D', '#8A94A3']
const compact = new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 })

function daysAgo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const diff = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / 86_400_000)
  if (diff <= 0) return 'hoje'
  if (diff === 1) return 'ontem'
  if (diff < 45) return `há ${diff} dias`
  const months = Math.round(diff / 30)
  return months < 12 ? `há ${months} meses` : `há mais de um ano`
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMoney(Math.abs(v))}`
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatPercent(Math.abs(v))}`

/** Growth between two updates with the money put in (or taken out) in between removed. */
function growth(previousValue: number, putIn: number, value: number) {
  const change = value - previousValue - putIn
  const basis = previousValue + putIn
  return { change, percent: basis > 0 ? change / basis : null }
}

function ChangeBadge({ change, percent }: { change: number; percent: number | null }) {
  return (
    <span className={cx('font-medium tabular', change > 0 && 'text-pos', change < 0 && 'text-neg')}>
      {percent !== null ? signedPct(percent) : ''} {percent !== null ? `(${signed(change)})` : signed(change)}
    </span>
  )
}

export default function InvestmentsPage() {
  const { version, refresh, toast, categories } = useApp()
  const [holdings, setHoldings] = useState<Holding[] | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Holding | 'new' | null>(null)
  const [valuing, setValuing] = useState<{ holding: Holding; valuation?: Valuation } | null>(null)
  const [deleting, setDeleting] = useState<Holding | null>(null)

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    Promise.all([api.holdings.list(), api.reports.dashboard(now.getFullYear(), now.getMonth() + 1)])
      .then(([h, d]) => {
        if (cancelled) return
        setHoldings(h)
        setBalance(d.current.balance)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [version])

  const total = holdings?.reduce((a, h) => a + h.estimatedValue, 0) ?? 0
  const invested = holdings?.reduce((a, h) => a + h.invested, 0) ?? 0
  const gain = total - invested

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Investimentos</h1>
          <p className="text-xs text-muted">
            O dinheiro entra como despesa numa subcategoria ligada; o valor atualiza-se à mão de vez em quando.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Novo investimento
        </button>
      </div>

      {error && <div className="card border-exp/40 bg-exp-row px-4 py-3 text-sm">{error}</div>}

      {holdings && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Valor atual" value={formatMoney(total)} hint="soma das últimas atualizações + o investido depois" />
            <Stat label="Total investido" value={formatMoney(invested)} hint="o que saiu da conta para aqui" />
            <Stat
              label="Ganho / perda"
              value={signed(gain)}
              valueClass={gain > 0 ? 'text-pos' : gain < 0 ? 'text-neg' : undefined}
              hint={invested > 0 ? `${formatPercent(gain / invested)} sobre o investido` : undefined}
            />
            <Stat
              label="Património"
              value={balance === null ? '—' : formatMoney(balance + total)}
              hint={balance === null ? undefined : `contas ${formatMoney(balance)} + investimentos`}
            />
          </div>

          {holdings.length === 0 && (
            <div className="card px-4 py-10 text-center text-sm text-muted">
              Ainda não há investimentos. Crie um com “Novo investimento”.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {holdings.map((h) => (
              <HoldingCard
                key={h.id}
                holding={h}
                version={version}
                onUpdate={() => setValuing({ holding: h })}
                onEditValuation={(v) => setValuing({ holding: h, valuation: v })}
                onDeleteValuation={async (v) => {
                  if (!confirm(`Apagar a atualização de ${formatDate(v.date)} (${formatMoney(v.value)})?`)) return
                  try {
                    await api.holdings.removeValuation(v.id)
                    toast('Atualização apagada.')
                    refresh()
                  } catch (e) {
                    toast((e as Error).message, 'error')
                  }
                }}
                onEdit={() => setEditing(h)}
                onDelete={() => setDeleting(h)}
              />
            ))}
          </div>
        </>
      )}

      {editing && (
        <HoldingDialog
          holding={editing === 'new' ? undefined : editing}
          holdings={holdings ?? []}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            toast(editing === 'new' ? `“${name}” criado.` : 'Investimento atualizado.')
            setEditing(null)
            refresh()
          }}
        />
      )}
      {valuing && (
        <ValuationDialog
          holding={valuing.holding}
          valuation={valuing.valuation}
          onClose={() => setValuing(null)}
          onSaved={(saved) => {
            const c = saved.lastValuation
            toast(
              c?.change != null && c.changePercent != null && !valuing.valuation
                ? `“${valuing.holding.name}” atualizado: ${signedPct(c.changePercent)} desde ${formatDate(c.previousDate!)}.`
                : `Valor de “${valuing.holding.name}” atualizado.`,
            )
            setValuing(null)
            refresh()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Apagar investimento"
          confirmLabel="Apagar"
          message={
            <>
              Apagar <strong>{deleting.name}</strong> e o seu histórico de valores? As transações ficam como estão; as
              subcategorias ligadas deixam de estar associadas.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.holdings.remove(deleting.id)
              toast('Investimento apagado.')
              refresh()
            } catch (e) {
              toast((e as Error).message, 'error')
            }
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, hint, valueClass }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('mt-1 text-xl font-semibold tracking-tight tabular', valueClass)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

function HoldingCard({
  holding: h,
  version,
  onUpdate,
  onEditValuation,
  onDeleteValuation,
  onEdit,
  onDelete,
}: {
  holding: Holding
  version: number
  onUpdate: () => void
  onEditValuation: (v: Valuation) => void
  onDeleteValuation: (v: Valuation) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [history, setHistory] = useState<HoldingHistory | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    api.holdings.history(h.id).then(setHistory).catch(() => setHistory(null))
  }, [h.id, version])

  // One point per date: invested carried forward (step), value only where there's an update.
  const chart = useMemo(() => {
    if (!history) return []
    const dates = [...new Set([...history.invested.map((p) => p.date), ...history.valuations.map((v) => v.date)])].sort()
    let inv = 0
    return dates.map((date) => {
      const p = history.invested.find((x) => x.date === date)
      if (p) inv = p.invested
      const v = history.valuations.find((x) => x.date === date)
      return { date, invested: inv, value: v ? v.value : null }
    })
  }, [history])

  const last = h.lastValuation
  const color = h.color ?? '#1E8C6E'

  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{h.name}</h2>
          <div className="text-xs text-muted">
            {h.subCategories.length === 0 ? (
              <span className="text-neg">Sem subcategoria ligada: edite para escolher onde regista os reforços.</span>
            ) : (
              h.subCategories.map((s) => `${s.categoryName} › ${s.name}`).join(' · ')
            )}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onEdit} aria-label="Editar" title="Editar">
          <Icon name="edit" />
        </button>
        <button type="button" className="icon-btn hover:text-neg" onClick={onDelete} aria-label="Apagar" title="Apagar">
          <Icon name="trash" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight tabular">{formatMoney(h.estimatedValue)}</div>
          <div className="text-xs text-muted">
            {last ? (
              <>
                Último valor {formatMoney(last.value)} em {formatDate(last.date)} ({daysAgo(last.date)})
                {h.investedSinceValuation !== 0 && <> · {signed(h.investedSinceValuation)} depois disso</>}
                {last.change != null && (
                  <div className="mt-0.5">
                    Desde a atualização anterior ({formatDate(last.previousDate!)}):{' '}
                    <ChangeBadge change={last.change} percent={last.changePercent ?? null} />
                  </div>
                )}
              </>
            ) : (
              'Ainda sem atualizações: valor igual ao investido'
            )}
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={onUpdate}>
          <Icon name="edit" /> Atualizar valor
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-bg px-3 py-2 text-sm">
        <div>
          <div className="text-xs text-muted">Investido</div>
          <div className="font-medium tabular">{formatMoney(h.invested)}</div>
        </div>
        <div>
          <div className="text-xs text-muted" title="Último valor − investido até essa data">
            Ganho {last ? `(até ${formatDate(last.date)})` : ''}
          </div>
          <div className={cx('font-medium tabular', (h.gain ?? 0) > 0 && 'text-pos', (h.gain ?? 0) < 0 && 'text-neg')}>
            {h.gain === null ? '—' : signed(h.gain)}
            {h.gainPercent !== null && <span className="ml-1 text-xs">({formatPercent(h.gainPercent)})</span>}
          </div>
        </div>
      </div>

      {chart.length > 1 && (
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--c-grid)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => formatDate(d).slice(0, 5)}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickFormatter={(v: number) => compact.format(v)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { date: string; invested: number; value: number | null }
                  return (
                    <div className="card px-3 py-2 text-xs shadow-lg">
                      <div className="mb-1 font-semibold">{formatDate(p.date)}</div>
                      {p.value !== null && (
                        <div>
                          Valor: <span className="tabular">{formatMoney(p.value)}</span>
                        </div>
                      )}
                      <div className="text-muted">
                        Investido: <span className="tabular">{formatMoney(p.invested)}</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Legend verticalAlign="top" align="right" height={22} iconSize={10} itemSorter={null}
                formatter={(v) => <span className="text-xs text-fg">{v}</span>} />
              <Line
                dataKey="value"
                name="Valor"
                stroke={color}
                strokeWidth={2}
                connectNulls
                isAnimationActive={false}
                dot={{ r: 3.5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }}
              />
              <Line
                dataKey="invested"
                name="Investido"
                type="stepAfter"
                stroke="var(--muted)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {history && history.valuations.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-fg"
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
          >
            <Icon name={showHistory ? 'down' : 'right'} size={14} />
            Histórico de atualizações ({history.valuations.length})
          </button>
          {showHistory && (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Data</th>
                  <th className="py-1 text-right font-medium">Valor</th>
                  <th className="py-1 text-right font-medium">Investido</th>
                  <th className="py-1 text-right font-medium" title="Desde a atualização anterior, sem contar o dinheiro posto entretanto">
                    Variação
                  </th>
                  <th className="py-1 text-right font-medium">Ganho total</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {[...history.valuations].reverse().map((v) => {
                  const g = v.value - v.investedAtDate
                  return (
                    <tr key={v.id} className="group border-t border-line">
                      <td className="py-1 tabular" title={v.note ?? undefined}>
                        {formatDate(v.date)}
                        {v.note && <span className="ml-1 text-xs text-muted">· {v.note}</span>}
                      </td>
                      <td className="py-1 text-right tabular">{formatMoney(v.value)}</td>
                      <td className="py-1 text-right text-muted tabular">{formatMoney(v.investedAtDate)}</td>
                      <td className="py-1 text-right text-xs">
                        {v.change != null ? (
                          <span className={cx('tabular', v.change > 0 && 'text-pos', v.change < 0 && 'text-neg')}>
                            {v.changePercent != null ? signedPct(v.changePercent) : signed(v.change)}
                          </span>
                        ) : (
                          <span className="text-cell-muted">–</span>
                        )}
                      </td>
                      <td className={cx('py-1 text-right tabular', g > 0 && 'text-pos', g < 0 && 'text-neg')}>{signed(g)}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button type="button" className="icon-btn" aria-label="Editar" onClick={() => onEditValuation(v)}>
                            <Icon name="edit" size={14} />
                          </button>
                          <button type="button" className="icon-btn hover:text-neg" aria-label="Apagar" onClick={() => onDeleteValuation(v)}>
                            <Icon name="trash" size={14} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {h.subCategories.length > 0 && (
        <Link
          to={`/transacoes?period=all&cat=${h.subCategories[0].categoryId}&sub=${h.subCategories[0].id}`}
          className="mt-3 self-start text-xs text-inc hover:underline dark:text-[#9fc0ea]"
        >
          Ver reforços →
        </Link>
      )}
    </div>
  )
}

function ValuationDialog({
  holding,
  valuation,
  onClose,
  onSaved,
}: {
  holding: Holding
  valuation?: Valuation
  onClose: () => void
  onSaved: (holding: Holding) => void
}) {
  const [date, setDate] = useState(valuation?.date ?? todayIso())
  const [value, setValue] = useState(valuation ? amountToInput(valuation.value) : '')
  const [note, setNote] = useState(valuation?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Live "+x% since last update" while typing a new value (only for a new update after the last one).
  const typed = parseAmount(value)
  const last = holding.lastValuation
  const preview =
    !valuation && last && typed !== null && typed >= 0 && date > last.date
      ? {
          since: last.date,
          previousValue: last.value,
          putIn: holding.investedSinceValuation,
          ...growth(last.value, holding.investedSinceValuation, typed),
        }
      : null

  const save = async () => {
    const v = parseAmount(value)
    if (v === null || v < 0) {
      setError('Indique o valor (ex.: 1 234,56).')
      return
    }
    setBusy(true)
    try {
      const body = { date, value: v, note: note.trim() || null }
      if (valuation) {
        await api.holdings.updateValuation(valuation.id, body)
        onSaved(holding)
      } else {
        onSaved(await api.holdings.addValuation(holding.id, body))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${valuation ? 'Editar atualização' : 'Atualizar valor'} · ${holding.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="val-form" className="btn-primary" disabled={busy}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id="val-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid grid-cols-[1fr_1.2fr] gap-3">
          <div>
            <label className="label" htmlFor="val-value">
              Valor atual (€)
            </label>
            <input
              id="val-value"
              className="input h-11 text-right text-lg font-semibold tabular"
              inputMode="decimal"
              autoFocus
              placeholder="0,00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="val-date">
              Data
            </label>
            <DateInput id="val-date" value={date} onChange={setDate} className="[&_.input]:h-11" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="val-note">
            Nota <span className="normal-case">(opcional)</span>
          </label>
          <input id="val-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {preview && (
          <div className="rounded-md bg-bg px-3 py-2 text-sm">
            Desde {formatDate(preview.since)} ({formatMoney(preview.previousValue)}):{' '}
            <ChangeBadge change={preview.change} percent={preview.percent} />
            {preview.putIn !== 0 && (
              <div className="mt-0.5 text-xs text-muted">
                Já desconta os {formatMoney(Math.abs(preview.putIn))} {preview.putIn > 0 ? 'investidos' : 'retirados'} entretanto.
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted">
          {holding.lastValuation && !valuation
            ? `Último valor: ${formatMoney(holding.lastValuation.value)} em ${formatDate(holding.lastValuation.date)}. `
            : ''}
          Investido até hoje: {formatMoney(holding.invested)}. Uma nova atualização no mesmo dia substitui a anterior.
        </p>
        {error && <p className="text-sm text-neg">{error}</p>}
      </form>
    </Modal>
  )
}

function HoldingDialog({
  holding,
  holdings,
  categories,
  onClose,
  onSaved,
}: {
  holding?: Holding
  holdings: Holding[]
  categories: Category[]
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState(holding?.name ?? '')
  const [color, setColor] = useState(holding?.color ?? SWATCHES[0])
  const [linked, setLinked] = useState<Set<number>>(new Set(holding?.subCategories.map((s) => s.id) ?? []))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Subcategory id → name of the other holding it already belongs to.
  const takenBy = new Map(
    holdings.filter((x) => x.id !== holding?.id).flatMap((x) => x.subCategories.map((s) => [s.id, x.name] as const)),
  )

  const toggle = (id: number) => {
    const next = new Set(linked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLinked(next)
  }

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const body = { name: name.trim(), color, subCategoryIds: [...linked] }
      if (holding) await api.holdings.update(holding.id, body)
      else await api.holdings.create(body)
      onSaved(name.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={holding ? 'Editar investimento' : 'Novo investimento'}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="holding-form" className="btn-primary" disabled={busy || !name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id="holding-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div>
          <label className="label" htmlFor="holding-name">
            Nome
          </label>
          <input
            id="holding-name"
            className="input"
            autoFocus
            maxLength={100}
            placeholder="ex.: Ações (XTB)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Cor</label>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                className={cx('size-7 cursor-pointer rounded-md ring-offset-2 ring-offset-surface', color.toUpperCase() === s && 'ring-2 ring-fg')}
                style={{ background: s }}
                onClick={() => setColor(s)}
                aria-label={`Cor ${s}`}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Subcategorias ligadas</label>
          <p className="mb-2 text-xs text-muted">
            Despesas nestas subcategorias contam como dinheiro posto aqui; receitas contam como dinheiro retirado.
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-line p-2">
            {categories
              .map((c) => ({ ...c, subCategories: c.subCategories.filter((s) => s.isActive || linked.has(s.id)) }))
              .filter((c) => c.subCategories.length > 0)
              .map((c) => (
              <div key={c.id}>
                <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {c.name} <span className="font-normal normal-case">({c.type === 'Income' ? 'receita' : 'despesa'})</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {c.subCategories.map((s) => {
                    const other = takenBy.get(s.id)
                    return (
                      <label
                        key={s.id}
                        className={cx('flex items-center gap-2 text-sm', other ? 'cursor-not-allowed text-muted' : 'cursor-pointer')}
                        title={other ? `Já ligada a “${other}”` : undefined}
                      >
                        <input type="checkbox" disabled={!!other} checked={linked.has(s.id)} onChange={() => toggle(s.id)} />
                        <span className="truncate">{s.name}</span>
                        {other && <span className="truncate text-[11px]">({other})</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
              ))}
          </div>
        </div>
        {error && <p className="text-sm text-neg">{error}</p>}
      </form>
    </Modal>
  )
}
