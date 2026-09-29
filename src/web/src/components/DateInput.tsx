import { useEffect, useRef, useState } from 'react'
import { addDays, cx, formatDate, isValidIso, parseDate } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  value: string // ISO yyyy-MM-dd
  onChange: (iso: string) => void
  id?: string
  className?: string
}

/**
 * Text date field that always shows dd/MM/yyyy (the native date input follows the browser's locale).
 * Accepts "5", "5/9", "05/09/26"; ↑/↓ move one day; the calendar button opens the native picker.
 */
export function DateInput({ value, onChange, id, className }: Props) {
  const [text, setText] = useState(isValidIso(value) ? formatDate(value) : '')
  const [invalid, setInvalid] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(isValidIso(value) ? formatDate(value) : '')
    setInvalid(false)
  }, [value])

  const commit = () => {
    const iso = parseDate(text)
    if (iso) {
      setInvalid(false)
      if (iso !== value) onChange(iso)
      else setText(formatDate(iso))
    } else {
      setInvalid(true)
    }
  }

  return (
    <div className={cx('relative', className)}>
      <input
        id={id}
        className={cx('input pr-9 tabular', invalid && 'border-exp focus:border-exp')}
        value={text}
        placeholder="dd/mm/aaaa"
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isValidIso(value)) {
            e.preventDefault()
            onChange(addDays(value, e.key === 'ArrowUp' ? 1 : -1))
          } else if (e.key === 'Enter') {
            // Make sure the typed value is applied before the form submits.
            const iso = parseDate(text)
            if (iso && iso !== value) onChange(iso)
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        className="icon-btn absolute top-1 right-1"
        aria-label="Abrir calendário"
        onClick={() => picker.current?.showPicker?.()}
      >
        <Icon name="calendar" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 opacity-0"
        value={isValidIso(value) ? value : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </div>
  )
}
