import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal: focus moves in on open, Tab is trapped, Esc closes, focus returns to the opener. */
export function Dialog({ open, onClose, title, children, wide = false }: Props) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstItem || !panel.current.contains(active))) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && (active === lastItem || !panel.current.contains(active))) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
