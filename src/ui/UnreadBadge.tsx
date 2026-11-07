/** Unread count next to a card or tab label; nothing at zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} unread`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-xs font-semibold text-[var(--accent-contrast)]"
    >
      {count}
    </span>
  )
}
