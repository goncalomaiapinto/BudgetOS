// pt-PT formatting helpers. Dates travel as ISO strings (yyyy-MM-dd) and are shown as dd/MM/yyyy.

const money = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  // pt-PT only groups from 5 digits by default; we want "1 234,56 €".
  useGrouping: 'always',
})

const number = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
})

const percent = new Intl.NumberFormat('pt-PT', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const formatMoney = (v: number) => money.format(v)
export const formatNumber = (v: number) => number.format(v)
export const formatPercent = (v: number) => percent.format(v)

/** Value to put back into an amount input (no grouping, comma decimal). */
export const amountToInput = (v: number) => v.toFixed(2).replace('.', ',')

/**
 * Parses "1 234,56", "1.234,56", "1234.56" or "12,5". Returns null if invalid.
 * With a comma present, dots are thousands separators; otherwise a dot is the decimal separator.
 */
export function parseAmount(text: string): number | null {
  let s = text.replace(/[\s  €]/g, '')
  if (s === '') return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  return Number(s)
}

/**
 * Like parseAmount, but also accepts simple sums typed in the field: "10+20", "3*12,5", "(40+35)/2", "-5+7".
 * Returns the result rounded to cents, or null when the text isn't a valid number/expression.
 */
export function evalAmount(text: string): number | null {
  const direct = parseAmount(text)
  if (direct !== null) return direct

  const src = text.replace(/[\s\u00a0\u202f€]/g, '')
  if (src === '' || !/^[\d.,+\-*/x×()]+$/i.test(src)) return null
  let pos = 0

  // Tiny recursive-descent parser: expr = term (± term)*, term = factor (×/÷ factor)*, factor = ±factor | (expr) | number
  const number = (): number | null => {
    const m = /^[\d.,]+/.exec(src.slice(pos))
    if (!m) return null
    pos += m[0].length
    return parseAmount(m[0])
  }
  const factor = (): number | null => {
    const c = src[pos]
    if (c === '-' || c === '+') {
      pos++
      const f = factor()
      return f === null ? null : c === '-' ? -f : f
    }
    if (c === '(') {
      pos++
      const e = expr()
      if (e === null || src[pos] !== ')') return null
      pos++
      return e
    }
    return number()
  }
  const term = (): number | null => {
    let left = factor()
    while (left !== null && /[*/x×]/i.test(src[pos] ?? '')) {
      const op = src[pos++]
      const right = factor()
      if (right === null || (op === '/' && right === 0)) return null
      left = op === '/' ? left / right : left * right
    }
    return left
  }
  const expr = (): number | null => {
    let left = term()
    while (left !== null && (src[pos] === '+' || src[pos] === '-')) {
      const op = src[pos++]
      const right = term()
      if (right === null) return null
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  const result = expr()
  if (result === null || pos !== src.length || !Number.isFinite(result)) return null
  return Math.round(result * 100) / 100
}

/** True when the text is a calculation rather than a plain number (so the field can show the result). */
export const isExpression = (text: string) => parseAmount(text) === null && evalAmount(text) !== null

export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
export const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const pad = (n: number) => String(n).padStart(2, '0')

export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function todayIso(): string {
  const d = new Date()
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate()

export function isValidIso(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

/** Parses dd/MM/yyyy, dd/MM/yy, dd/MM (current year) or dd (current month). Also accepts - and . as separators. */
export function parseDate(text: string): string | null {
  const parts = text.trim().split(/[/.\-\s]+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null
  const now = new Date()
  const d = Number(parts[0])
  const m = parts.length > 1 ? Number(parts[1]) : now.getMonth() + 1
  let y = parts.length > 2 ? Number(parts[2]) : now.getFullYear()
  if (parts.length > 2 && parts[2].length <= 2) y += 2000
  const iso = toIso(y, m, d)
  return isValidIso(iso) ? iso : null
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function monthRange(y: number, m: number): { from: string; to: string } {
  return { from: toIso(y, m, 1), to: toIso(y, m, daysInMonth(y, m)) }
}

export function shiftMonth(y: number, m: number, delta: number): { year: number; month: number } {
  const idx = y * 12 + (m - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')
