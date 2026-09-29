import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateInput } from '../components/DateInput'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { api, type Account, type AccountKind } from '../lib/api'
import { useApp } from '../lib/app-context'
import { amountToInput, cx, evalAmount, formatDate, formatMoney, isExpression } from '../lib/format'

const SWATCHES = ['#1F497D', '#C2185B', '#0A6CD6', '#1E8C6E', '#7A4FB5', '#D2711C', '#B8A444', '#8A94A3']

export default function SettingsPage() {
  const { refresh, toast, accounts } = useApp()
  const [startDate, setStartDate] = useState('')
  const [savedStart, setSavedStart] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Account | null>(null)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        setStartDate(s.startDate)
        setSavedStart(s.startDate)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const saveStart = async () => {
    try {
      const s = await api.settings.save({ startDate })
      setSavedStart(s.startDate)
      toast('Data de início guardada.')
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      toast(success)
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const move = (index: number, delta: number) => {
    const ids = accounts.map((a) => a.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    void run(() => api.accounts.reorder(ids), 'Ordem atualizada.')
  }

  const totalOpening = accounts.reduce((sum, a) => sum + a.openingBalance, 0)
  const [y, m] = savedStart.split('-')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">Definições</h1>
      {error && <p className="text-sm text-neg">{error}</p>}

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Data de início</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="start">
              A contar a partir de
            </label>
            <DateInput id="start" value={startDate} onChange={setStartDate} className="w-48" />
          </div>
          <button type="button" className="btn-primary" disabled={!startDate || startDate === savedStart} onClick={saveStart}>
            Guardar
          </button>
        </div>
        <p className="text-xs text-muted">
          Os saldos iniciais das contas são os valores nesta data. O Saldo Anterior de {m && `${m}/${y}`} é a soma deles
          ({formatMoney(totalOpening)}); cada mês seguinte começa com o saldo acumulado do anterior
          {savedStart && ` (a partir de ${formatDate(`${y}-${m}-01`)})`}.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="font-semibold">Contas</h2>
            <p className="text-xs text-muted">De onde sai e para onde entra o dinheiro de cada transação.</p>
          </div>
          <button type="button" className="btn h-8" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Nova conta
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-3 py-2 text-right font-medium">Saldo inicial</th>
              <th className="px-3 py-2 text-right font-medium">Saldo atual</th>
              <th className="px-3 py-2 text-right font-medium">Transações</th>
              <th className="w-44" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={a.id} className={cx('group border-t border-line', !a.isActive && 'opacity-60')}>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    {a.kind === 'MealCard' ? (
                      <Icon name="card" size={14} className="text-[#b8a444]" />
                    ) : (
                      <span className="size-2.5 rounded-full" style={{ background: a.color ?? 'var(--muted)' }} />
                    )}
                    <span className="font-medium">{a.name}</span>
                    {a.isDefault && <Badge>principal</Badge>}
                    {a.kind === 'MealCard' && <Badge>cartão refeição</Badge>}
                    {!a.isActive && <Badge>inativa</Badge>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(a.openingBalance)}</td>
                <td className={cx('px-3 py-2 text-right font-medium tabular', a.balance < 0 && 'text-neg')}>
                  {formatMoney(a.balance)}
                </td>
                <td className="px-3 py-2 text-right text-muted tabular" title={`${a.transferCount} transferência(s)`}>
                  {a.transactionCount}
                  {a.transferCount > 0 && <span className="text-xs"> + {a.transferCount} ⇄</span>}
                </td>
                <td className="px-2 py-1 text-right whitespace-nowrap">
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir" title="Subir">
                    <Icon name="up" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === accounts.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Descer"
                    title="Descer"
                  >
                    <Icon name="down" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setEditing(a)} aria-label="Editar" title="Editar">
                    <Icon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn hover:text-neg"
                    disabled={a.isDefault}
                    onClick={() => setDeleting(a)}
                    aria-label="Apagar"
                    title={a.isDefault ? 'A conta principal não pode ser apagada' : 'Apagar'}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
          A conta <strong>principal</strong> é a sugerida por omissão nas novas transações. Uma conta do tipo cartão refeição
          é escolhida automaticamente nos carregamentos (Receitas › Cartão Refeição).
        </p>
      </section>

      {editing && (
        <AccountDialog
          account={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null)
            toast(editing === 'new' ? `Conta “${name}” criada.` : 'Conta atualizada.')
            refresh()
          }}
        />
      )}
      {deleting && (
        <DeleteAccountDialog
          account={deleting}
          accounts={accounts}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null)
            toast('Conta apagada.')
            refresh()
          }}
        />
      )}
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[11px] font-medium text-muted">{children}</span>
}

function AccountDialog({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'Bank')
  const [color, setColor] = useState(account?.color ?? SWATCHES[2])
  const [opening, setOpening] = useState(account ? amountToInput(account.openingBalance) : '0,00')
  const [isDefault, setIsDefault] = useState(account?.isDefault ?? false)
  const [isActive, setIsActive] = useState(account?.isActive ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const value = opening.trim() === '' ? 0 : evalAmount(opening)
    if (value === null) {
      setError('Saldo inicial inválido (ex.: 1 250,00 ou -30).')
      return
    }
    if (!name.trim()) return
    setBusy(true)
    try {
      const body = { name: name.trim(), kind, color, openingBalance: value, isDefault, isActive: isDefault || isActive }
      if (account) await api.accounts.update(account.id, body)
      else await api.accounts.create(body)
      onSaved(name.trim())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={account ? 'Editar conta' : 'Nova conta'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="account-form" className="btn-primary" disabled={busy || !name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id="account-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid grid-cols-[1.4fr_1fr] gap-3">
          <div>
            <label className="label" htmlFor="acc-name">
              Nome
            </label>
            <input
              id="acc-name"
              className="input"
              autoFocus
              maxLength={100}
              placeholder="ex.: Millennium"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="acc-opening">
              Saldo inicial (€)
            </label>
            <input
              id="acc-opening"
              className="input text-right tabular"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              onBlur={() => isExpression(opening) && setOpening(amountToInput(evalAmount(opening)!))}
            />
          </div>
        </div>
        <div>
          <label className="label">Tipo</label>
          <div className="flex gap-2">
            {(
              [
                ['Bank', 'Conta bancária'],
                ['MealCard', 'Cartão refeição'],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className={cx(
                  'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
                  kind === k ? 'border-inc bg-inc-row' : 'border-line',
                )}
              >
                <input type="radio" name="acc-kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
                {k === 'MealCard' && <Icon name="card" size={14} />}
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Cor</label>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className={cx('inline-flex items-center gap-2', account?.isDefault ? 'text-muted' : 'cursor-pointer')}>
            <input
              type="checkbox"
              checked={isDefault}
              disabled={account?.isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Conta principal
          </label>
          <label className={cx('inline-flex items-center gap-2', isDefault ? 'text-muted' : 'cursor-pointer')}>
            <input type="checkbox" checked={isDefault || isActive} disabled={isDefault} onChange={(e) => setIsActive(e.target.checked)} />
            Ativa
          </label>
        </div>
        {account?.isDefault && (
          <p className="text-xs text-muted">Para deixar de ser a principal, marque outra conta como principal.</p>
        )}
        {error && <p className="text-sm text-neg">{error}</p>}
      </form>
    </Modal>
  )
}

function DeleteAccountDialog({
  account,
  accounts,
  onClose,
  onDone,
}: {
  account: Account
  accounts: Account[]
  onClose: () => void
  onDone: () => void
}) {
  const targets = accounts.filter((a) => a.id !== account.id)
  const [target, setTarget] = useState(targets.find((a) => a.isDefault)?.id ?? targets[0]?.id)
  const [error, setError] = useState<string | null>(null)

  const moves = account.transactionCount + account.transferCount
  if (moves === 0) {
    return (
      <ConfirmDialog
        title="Apagar conta"
        confirmLabel="Apagar"
        message={
          <>
            Apagar a conta <strong>{account.name}</strong>? Não tem transações nem transferências. Previsões que a usem
            passam para a conta principal.
          </>
        }
        onClose={onClose}
        onConfirm={async () => {
          try {
            await api.accounts.remove(account.id)
            onDone()
          } catch (e) {
            setError((e as Error).message)
          }
        }}
      />
    )
  }

  return (
    <Modal
      title={`Apagar conta “${account.name}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!target}
            onClick={async () => {
              try {
                await api.accounts.remove(account.id, target)
                onDone()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Mover e apagar
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          A conta tem <strong>{account.transactionCount} transações</strong>
          {account.transferCount > 0 && (
            <>
              {' '}e <strong>{account.transferCount} transferências</strong>
            </>
          )}
          . Para a apagar, escolha para que conta passam (ou, em vez de apagar, desative-a para manter o histórico).
          {account.transferCount > 0 && ' Transferências entre esta conta e a de destino são removidas.'}
        </p>
        <select className="input" value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Conta de destino">
          {targets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-neg">{error}</p>}
      </div>
    </Modal>
  )
}
