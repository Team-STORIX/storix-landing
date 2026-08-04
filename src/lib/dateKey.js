const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDateKey(value) {
  if (typeof value !== 'string') return null

  const dateKey = value.slice(0, 10)
  if (!DATE_KEY_PATTERN.test(dateKey)) return null

  const [year, month, day] = dateKey.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.toISOString().slice(0, 10) === dateKey ? dateKey : null
}

export function addDaysToDateKey(dateKey, days) {
  const normalized = normalizeDateKey(dateKey)
  if (!normalized) return null

  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function getDateKeysInRange(startDateKey, endDateKey, maximumCount = 12) {
  const start = normalizeDateKey(startDateKey)
  const end = normalizeDateKey(endDateKey)

  if (!start || !end || start > end) {
    return Array.from({ length: maximumCount }, () => null)
  }

  const dateKeys = []
  let current = start

  while (current <= end && dateKeys.length < maximumCount) {
    dateKeys.push(current)
    current = addDaysToDateKey(current, 1)
  }

  return dateKeys
}
