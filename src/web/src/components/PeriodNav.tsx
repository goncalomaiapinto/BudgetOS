import { MONTHS } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday?: () => void
}

/** "‹ Setembro 2026 ›" style navigator. */
export function PeriodNav({ label, onPrev, onNext, onToday }: Props) {
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" className="icon-btn size-8" onClick={onPrev} aria-label="Anterior">
        <Icon name="left" />
      </button>
      <span className="min-w-36 text-center text-base font-semibold capitalize tabular">{label}</span>
      <button type="button" className="icon-btn size-8" onClick={onNext} aria-label="Seguinte">
        <Icon name="right" />
      </button>
      {onToday && (
        <button type="button" className="btn-ghost ml-1 h-8 px-2 text-xs" onClick={onToday}>
          Hoje
        </button>
      )}
    </div>
  )
}

export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`
