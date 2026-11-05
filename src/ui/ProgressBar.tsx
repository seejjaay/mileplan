export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]"
    >
      <div className="h-full bg-[var(--accent)]" style={{ width: `${value}%` }} />
    </div>
  )
}
