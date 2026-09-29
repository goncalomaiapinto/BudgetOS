import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ACCOUNT_LABELS, api, ApiError, type Category, type EntryType, type PaymentAccount } from '../lib/api'
import { useApp } from '../lib/app-context'
import { amountToInput, cx, evalAmount, formatMoney, isExpression, parseDate, todayIso } from '../lib/format'
import { DateInput } from './DateInput'
import { Icon } from './Icon'
import { Modal } from './Modal'

// Remembered for the browser session: last date used and last category per type.
const session = {
  get date() {
    return sessionStorage.getItem('tx.lastDate') ?? todayIso()
  },
  set date(v: string) {
    sessionStorage.setItem('tx.lastDate', v)
  },
  category(type: EntryType): number | null {
    const v = sessionStorage.getItem(`tx.lastCategory.${type}`)
    return v ? Number(v) : null
  },
  setCategory(type: EntryType, id: number) {
    sessionStorage.setItem(`tx.lastCategory.${type}`, String(id))
  },
}

// Remembered across sessions: the account last used for each subcategory (e.g. Restaurante → Cartão Refeição).
const accountMemory = {
  get(subCategoryId: number): PaymentAccount | null {
    try {
      const v = localStorage.getItem(`tx.account.sub.${subCategoryId}`)
      return v === 'Main' || v === 'MealCard' ? v : null
    } catch {
      return null
    }
  },
  set(subCategoryId: number, account: PaymentAccount) {
    try {
      localStorage.setItem(`tx.account.sub.${subCategoryId}`, account)
    } catch {
      // storage unavailable: the default account is used next time
    }
  },
}

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Account suggested for a subcategory: what was used last time, else the meal card for "Renda / Cartão Refeição". */
function suggestedAccount(categories: Category[], type: EntryType, subCategoryId: number | ''): PaymentAccount {
  if (subCategoryId === '') return 'Main'
  const remembered = accountMemory.get(subCategoryId)
  if (remembered) return remembered
  const sub = categories.flatMap((c) => c.subCategories).find((s) => s.id === subCategoryId)
  return type === 'Income' && sub && normalize(sub.name).includes('cartao refeicao') ? 'MealCard' : 'Main'
}

export function TransactionModal() {
  const { modal, closeTransaction, categories, refresh, toast } = useApp()
  const editing = modal.transaction
  const preset = modal.preset

  const [type, setType] = useState<EntryType>(editing?.type ?? preset?.type ?? 'Expense')
  const [date, setDate] = useState(editing?.date ?? preset?.date ?? session.date)
  const [categoryId, setCategoryId] = useState<number | ''>(
    () => editing?.categoryId ?? preset?.categoryId ?? defaultCategory(editing?.type ?? preset?.type ?? 'Expense'),
  )
  const [subCategoryId, setSubCategoryId] = useState<number | ''>(
    editing?.subCategoryId ?? preset?.subCategoryId ?? '',
  )
  const [account, setAccount] = useState<PaymentAccount>(
    () =>
      editing?.account ??
      preset?.account ??
      suggestedAccount(categories, editing?.type ?? preset?.type ?? 'Expense', preset?.subCategoryId ?? ''),
  )
  const [amount, setAmount] = useState(editing ? amountToInput(editing.amount) : '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  function defaultCategory(t: EntryType): number | '' {
    const list = categories.filter((c) => c.type === t && c.isActive)
    const last = session.category(t)
    return list.find((c) => c.id === last)?.id ?? list[0]?.id ?? ''
  }

  // Inactive items stay visible only when editing a transaction that already uses them.
  const categoryOptions = useMemo(
    () => categories.filter((c) => c.type === type && (c.isActive || c.id === editing?.categoryId)),
    [categories, type, editing],
  )
  const subOptions = useMemo(
    () =>
      categories
        .find((c) => c.id === categoryId)
        ?.subCategories.filter((s) => s.isActive || s.id === editing?.subCategoryId) ?? [],
    [categories, categoryId, editing],
  )

  const switchType = (t: EntryType) => {
    if (t === type) return
    setType(t)
    setCategoryId(defaultCategory(t))
    setSubCategoryId('')
    setAccount('Main')
  }

  const changeSubCategory = (id: number | '') => {
    setSubCategoryId(id)
    setAccount(suggestedAccount(categories, type, id))
  }

  const save = async (addAnother: boolean, dateValue = date) => {
    const value = evalAmount(amount) // accepts "12,40+3,10"
    const errs: Record<string, string> = {}
    if (value === null || value <= 0) errs.amount = 'Indique um valor maior que zero (ex.: 12,50).'
    if (categoryId === '') errs.categoryId = 'Escolha uma categoria.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      amountRef.current?.focus()
      return
    }

    const input = {
      date: dateValue,
      type,
      categoryId: categoryId as number,
      subCategoryId: subCategoryId === '' ? null : subCategoryId,
      account,
      amount: value!,
      description: description.trim() || null,
    }

    setBusy(true)
    try {
      if (editing) await api.transactions.update(editing.id, input)
      else await api.transactions.create(input)
      session.date = dateValue
      session.setCategory(type, input.categoryId)
      if (input.subCategoryId !== null) accountMemory.set(input.subCategoryId, account)
      refresh()
      toast(
        editing
          ? 'Transação atualizada.'
          : `${type === 'Income' ? 'Renda' : 'Despesa'} de ${formatMoney(input.amount)} guardada` +
              (account === 'MealCard' ? ' (cartão refeição).' : '.'),
      )
      if (addAnother && !editing) {
        setAmount('')
        setDescription('')
        amountRef.current?.focus()
      } else {
        closeTransaction()
      }
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) {
        const apiErrors = e.problem.errors as Record<string, string[]>
        setErrors(Object.fromEntries(Object.entries(apiErrors).map(([k, v]) => [k, v.join(' ')])))
      } else {
        toast((e as Error).message, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void save(false)
  }

  const isIncome = type === 'Income'

  return (
    <Modal
      title={editing ? 'Editar transação' : 'Nova transação'}
      onClose={closeTransaction}
      footer={
        <>
          {!editing && (
            <button type="button" className="btn" disabled={busy} onClick={() => save(true)} title="Shift+Enter">
              Guardar e adicionar outra
            </button>
          )}
          <button type="submit" form="tx-form" className="btn-primary" disabled={busy} title="Enter">
            Guardar
          </button>
        </>
      }
    >
      <form
        id="tx-form"
        onSubmit={onSubmit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return
          e.preventDefault()
          // The date field may still hold typed text that hasn't been committed to state yet.
          const target = e.target as HTMLInputElement
          const typedDate = target.id === 'tx-date' ? parseDate(target.value) : null
          void save(e.shiftKey || e.ctrlKey, typedDate ?? date)
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Tipo">
          {(['Income', 'Expense'] as const).map((t) => {
            const active = type === t
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={-1}
                onClick={() => switchType(t)}
                className={cx(
                  'h-11 cursor-pointer rounded-md text-base font-semibold transition-colors',
                  active
                    ? t === 'Income'
                      ? 'bg-[#4e7d25] text-white shadow'
                      : 'bg-exp text-white shadow'
                    : 'text-muted hover:text-fg',
                )}
              >
                {t === 'Income' ? 'Renda' : 'Despesa'}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2" role="radiogroup" aria-label="Conta">
          <span className="label mb-0">{isIncome ? 'Entra em' : 'Pago com'}</span>
          {(['Main', 'MealCard'] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={account === a}
              onClick={() => setAccount(a)}
              className={cx(
                'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                account === a
                  ? a === 'MealCard'
                    ? 'border-transparent bg-[#b8a444] text-white'
                    : 'border-transparent bg-inc text-white'
                  : 'border-line text-muted hover:text-fg',
              )}
            >
              {a === 'MealCard' && <Icon name="card" size={13} />}
              {ACCOUNT_LABELS[a]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_1.2fr] gap-3">
          <div>
            <label className="label" htmlFor="tx-amount">
              Valor (€)
            </label>
            <input
              id="tx-amount"
              ref={amountRef}
              autoFocus
              className={cx(
                'input h-11 text-right text-lg font-semibold tabular',
                isIncome ? 'text-pos' : 'text-neg',
                errors.amount && 'border-exp',
              )}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={amount}
              title="Pode escrever contas, ex.: 12,40+3,10"
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => isExpression(amount) && setAmount(amountToInput(evalAmount(amount)!))}
            />
          </div>
          <div>
            <label className="label" htmlFor="tx-date">
              Data
            </label>
            <DateInput id="tx-date" value={date} onChange={setDate} className="[&_.input]:h-11" />
          </div>
        </div>
        {(errors.amount || errors.date) && <p className="-mt-2 text-xs text-neg">{errors.amount ?? errors.date}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="tx-category">
              Categoria
            </label>
            <select
              id="tx-category"
              className={cx('input', errors.categoryId && 'border-exp')}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value ? Number(e.target.value) : '')
                changeSubCategory('')
              }}
            >
              {categoryOptions.length === 0 && <option value="">—</option>}
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.isActive ? ' (inativa)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-sub">
              Subcategoria
            </label>
            <select
              id="tx-sub"
              className={cx('input', errors.subCategoryId && 'border-exp')}
              value={subCategoryId}
              onChange={(e) => changeSubCategory(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">(nenhuma)</option>
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.isActive ? ' (inativa)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(errors.categoryId || errors.subCategoryId) && (
          <p className="-mt-2 text-xs text-neg">{errors.categoryId ?? errors.subCategoryId}</p>
        )}

        <div>
          <label className="label" htmlFor="tx-desc">
            Descrição <span className="normal-case">(opcional)</span>
          </label>
          <input
            id="tx-desc"
            className="input"
            maxLength={500}
            autoComplete="off"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {errors.description && <p className="mt-1 text-xs text-neg">{errors.description}</p>}
        </div>

        <p className="text-xs text-muted">
          <kbd className="font-sans">Enter</kbd> guarda
          {!editing && (
            <>
              {' · '}
              <kbd className="font-sans">Shift+Enter</kbd> guarda e adiciona outra
            </>
          )}
          {' · '}
          <kbd className="font-sans">Esc</kbd> fecha · <kbd className="font-sans">↑/↓</kbd> na data muda o dia
        </p>
      </form>
    </Modal>
  )
}
