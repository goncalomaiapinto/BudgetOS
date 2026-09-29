import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Icon } from './components/Icon'
import { Toasts } from './components/Toasts'
import { TransactionModal } from './components/TransactionModal'
import { useApp } from './lib/app-context'
import { cx } from './lib/format'
import BudgetPage from './pages/BudgetPage'
import CategoriesPage from './pages/CategoriesPage'
import DashboardPage from './pages/DashboardPage'
import InvestmentsPage from './pages/InvestmentsPage'
import PlanPage from './pages/PlanPage'
import SettingsPage from './pages/SettingsPage'
import TransactionsPage from './pages/TransactionsPage'

const nav = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/orcamento', label: 'Orçamento', icon: 'grid' },
  { to: '/previsao', label: 'Previsão', icon: 'target' },
  { to: '/investimentos', label: 'Investimentos', icon: 'trend' },
  { to: '/transacoes', label: 'Transações', icon: 'list' },
  { to: '/categorias', label: 'Categorias', icon: 'tag' },
  { to: '/definicoes', label: 'Definições', icon: 'settings' },
]

export default function App() {
  const { modal, openTransaction, categoriesError } = useApp()

  // Global shortcut: N opens "Nova transação" (unless typing somewhere or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      openTransaction()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openTransaction])

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Orçamento</div>
            <div className="text-xs text-muted">Pessoal</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-inc text-white' : 'text-muted hover:bg-fg/5 hover:text-fg',
                )
              }
            >
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-4 py-4 text-xs text-muted">
          Atalho: <kbd className="rounded border border-line px-1 font-sans">N</kbd> nova transação
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur md:px-6">
          {/* Compact tabs for narrow windows */}
          <nav className="flex gap-1 overflow-x-auto md:hidden">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                title={n.label}
                className={({ isActive }) =>
                  cx('icon-btn size-9', isActive && 'bg-inc text-white hover:bg-inc hover:text-white')
                }
              >
                <Icon name={n.icon} />
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto" />
          <button type="button" className="btn-primary h-9 px-4" onClick={() => openTransaction()} title="Atalho: N">
            <Icon name="plus" />
            Nova transação
          </button>
        </header>

        {categoriesError && (
          <div className="mx-4 mt-4 rounded-lg border border-exp/40 bg-exp-row px-4 py-3 text-sm md:mx-6">
            <strong>Sem ligação à API.</strong> {categoriesError}
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/orcamento" element={<BudgetPage />} />
            <Route path="/previsao" element={<PlanPage />} />
            <Route path="/investimentos" element={<InvestmentsPage />} />
            <Route path="/transacoes" element={<TransactionsPage />} />
            <Route path="/categorias" element={<CategoriesPage />} />
            <Route path="/definicoes" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {modal.open && <TransactionModal key={modal.transaction?.id ?? 'new'} />}
      <Toasts />
    </div>
  )
}
