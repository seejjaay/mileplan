export type ChipStatus = 'done' | 'active' | 'upcoming' | 'attention' | 'inactive'
type Variant = 'solid' | 'outline' | 'dashed'

// Fill style differs per status, so meaning never rests on colour alone.
const config: Record<ChipStatus, { variant: Variant; className: string }> = {
  done: { variant: 'solid', className: 'bg-[var(--ok)] text-[var(--bg)] border-[var(--ok)]' },
  active: { variant: 'outline', className: 'border-2 border-[var(--accent)] text-[var(--text)]' },
  upcoming: { variant: 'dashed', className: 'border border-dashed border-[var(--muted)] text-[var(--muted)]' },
  attention: { variant: 'solid', className: 'bg-[var(--warn)] text-[var(--bg)] border-[var(--warn)]' },
  inactive: { variant: 'dashed', className: 'border border-dashed border-[var(--danger)] text-[var(--danger)]' },
}

export function StatusChip({ status, label }: { status: ChipStatus; label: string }) {
  const { variant, className } = config[status]
  return (
    <span data-variant={variant} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
