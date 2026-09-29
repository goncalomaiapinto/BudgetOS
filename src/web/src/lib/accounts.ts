import type { Account, Category, EntryType } from './api'

// Remembered across sessions: the account last used for each subcategory (e.g. Restaurante → Cartão Refeição).
export const accountMemory = {
  get(subCategoryId: number): number | null {
    try {
      const v = Number(localStorage.getItem(`tx.account.sub.${subCategoryId}`))
      return Number.isInteger(v) && v > 0 ? v : null
    } catch {
      return null
    }
  },
  set(subCategoryId: number, accountId: number) {
    try {
      localStorage.setItem(`tx.account.sub.${subCategoryId}`, String(accountId))
    } catch {
      // storage unavailable: the default account is used next time
    }
  },
}

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export const defaultAccount = (accounts: Account[]) => accounts.find((a) => a.isDefault) ?? accounts[0]
export const mealCardAccount = (accounts: Account[]) => accounts.find((a) => a.kind === 'MealCard' && a.isActive)

/** Is this the "Receitas › Cartão Refeição" line (meal card top-ups)? */
export const isMealTopUp = (name: string) => normalize(name).includes('cartao refeicao')

/**
 * Account suggested for a subcategory: the one used last time (if still active),
 * else the meal card for "Receitas › Cartão Refeição", else the default account.
 */
export function suggestAccount(
  accounts: Account[],
  categories: Category[],
  type: EntryType,
  subCategoryId: number | '' | null,
): number | '' {
  const fallback = defaultAccount(accounts)?.id ?? ''
  if (subCategoryId === '' || subCategoryId === null) return fallback
  const remembered = accountMemory.get(subCategoryId)
  if (remembered && accounts.some((a) => a.id === remembered && a.isActive)) return remembered
  const sub = categories.flatMap((c) => c.subCategories).find((s) => s.id === subCategoryId)
  const card = mealCardAccount(accounts)
  if (type === 'Income' && sub && card && isMealTopUp(sub.name)) return card.id
  return fallback
}
