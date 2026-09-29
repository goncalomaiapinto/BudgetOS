import { useApp } from '../lib/app-context'
import { cx } from '../lib/format'
import { Icon } from './Icon'

export function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'flex max-w-sm items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm text-white shadow-lg',
            t.kind === 'success' ? 'bg-[#3f6d1a]' : 'bg-exp',
          )}
        >
          <Icon name={t.kind === 'success' ? 'check' : 'alert'} />
          {t.message}
        </div>
      ))}
    </div>
  )
}
