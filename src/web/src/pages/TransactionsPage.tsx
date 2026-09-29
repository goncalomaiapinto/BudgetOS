import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { PeriodNav, monthLabel } from '../components/PeriodNav'
import {
  ACCOUNT_LABELS,
  api,
  type EntryType,
  type PaymentAccount,
  type Transaction,
  type TransactionFilter,
  type TransactionPage,
} from '../lib/api'
import { useApp } from '../lib/app-context'
import { cx, formatDate, formatMoney, monthRange, shiftMonth, toIso } from '../lib/format'

type Period = 'month' | 'year' | 'all'
const PAGE_SIZE = 100

/** Filters live in the URL so the budget grid can deep-link here (drill-down). */
export default function TransactionsPage() {
  const { categories, version, openTransaction, refresh, toast } = useApp()
  const [params, setParams] = useSearchParams()
  const now = new Date()

  const period = (params.get('period') as Period) || 'month'
  const year = Number(params.get('y')) || now.getFullYear()
  const month = Number(params.get('m')) || now.getMonth() + 1
  const type = (params.get('type') as EntryType) || ''
  const categoryId = Number(params.get('cat')) || ''
  const subCategoryId = Number(params.get('sub')) || ''
  const account = (params.get('acc') as PaymentAccount) || ''
  const search = params.get('q') ?? ''
  const page = Number(params.get('page')) || 1

  const [searchText, setSearchText] = useState(search)
  const [data, setData] = useState<TransactionPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Transaction | null>(null)

  const update = (changes: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, String(v))
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounced search box → URL.
  useEffect(() => {
    if (searchText === search) return
    const t = setTimeout(() => update({ q: searchText.trim() || null }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const filter = useMemo<TransactionFilter>(() => {
    const f: TransactionFilter = { page, pageSize: PAGE_SIZE }
    if (period === 'month') Object.assign(f, monthRange(year, month))
    if (period === 'year') Object.assign(f, { from: toIso(year, 1, 1), to: toIso(year, 12, 31) })
    if (type) f.type = type
    if (categoryId) f.categoryId = categoryId
    if (subCategoryId) f.subCategoryId = subCategoryId
    if (account) f.account = account
    if (search) f.search = search
    return f
  }, [period, year, month, type, categoryId, subCategoryId, account, search, page])

  useEffect(() => {
    let cancelled = false
    api.transactions
      .list(filter)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [filter, version])

  const categoryOptions = categories.filter((c) => !type || c.type === type)
  const selectedCategory = categories.find((c) => c.id === categoryId)
  const hasFilters = type || categoryId || subCategoryId || account || search

  const move = (delta: number) => {
    if (period === 'month') {
      const n = shiftMonth(year, month, delta)
      update({ y: n.year, m: n.month })
    } else {
      update({ y: year + delta })
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Transações</h1>
        <div className="flex items-center gap-2">
          <select
            className="input h-8 w-auto"
            value={period}
            onChange={(e) => update({ period: e.target.value === 'month' ? null : e.target.value })}
            aria-label="Período"
          >
            <option value="month">Mês</option>
            <option value="year">Ano</option>
            <option value="all">Tudo</option>
          </select>
          {period !== 'all' && (
            <PeriodNav
              label={period === 'month' ? monthLabel(year, month) : String(year)}
              onPrev={() => move(-1)}
              onNext={() => move(1)}
              onToday={() => update({ y: null, m: null })}
            />
          )}
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <div className="w-32">
          <label className="label">Tipo</label>
          <select
            className="input"
            value={type}
            onChange={(e) => update({ type: e.target.value || null, cat: null, sub: null })}
          >
            <option value="">Todos</option>
            <option value="Income">Renda</option>
            <option value="Expense">Despesa</option>
          </select>
        </div>
        <div className="w-44">
          <label className="label">Categoria</label>
          <select
            className="input"
            value={categoryId}
            onChange={(e) => update({ cat: e.target.value || null, sub: null })}
          >
            <option value="">Todas</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-52">
          <label className="label">Subcategoria</label>
          <select
            className="input"
            value={subCategoryId}
            disabled={!selectedCategory}
            onChange={(e) => update({ sub: e.target.value || null })}
          >
            <option value="">Todas</option>
            {selectedCategory?.subCategories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="label">Conta</label>
          <select className="input" value={account} onChange={(e) => update({ acc: e.target.value || null })}>
            <option value="">Todas</option>
            <option value="Main">{ACCOUNT_LABELS.Main}</option>
            <option value="MealCard">{ACCOUNT_LABELS.MealCard}</option>
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="label">Pesquisa na descrição</label>
          <div className="relative">
            <Icon name="search" className="absolute top-2.5 left-2.5 text-muted" />
            <input
              className="input pl-8"
              value={searchText}
              placeholder="ex.: continente"
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
        {hasFilters && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSearchText('')
              update({ type: null, cat: null, sub: null, acc: null, q: null })
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {error && <div className="card border-exp/40 bg-exp-row px-4 py-3 text-sm">{error}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-bg text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium">Subcategoria</th>
                <th className="px-3 py-2 font-medium">Descrição</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t) => (
                <tr
                  key={t.id}
                  className="group cursor-pointer border-b border-line last:border-0 hover:bg-fg/[0.03]"
                  onClick={() => openTransaction(t)}
                >
                  <td className="px-3 py-2 whitespace-nowrap tabular">{formatDate(t.date)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cx(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        t.type === 'Income' ? 'bg-inc-row text-inc dark:text-[#9fc0ea]' : 'bg-exp-row text-neg',
                      )}
                    >
                      {t.type === 'Income' ? 'Renda' : 'Despesa'}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: t.categoryColor ?? '#999' }} />
                      {t.categoryName}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{t.subCategoryName ?? '—'}</td>
                  <td className="max-w-72 truncate px-3 py-2" title={t.description ?? ''}>
                    {t.description}
                  </td>
                  <td
                    className={cx(
                      'px-3 py-2 text-right font-medium whitespace-nowrap tabular',
                      t.type === 'Income' ? 'text-pos' : 'text-neg',
                    )}
                  >
                    {t.account === 'MealCard' && (
                      <span title={ACCOUNT_LABELS.MealCard} className="mr-1.5 inline-block align-[-2px] text-[#b8a444]">
                        <Icon name="card" size={14} />
                      </span>
                    )}
                    {t.type === 'Income' ? '+' : '−'}
                    {formatMoney(t.amount)}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Editar"
                        onClick={(e) => {
                          e.stopPropagation()
                          openTransaction(t)
                        }}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn hover:text-neg"
                        aria-label="Remover"
                        onClick={(e) => {
                          e.stopPropagation()
                          setToDelete(t)
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-muted">
                    Sem transações para este filtro.{' '}
                    <button type="button" className="text-inc underline" onClick={() => openTransaction()}>
                      Adicionar uma
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
            {data && data.totalCount > 0 && (
              <tfoot className="border-t-2 border-line bg-bg text-sm">
                <tr>
                  <td colSpan={7} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
                      <span className="mr-auto text-muted">
                        {data.totalCount} transaç{data.totalCount === 1 ? 'ão' : 'ões'}
                      </span>
                      <span>
                        Receitas <strong className="text-pos tabular">{formatMoney(data.totals.income)}</strong>
                      </span>
                      <span>
                        Despesas <strong className="text-neg tabular">{formatMoney(data.totals.expense)}</strong>
                      </span>
                      <span>
                        Saldo{' '}
                        <strong className={cx('tabular', data.totals.net >= 0 ? 'text-pos' : 'text-neg')}>
                          {formatMoney(data.totals.net)}
                        </strong>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button type="button" className="btn h-8" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
            ‹ Anterior
          </button>
          <span className="text-muted tabular">
            Página {page} de {pages}
          </span>
          <button
            type="button"
            className="btn h-8"
            disabled={page >= pages}
            onClick={() => update({ page: page + 1 })}
          >
            Seguinte ›
          </button>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Remover transação"
          confirmLabel="Remover"
          message={
            <>
              Remover a {toDelete.type === 'Income' ? 'renda' : 'despesa'} de{' '}
              <strong>{formatMoney(toDelete.amount)}</strong> de {formatDate(toDelete.date)} (
              {toDelete.subCategoryName ?? toDelete.categoryName})?
              {toDelete.description && <div className="mt-1 text-muted">“{toDelete.description}”</div>}
            </>
          }
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await api.transactions.remove(toDelete.id)
              toast('Transação removida.')
              refresh()
            } catch (e) {
              toast((e as Error).message, 'error')
            }
            setToDelete(null)
          }}
        />
      )}
    </div>
  )
}
