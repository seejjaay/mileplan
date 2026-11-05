/** Fixed, polite status pill shown while a previously working live connection is down. */
export function ReconnectingPill({ visible }: { visible: boolean }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2">
      {visible && (
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-sm shadow-md">Reconnecting…</span>
      )}
    </div>
  )
}
