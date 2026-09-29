import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Account, type Category, type EntryType, type Transaction, type Transfer } from './api'

export interface TransactionPreset {
  type?: EntryType
  categoryId?: number
  subCategoryId?: number | null
  date?: string
  accountId?: number
  /** Open the modal on the "Transferência" tab. */
  transfer?: boolean
}

interface Toast {
  id: number
  message: string
  kind: 'success' | 'error'
}

interface AppState {
  /** Bumped after any write so pages know to refetch. */
  version: number
  refresh: () => void
  categories: Category[]
  /** All accounts (active and inactive), in display order. */
  accounts: Account[]
  categoriesError: string | null
  toasts: Toast[]
  toast: (message: string, kind?: Toast['kind']) => void
  modal: { open: boolean; transaction?: Transaction; transfer?: Transfer; preset?: TransactionPreset }
  openTransaction: (transaction?: Transaction, preset?: TransactionPreset) => void
  openTransfer: (transfer: Transfer) => void
  closeTransaction: () => void
}

const AppContext = createContext<AppState | null>(null)

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<AppState['modal']>({ open: false })

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    Promise.all([api.categories.list(), api.accounts.list()])
      .then(([c, a]) => {
        setCategories(c)
        setAccounts(a)
        setCategoriesError(null)
      })
      .catch((e: Error) => setCategoriesError(e.message))
  }, [version])

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++toastId
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500)
  }, [])

  const openTransaction = useCallback(
    (transaction?: Transaction, preset?: TransactionPreset) => setModal({ open: true, transaction, preset }),
    [],
  )
  const openTransfer = useCallback((transfer: Transfer) => setModal({ open: true, transfer }), [])
  const closeTransaction = useCallback(() => setModal({ open: false }), [])

  const value = useMemo(
    () => ({
      version, refresh, categories, accounts, categoriesError, toasts, toast, modal, openTransaction, openTransfer, closeTransaction,
    }),
    [version, refresh, categories, accounts, categoriesError, toasts, toast, modal, openTransaction, openTransfer, closeTransaction],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
