import { useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { api, ApiError, type Category, type EntryType, type SubCategory } from '../lib/api'
import { useApp } from '../lib/app-context'
import { cx } from '../lib/format'

const SWATCHES = ['#1F497D', '#4F81BD', '#0FA3C4', '#6E9A2F', '#D2711C', '#C0504D', '#7A4FB5', '#8A94A3']

type EditState =
  | { kind: 'category'; category?: Category; type: EntryType }
  | { kind: 'subcategory'; sub?: SubCategory; categoryId: number }

type DeleteState = { kind: 'category'; item: Category } | { kind: 'subcategory'; item: SubCategory; category: Category }

export default function CategoriesPage() {
  const { categories, refresh, toast } = useApp()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<DeleteState | null>(null)
  const [adding, setAdding] = useState<{ categoryId: number; name: string } | null>(null)

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action()
      if (success) toast(success)
      refresh()
      return true
    } catch (e) {
      toast((e as Error).message, 'error')
      return false
    }
  }

  const toggleExpanded = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  const moveCategory = (list: Category[], index: number, delta: number) => {
    const ids = list.map((c) => c.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    void run(() => api.categories.reorder(ids))
  }

  const moveSub = (list: SubCategory[], index: number, delta: number) => {
    const ids = list.map((s) => s.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    void run(() => api.subCategories.reorder(ids))
  }

  const addSub = async () => {
    if (!adding || !adding.name.trim()) return
    const ok = await run(
      () => api.subCategories.create({ categoryId: adding.categoryId, name: adding.name.trim() }),
      'Subcategoria criada.',
    )
    if (ok) setAdding({ categoryId: adding.categoryId, name: '' })
  }

  const section = (type: EntryType) => {
    const list = categories.filter((c) => c.type === type)
    const isIncome = type === 'Income'
    return (
      <section className="card overflow-hidden">
        <div
          className={cx(
            'flex items-center justify-between px-4 py-2.5 font-bold tracking-wider text-white',
            isIncome ? 'bg-inc' : 'bg-exp',
          )}
        >
          <span>{isIncome ? 'RENDA' : 'DESPESAS'}</span>
          <button
            type="button"
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2.5 text-xs font-semibold tracking-normal hover:bg-white/25"
            onClick={() => setEditing({ kind: 'category', type })}
          >
            <Icon name="plus" size={14} /> Nova categoria
          </button>
        </div>
        <ul className="divide-y divide-line">
          {list.map((c, i) => {
            const open = expanded.has(c.id)
            const subs = c.subCategories
            return (
              <li key={c.id} className={cx(!c.isActive && 'opacity-60')}>
                <div className="group flex items-center gap-2 px-3 py-2 hover:bg-fg/[0.03]">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => toggleExpanded(c.id)}
                    aria-expanded={open}
                    aria-label={open ? 'Recolher' : 'Expandir'}
                  >
                    <Icon name={open ? 'down' : 'right'} />
                  </button>
                  <span
                    className="size-3.5 shrink-0 rounded"
                    style={{ background: c.color ?? 'transparent', border: c.color ? undefined : '1px dashed var(--muted)' }}
                  />
                  <button
                    type="button"
                    className="cursor-pointer text-left font-semibold"
                    onClick={() => toggleExpanded(c.id)}
                  >
                    {c.name}
                  </button>
                  {!c.isActive && <Badge>inativa</Badge>}
                  <span className="text-xs text-muted">
                    {subs.length} subcategoria{subs.length === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto" />
                  <TxCount n={c.transactionCount} />
                  <RowActions
                    isActive={c.isActive}
                    canUp={i > 0}
                    canDown={i < list.length - 1}
                    onUp={() => moveCategory(list, i, -1)}
                    onDown={() => moveCategory(list, i, 1)}
                    onToggleActive={() =>
                      run(
                        () => api.categories.update(c.id, { name: c.name, color: c.color, isActive: !c.isActive }),
                        c.isActive ? 'Categoria desativada.' : 'Categoria ativada.',
                      )
                    }
                    onEdit={() => setEditing({ kind: 'category', category: c, type: c.type })}
                    onDelete={() => setDeleting({ kind: 'category', item: c })}
                  />
                </div>

                {open && (
                  <ul className="border-t border-line bg-bg/60 pb-2">
                    {subs.map((s, j) => (
                      <li
                        key={s.id}
                        className={cx('group flex items-center gap-2 py-1.5 pr-3 pl-14 hover:bg-fg/[0.03]', !s.isActive && 'opacity-60')}
                      >
                        <span className="min-w-0 truncate">{s.name}</span>
                        {!s.isActive && <Badge>inativa</Badge>}
                        <span className="ml-auto" />
                        <TxCount n={s.transactionCount} />
                        <RowActions
                          isActive={s.isActive}
                          canUp={j > 0}
                          canDown={j < subs.length - 1}
                          onUp={() => moveSub(subs, j, -1)}
                          onDown={() => moveSub(subs, j, 1)}
                          onToggleActive={() =>
                            run(
                              () => api.subCategories.update(s.id, { categoryId: s.categoryId, name: s.name, isActive: !s.isActive }),
                              s.isActive ? 'Subcategoria desativada.' : 'Subcategoria ativada.',
                            )
                          }
                          onEdit={() => setEditing({ kind: 'subcategory', sub: s, categoryId: c.id })}
                          onDelete={() => setDeleting({ kind: 'subcategory', item: s, category: c })}
                        />
                      </li>
                    ))}
                    <li className="flex items-center gap-2 pt-2 pr-3 pl-14">
                      {adding?.categoryId === c.id ? (
                        <form
                          className="flex w-full max-w-md gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void addSub()
                          }}
                        >
                          <input
                            className="input h-8"
                            autoFocus
                            placeholder="Nome da subcategoria"
                            maxLength={100}
                            value={adding.name}
                            onChange={(e) => setAdding({ categoryId: c.id, name: e.target.value })}
                            onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                          />
                          <button type="submit" className="btn-primary h-8" disabled={!adding.name.trim()}>
                            Adicionar
                          </button>
                          <button type="button" className="btn-ghost h-8" onClick={() => setAdding(null)}>
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-inc hover:underline dark:text-[#9fc0ea]"
                          onClick={() => setAdding({ categoryId: c.id, name: '' })}
                        >
                          <Icon name="plus" size={14} /> Nova subcategoria
                        </button>
                      )}
                    </li>
                  </ul>
                )}
              </li>
            )
          })}
          {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Sem categorias.</li>}
        </ul>
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Categorias</h1>
          <p className="text-xs text-muted">
            Editar nomes ou cores não altera as transações. Desativar esconde o item nas novas transações sem perder o
            histórico.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn h-8 text-xs" onClick={() => setExpanded(new Set(categories.map((c) => c.id)))}>
            Expandir tudo
          </button>
          <button type="button" className="btn h-8 text-xs" onClick={() => setExpanded(new Set())}>
            Recolher tudo
          </button>
        </div>
      </div>

      {section('Income')}
      {section('Expense')}

      {editing?.kind === 'category' && (
        <CategoryDialog state={editing} onClose={() => setEditing(null)} run={run} />
      )}
      {editing?.kind === 'subcategory' && (
        <SubCategoryDialog state={editing} categories={categories} onClose={() => setEditing(null)} run={run} />
      )}
      {deleting && <DeleteDialog state={deleting} categories={categories} onClose={() => setDeleting(null)} run={run} />}
    </div>
  )
}

type Run = (action: () => Promise<unknown>, success?: string) => Promise<boolean>

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[11px] font-medium text-muted">{children}</span>
}

function TxCount({ n }: { n: number }) {
  return (
    <span
      className={cx('min-w-24 text-right text-xs tabular', n > 0 ? 'text-fg' : 'text-muted')}
      title="Transações associadas"
    >
      {n} transaç{n === 1 ? 'ão' : 'ões'}
    </span>
  )
}

function RowActions(p: {
  isActive: boolean
  canUp: boolean
  canDown: boolean
  onUp: () => void
  onDown: () => void
  onToggleActive: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <span className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <button type="button" className="icon-btn" disabled={!p.canUp} onClick={p.onUp} aria-label="Subir" title="Subir">
        <Icon name="up" />
      </button>
      <button type="button" className="icon-btn" disabled={!p.canDown} onClick={p.onDown} aria-label="Descer" title="Descer">
        <Icon name="down" />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={p.onToggleActive}
        aria-label={p.isActive ? 'Desativar' : 'Ativar'}
        title={p.isActive ? 'Desativar (esconde nas novas transações)' : 'Ativar'}
      >
        <Icon name={p.isActive ? 'eye' : 'eyeOff'} />
      </button>
      <button type="button" className="icon-btn" onClick={p.onEdit} aria-label="Editar" title="Editar">
        <Icon name="edit" />
      </button>
      <button type="button" className="icon-btn hover:text-neg" onClick={p.onDelete} aria-label="Apagar" title="Apagar">
        <Icon name="trash" />
      </button>
    </span>
  )
}

function CategoryDialog({
  state,
  onClose,
  run,
}: {
  state: Extract<EditState, { kind: 'category' }>
  onClose: () => void
  run: Run
}) {
  const existing = state.category
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<EntryType>(existing?.type ?? state.type)
  const [color, setColor] = useState(existing?.color ?? SWATCHES[1])
  const [busy, setBusy] = useState(false)
  // Changing the type would break transactions already booked against the category.
  const typeLocked = !!existing && existing.transactionCount > 0

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    const ok = await run(
      () =>
        existing
          ? api.categories.update(existing.id, { name: name.trim(), type, color: color || null })
          : api.categories.create({ name: name.trim(), type, color: color || null }),
      existing ? 'Categoria atualizada.' : 'Categoria criada.',
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title={existing ? 'Editar categoria' : 'Nova categoria'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="cat-form" className="btn-primary" disabled={busy || !name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id="cat-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div>
          <label className="label" htmlFor="cat-name">
            Nome
          </label>
          <input id="cat-name" className="input" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <div className="flex gap-2">
            {(['Income', 'Expense'] as const).map((t) => (
              <label
                key={t}
                className={cx(
                  'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
                  type === t ? (t === 'Income' ? 'border-inc bg-inc-row' : 'border-exp bg-exp-row') : 'border-line',
                  typeLocked && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="cat-type"
                  className="sr-only"
                  checked={type === t}
                  disabled={typeLocked}
                  onChange={() => setType(t)}
                />
                {t === 'Income' ? 'Renda' : 'Despesa'}
              </label>
            ))}
          </div>
          {typeLocked && (
            <p className="mt-1 text-xs text-muted">O tipo não pode ser alterado porque a categoria já tem transações.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="cat-color">
            Cor
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                className={cx(
                  'size-7 cursor-pointer rounded-md ring-offset-2 ring-offset-surface',
                  color.toUpperCase() === s && 'ring-2 ring-fg',
                )}
                style={{ background: s }}
                onClick={() => setColor(s)}
                aria-label={`Cor ${s}`}
              />
            ))}
            <input
              id="cat-color"
              type="color"
              className="h-7 w-10 cursor-pointer rounded border border-line bg-surface"
              value={color || '#8A94A3'}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              title="Outra cor"
            />
          </div>
        </div>
      </form>
    </Modal>
  )
}

function SubCategoryDialog({
  state,
  categories,
  onClose,
  run,
}: {
  state: Extract<EditState, { kind: 'subcategory' }>
  categories: Category[]
  onClose: () => void
  run: Run
}) {
  const existing = state.sub!
  const current = categories.find((c) => c.id === state.categoryId)!
  const [name, setName] = useState(existing.name)
  const [categoryId, setCategoryId] = useState(state.categoryId)
  const [busy, setBusy] = useState(false)
  const targets = categories.filter((c) => c.type === current.type)
  const moving = categoryId !== state.categoryId

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    const ok = await run(
      () => api.subCategories.update(existing.id, { categoryId, name: name.trim() }),
      moving ? 'Subcategoria movida.' : 'Subcategoria atualizada.',
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Editar subcategoria"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="sub-form" className="btn-primary" disabled={busy || !name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id="sub-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div>
          <label className="label" htmlFor="sub-name">
            Nome
          </label>
          <input id="sub-name" className="input" autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sub-cat">
            Categoria
          </label>
          <select id="sub-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {moving && existing.transactionCount > 0 && (
            <p className="mt-1.5 rounded bg-inc-row px-2 py-1.5 text-xs">
              As {existing.transactionCount} transações desta subcategoria passam também para a nova categoria.
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}

function DeleteDialog({
  state,
  categories,
  onClose,
  run,
}: {
  state: DeleteState
  categories: Category[]
  onClose: () => void
  run: Run
}) {
  const isCategory = state.kind === 'category'
  const item = state.item
  const type = isCategory ? state.item.type : state.category.type
  const count = item.transactionCount
  const label = isCategory ? 'categoria' : 'subcategoria'
  const capitalized = isCategory ? 'Categoria' : 'Subcategoria'
  const { toast, refresh } = useApp()

  // A category can't move its transactions to itself; a subcategory can move them to a sibling (or to "no subcategory").
  const targets = categories.filter((c) => c.type === type && (!isCategory || c.id !== item.id))
  const [mode, setMode] = useState<'move' | 'delete'>('move')
  const [targetCat, setTargetCat] = useState<number | ''>(
    isCategory ? (targets[0]?.id ?? '') : state.category.id,
  )
  const [targetSub, setTargetSub] = useState<number | ''>('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subOptions =
    categories.find((c) => c.id === targetCat)?.subCategories.filter((s) => isCategory || s.id !== item.id) ?? []

  const remove = (options = {}) =>
    isCategory ? api.categories.remove(item.id, options) : api.subCategories.remove(item.id, options)

  if (count === 0) {
    const subCount = isCategory ? state.item.subCategories.length : 0
    return (
      <ConfirmDialog
        title={`Apagar ${label}`}
        confirmLabel="Apagar"
        message={
          <>
            Apagar a {label} <strong>{item.name}</strong>?
            {subCount > 0 &&
              (subCount === 1
                ? ' A sua subcategoria (sem transações) também será apagada.'
                : ` As suas ${subCount} subcategorias (sem transações) também serão apagadas.`)}
          </>
        }
        onClose={onClose}
        onConfirm={async () => {
          if (await run(() => remove(), `${capitalized} apagada.`)) onClose()
        }}
      />
    )
  }

  const canSubmit =
    mode === 'move' ? targetCat !== '' : confirmText.trim().toLowerCase() === item.name.trim().toLowerCase()

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'move') {
        await remove({ moveToCategoryId: targetCat, moveToSubCategoryId: targetSub === '' ? undefined : targetSub })
      } else {
        await remove({ deleteTransactions: true })
      }
      toast(mode === 'move' ? `Transações movidas e ${label} apagada.` : `${capitalized} e transações apagadas.`)
      refresh()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Apagar ${label} “${item.name}”`}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-danger" disabled={busy || !canSubmit} onClick={submit}>
            {mode === 'move' ? 'Mover e apagar' : 'Apagar tudo'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex gap-2 rounded-md bg-exp-row px-3 py-2">
          <Icon name="alert" className="mt-0.5 shrink-0 text-neg" />
          <div>
            Esta {label} tem <strong>{count} transaç{count === 1 ? 'ão' : 'ões'}</strong> associada
            {count === 1 ? '' : 's'}
            {isCategory && state.item.subCategories.length > 0 && (
              <>
                {' '}e {state.item.subCategories.length}{' '}
                {state.item.subCategories.length === 1 ? 'subcategoria (que também será apagada)' : 'subcategorias (que também serão apagadas)'}
              </>
            )}
            . O que fazer com as transações?
          </div>
        </div>

        <label className="flex cursor-pointer gap-2">
          <input type="radio" name="del-mode" checked={mode === 'move'} onChange={() => setMode('move')} className="mt-1" />
          <div className="flex-1">
            <div className="font-medium">Mover para…</div>
            {mode === 'move' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  className="input"
                  value={targetCat}
                  onChange={(e) => {
                    setTargetCat(e.target.value ? Number(e.target.value) : '')
                    setTargetSub('')
                  }}
                  aria-label="Categoria de destino"
                >
                  {targets.length === 0 && <option value="">(sem categorias do mesmo tipo)</option>}
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={targetSub}
                  onChange={(e) => setTargetSub(e.target.value ? Number(e.target.value) : '')}
                  aria-label="Subcategoria de destino"
                >
                  <option value="">(sem subcategoria)</option>
                  {subOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </label>

        <label className="flex cursor-pointer gap-2">
          <input type="radio" name="del-mode" checked={mode === 'delete'} onChange={() => setMode('delete')} className="mt-1" />
          <div className="flex-1">
            <div className="font-medium text-neg">Apagar também as transações</div>
            {mode === 'delete' && (
              <div className="mt-2">
                <p className="mb-1.5 text-xs text-muted">
                  Isto apaga definitivamente {count} transaç{count === 1 ? 'ão' : 'ões'}. Para confirmar, escreva{' '}
                  <strong className="text-fg">{item.name}</strong>:
                </p>
                <input
                  className="input"
                  autoFocus
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={item.name}
                />
              </div>
            )}
          </div>
        </label>

        {error && <p className="text-xs text-neg">{error}</p>}
      </div>
    </Modal>
  )
}
