import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Category, type EntryType, type PaymentAccount, type Transaction } from './api'

export interface TransactionPreset {
  type?: EntryType
  categoryId?: number
  subCategoryId?: number | null
  date?: string
  account?: PaymentAccount
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
  categoriesError: string | null
  toasts: Toast[]
  toast: (message: string, kind?: Toast['kind']) => void
  modal: { open: boolean; transaction?: Transaction; preset?: TransactionPreset }
  openTransaction: (transaction?: Transaction, preset?: TransactionPreset) => void
  closeTransaction: () => void
}

const AppContext = createContext<AppState | null>(null)

let toastId = 0

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<AppState['modal']>({ open: false })

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    api.categories
      .list()
      .then((c) => {
        setCategories(c)
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
  const closeTransaction = useCallback(() => setModal({ open: false }), [])

  const value = useMemo(
    () => ({ version, refresh, categories, categoriesError, toasts, toast, modal, openTransaction, closeTransaction }),
    [version, refresh, categories, categoriesError, toasts, toast, modal, openTransaction, closeTransaction],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
