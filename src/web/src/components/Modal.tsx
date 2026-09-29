import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}

/** Minimal accessible modal: Esc closes, focus stays inside, click on the backdrop closes. */
export function Modal({ title, onClose, children, footer, width = 'max-w-md' }: Props) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // Focus the first field unless a child already grabbed focus (autoFocus).
    if (!panel.current?.contains(document.activeElement)) {
      panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus()
    }
    return () => previous?.focus?.()
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh] backdrop-blur-[1px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={cx('card w-full shadow-2xl', width)}
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || !panel.current) return
          const items = panel.current.querySelectorAll<HTMLElement>(
            'input:not([type=hidden]):not([tabindex="-1"]), select, textarea, button:not(:disabled)',
          )
          const first = items[0]
          const last = items[items.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" data-close className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
