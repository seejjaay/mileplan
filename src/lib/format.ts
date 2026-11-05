/** 'YYYY-MM-DD' -> 'Dec 1, 2026', built from parts so the local timezone can't shift the day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatMoney(amount: number | string, currency: string): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(amount))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "Nov 6, 14:02" — local date and 24-hour time, used for acknowledgement stamps. */
export function formatAckStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
