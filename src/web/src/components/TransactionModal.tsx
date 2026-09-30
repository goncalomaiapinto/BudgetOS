import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { accountMemory, defaultAccount, suggestAccount } from '../lib/accounts'
import { api, ApiError, type EntryType } from '../lib/api'
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
  // last transfer direction (e.g. Millennium → Revolut)
  transfer(): { from: number; to: number } | null {
    try {
      return JSON.parse(sessionStorage.getItem('tx.lastTransfer') ?? 'null')
    } catch {
      return null
    }
  },
  setTransfer(from: number, to: number) {
    sessionStorage.setItem('tx.lastTransfer', JSON.stringify({ from, to }))
  },
}

export function TransactionModal() {
  const { modal, closeTransaction, categories, accounts, refresh, toast } = useApp()
  const editing = modal.transaction
  const editingTransfer = modal.transfer
  const preset = modal.preset

  // "Transferência" tab: money moved between two accounts (not income nor expense).
  const activeAccounts = accounts.filter((a) => a.isActive)
  const lastTransfer = session.transfer()
  const [isTransfer, setIsTransfer] = useState(!!editingTransfer || !!preset?.transfer)
  const [fromId, setFromId] = useState<number | ''>(
    () => editingTransfer?.fromAccountId ?? lastTransfer?.from ?? defaultAccount(accounts)?.id ?? '',
  )
  const [toId, setToId] = useState<number | ''>(
    () =>
      editingTransfer?.toAccountId ??
      lastTransfer?.to ??
      activeAccounts.find((a) => a.id !== (lastTransfer?.from ?? defaultAccount(accounts)?.id))?.id ??
      '',
  )

  const [type, setType] = useState<EntryType>(editing?.type ?? preset?.type ?? 'Expense')
  const [date, setDate] = useState(editingTransfer?.date ?? editing?.date ?? preset?.date ?? session.date)
  const [categoryId, setCategoryId] = useState<number | ''>(
    () => editing?.categoryId ?? preset?.categoryId ?? defaultCategory(editing?.type ?? preset?.type ?? 'Expense'),
  )
  const [subCategoryId, setSubCategoryId] = useState<number | ''>(
    editing?.subCategoryId ?? preset?.subCategoryId ?? '',
  )
  // Once the account is chosen by hand (or comes fixed: editing, grid filtered by account), it sticks until the
  // modal closes: changing type/category/subcategory or "Guardar e adicionar outra" no longer resets it.
  const [accountPinned, setAccountPinned] = useState(!!editing || preset?.accountId != null)
  const [accountId, setAccountId] = useState<number | ''>(
    () =>
      editing?.accountId ??
      preset?.accountId ??
      suggestAccount(accounts, categories, editing?.type ?? preset?.type ?? 'Expense', preset?.subCategoryId ?? ''),
  )
  // If the modal opened before the accounts arrived (e.g. "N" right after start), fill in the suggestion when they do.
  useEffect(() => {
    if (accounts.length === 0) return
    if (accountId === '') setAccountId(suggestAccount(accounts, categories, type, subCategoryId))
    if (fromId === '') setFromId(defaultAccount(accounts)?.id ?? '')
    if (toId === '') setToId(accounts.find((a) => a.isActive && a.id !== (fromId || defaultAccount(accounts)?.id))?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  // Inactive accounts stay visible only when editing a transaction that already uses them.
  const accountOptions = accounts.filter((a) => a.isActive || a.id === editing?.accountId)
  const [amount, setAmount] = useState(
    editingTransfer ? amountToInput(editingTransfer.amount) : editing ? amountToInput(editing.amount) : '',
  )
  const [description, setDescription] = useState(editingTransfer?.description ?? editing?.description ?? '')
  const transferAccountOptions = accounts.filter(
    (a) => a.isActive || a.id === editingTransfer?.fromAccountId || a.id === editingTransfer?.toAccountId,
  )
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
    setIsTransfer(false)
    if (t === type) return
    setType(t)
    setCategoryId(defaultCategory(t))
    setSubCategoryId('')
    if (!accountPinned) setAccountId(defaultAccount(accounts)?.id ?? '')
  }

  const changeSubCategory = (id: number | '') => {
    setSubCategoryId(id)
    if (!accountPinned) setAccountId(suggestAccount(accounts, categories, type, id))
  }

  const saveTransfer = async (addAnother: boolean, dateValue: string) => {
    const value = evalAmount(amount)
    const errs: Record<string, string> = {}
    if (value === null || value <= 0) errs.amount = 'Indique um valor maior que zero (ex.: 12,50).'
    if (fromId === '') errs.fromAccountId = 'Escolha a conta de origem.'
    if (toId === '') errs.toAccountId = 'Escolha a conta de destino.'
    if (fromId !== '' && fromId === toId) errs.toAccountId = 'A conta de destino tem de ser diferente da de origem.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      amountRef.current?.focus()
      return
    }
    const input = {
      date: dateValue,
      fromAccountId: fromId as number,
      toAccountId: toId as number,
      amount: value!,
      description: description.trim() || null,
    }
    setBusy(true)
    try {
      if (editingTransfer) await api.transfers.update(editingTransfer.id, input)
      else await api.transfers.create(input)
      session.date = dateValue
      session.setTransfer(input.fromAccountId, input.toAccountId)
      refresh()
      const name = (id: number) => accounts.find((a) => a.id === id)?.name ?? 'conta'
      toast(
        editingTransfer
          ? 'Transferência atualizada.'
          : `Transferência de ${formatMoney(input.amount)} (${name(input.fromAccountId)} → ${name(input.toAccountId)}) guardada.`,
      )
      if (addAnother && !editingTransfer) {
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

  const save = async (addAnother: boolean, dateValue = date) => {
    if (isTransfer) return saveTransfer(addAnother, dateValue)
    const value = evalAmount(amount) // accepts "12,40+3,10"
    const errs: Record<string, string> = {}
    if (value === null || value <= 0) errs.amount = 'Indique um valor maior que zero (ex.: 12,50).'
    if (categoryId === '') errs.categoryId = 'Escolha uma categoria.'
    if (accountId === '') errs.accountId = 'Escolha a conta.'
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
      accountId: accountId as number,
      amount: value!,
      description: description.trim() || null,
    }

    setBusy(true)
    try {
      if (editing) await api.transactions.update(editing.id, input)
      else await api.transactions.create(input)
      session.date = dateValue
      session.setCategory(type, input.categoryId)
      if (input.subCategoryId !== null) accountMemory.set(input.subCategoryId, input.accountId)
      refresh()
      toast(
        editing
          ? 'Transação atualizada.'
          : `${type === 'Income' ? 'Receita' : 'Despesa'} de ${formatMoney(input.amount)} guardada` +
              ` (${accounts.find((a) => a.id === input.accountId)?.name ?? 'conta'}).`,
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
      title={editingTransfer ? 'Editar transferência' : editing ? 'Editar transação' : 'Nova transação'}
      onClose={closeTransaction}
      footer={
        <>
          {!editing && !editingTransfer && (
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
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Tipo">
          {(['Income', 'Expense', 'Transfer'] as const).map((t) => {
            const active = t === 'Transfer' ? isTransfer : !isTransfer && type === t
            // An existing transaction can't become a transfer (and vice versa): they live in different places.
            const locked = t === 'Transfer' ? !!editing : !!editingTransfer
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={-1}
                disabled={locked}
                onClick={() => (t === 'Transfer' ? setIsTransfer(true) : switchType(t))}
                className={cx(
                  'inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  active
                    ? t === 'Income'
                      ? 'bg-[#4e7d25] text-white shadow'
                      : t === 'Expense'
                        ? 'bg-exp text-white shadow'
                        : 'bg-inc text-white shadow'
                    : 'text-muted hover:text-fg',
                )}
              >
                {t === 'Transfer' && <Icon name="swap" size={15} />}
                {t === 'Income' ? 'Receita' : t === 'Expense' ? 'Despesa' : 'Transferência'}
              </button>
            )
          })}
        </div>

        {isTransfer && (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label className="label" htmlFor="tr-from">
                  De
                </label>
                <select
                  id="tr-from"
                  className={cx('input', errors.fromAccountId && 'border-exp')}
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : '')}
                >
                  {transferAccountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="icon-btn mb-1 size-8"
                title="Trocar origem e destino"
                aria-label="Trocar origem e destino"
                onClick={() => {
                  setFromId(toId)
                  setToId(fromId)
                }}
              >
                <Icon name="swap" />
              </button>
              <div>
                <label className="label" htmlFor="tr-to">
                  Para
                </label>
                <select
                  id="tr-to"
                  className={cx('input', errors.toAccountId && 'border-exp')}
                  value={toId}
                  onChange={(e) => setToId(e.target.value ? Number(e.target.value) : '')}
                >
                  {transferAccountOptions.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.id === fromId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(errors.fromAccountId || errors.toAccountId) && (
              <p className="-mt-2 text-xs text-neg">{errors.fromAccountId ?? errors.toAccountId}</p>
            )}
            <p className="-mt-2 text-xs text-muted">
              Só muda o saldo das duas contas: não conta como receita nem como despesa.
            </p>
          </>
        )}

        {!isTransfer && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Conta">
          <span className="label mb-0">{isIncome ? 'Entra em' : 'Sai de'}</span>
          {accountOptions.map((a) => {
            const active = accountId === a.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setAccountId(a.id)
                  setAccountPinned(true)
                }}
                className={cx(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  active ? 'border-transparent text-white' : 'border-line text-muted hover:text-fg',
                )}
                style={active ? { background: a.color ?? 'var(--inc)' } : undefined}
              >
                {a.kind === 'MealCard' ? (
                  <Icon name="card" size={13} />
                ) : (
                  !active && <span className="size-2 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                )}
                {a.name}
              </button>
            )
          })}
        </div>
        )}
        {!isTransfer && errors.accountId && <p className="-mt-2 text-xs text-neg">{errors.accountId}</p>}

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
                isTransfer ? 'text-fg' : isIncome ? 'text-pos' : 'text-neg',
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

        {!isTransfer && (
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
        )}
        {!isTransfer && (errors.categoryId || errors.subCategoryId) && (
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
