import { useEffect, useState } from 'react'
import { DateInput } from '../components/DateInput'
import { api } from '../lib/api'
import { useApp } from '../lib/app-context'
import { amountToInput, formatDate, formatMoney, parseAmount } from '../lib/format'

export default function SettingsPage() {
  const { refresh, toast } = useApp()
  const [balance, setBalance] = useState('')
  const [mealCardBalance, setMealCardBalance] = useState('')
  const [startDate, setStartDate] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        setBalance(amountToInput(s.openingBalance))
        setMealCardBalance(amountToInput(s.mealCardOpeningBalance))
        setStartDate(s.startDate)
        setLoaded(true)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const value = parseAmount(balance)
  const mealCardValue = parseAmount(mealCardBalance)

  const save = async () => {
    if (value === null || mealCardValue === null) {
      setError('Indique valores válidos (ex.: 500,05 ou -120,00).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const s = await api.settings.save({ openingBalance: value, mealCardOpeningBalance: mealCardValue, startDate })
      setBalance(amountToInput(s.openingBalance))
      setMealCardBalance(amountToInput(s.mealCardOpeningBalance))
      toast('Definições guardadas.')
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const [y, m] = startDate.split('-')

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-xl font-semibold">Definições</h1>

      <form
        className="card space-y-5 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div>
          <label className="label" htmlFor="opening">
            Saldo inicial da conta à ordem (€)
          </label>
          <input
            id="opening"
            className="input max-w-48 text-right tabular"
            inputMode="decimal"
            value={balance}
            disabled={!loaded}
            onChange={(e) => setBalance(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">O dinheiro que tinha no início do período (pode ser negativo).</p>
        </div>

        <div>
          <label className="label" htmlFor="opening-card">
            Saldo inicial do cartão refeição (€)
          </label>
          <input
            id="opening-card"
            className="input max-w-48 text-right tabular"
            inputMode="decimal"
            value={mealCardBalance}
            disabled={!loaded}
            onChange={(e) => setMealCardBalance(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">O que estava no cartão na data de início.</p>
        </div>

        <div>
          <label className="label" htmlFor="start">
            A contar a partir de
          </label>
          <DateInput id="start" value={startDate} onChange={setStartDate} className="max-w-48" />
          <p className="mt-1 text-xs text-muted">
            O saldo inicial é o “Saldo Anterior” do mês desta data; as transações contam a partir do dia 1 desse mês.
          </p>
        </div>

        {loaded && value !== null && mealCardValue !== null && startDate && (
          <div className="rounded-md bg-inc-row px-3 py-2 text-sm">
            Saldo Anterior de {m}/{y}: <strong className="tabular">{formatMoney(value + mealCardValue)}</strong> (conta{' '}
            {formatMoney(value)} + cartão {formatMoney(mealCardValue)}). Cada mês seguinte começa com o saldo acumulado do
            mês anterior (a partir de {formatDate(`${y}-${m}-01`)}).
          </div>
        )}

        {error && <p className="text-sm text-neg">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy || !loaded}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}
