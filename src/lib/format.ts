/** 'YYYY-MM-DD' -> 'Dec 1, 2026', built from parts so the local timezone can't shift the day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatMoney(amount: number | string, currency: string): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(amount))
}
