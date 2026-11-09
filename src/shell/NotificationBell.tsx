import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { qk } from '../api/keys'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadNotificationCount,
  type NotificationRow,
} from '../api/notifications'
import { describeNotification } from '../lib/describeNotification'
import { toUserMessage } from '../lib/errors'
import { relativeTime } from '../lib/relativeTime'
import { AsyncView } from '../ui/AsyncView'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { UnreadBadge } from '../ui/UnreadBadge'

const HIDDEN_PROJECT = 'A project you no longer have access to'

function Item({ n, onOpen, onDismiss }: { n: NotificationRow; onOpen: (n: NotificationRow) => void; onDismiss: (n: NotificationRow) => void }) {
  const { text } = describeNotification(n)
  const unreadAction = !n.read_at && n.needs_action
  return (
    <li className="flex items-start gap-2">
      <button
        type="button"
        data-notification-item
        onClick={() => onOpen(n)}
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-[var(--border)]"
      >
        <span className={`break-words text-sm ${n.read_at ? 'text-[var(--muted)]' : 'font-medium'}`}>{text}</span>
        <span className="break-words text-xs text-[var(--muted)]">
          <span>{n.project?.title ?? HIDDEN_PROJECT}</span> · <span>{relativeTime(n.updated_at)}</span>
        </span>
        {unreadAction && (
          <span className="w-fit rounded-full border border-[var(--accent)] px-2 py-0.5 text-xs font-semibold">Action needed</span>
        )}
      </button>
      {unreadAction && (
        <button type="button" onClick={() => onDismiss(n)} className="mt-2 rounded px-2 py-1 text-xs text-[var(--muted)] underline">
          Dismiss
        </button>
      )}
    </li>
  )
}

function Section({ title, items, onOpen, onDismiss }: { title: string; items: NotificationRow[]; onOpen: (n: NotificationRow) => void; onDismiss: (n: NotificationRow) => void }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((n) => (
          <Item key={n.id} n={n} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </ul>
    </section>
  )
}

/** The header bell: a live, cross-project list of what needs attention. Action items clear themselves in the database. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const focused = useRef(false)

  const list = useQuery({ queryKey: qk.notifications(), queryFn: listNotifications })
  const countQuery = useQuery({ queryKey: qk.notificationCount(), queryFn: unreadNotificationCount })
  const unread = countQuery.data ?? 0

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.notifications() })
  // The button that was pressed leaves the list, so focus goes to the panel heading (a no-op once the panel is closed).
  const keepFocus = () => heading.current?.focus()
  const markRead = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSuccess: keepFocus,
    onSettled: refresh,
    onError: (e) => toast.error(toUserMessage(e)),
  })
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: keepFocus,
    onSettled: refresh,
    onError: (e) => toast.error(toUserMessage(e)),
  })

  // A press outside the bell and its panel closes it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // On open, move focus into the panel once the list has settled: first item, or the heading when there are none.
  useEffect(() => {
    if (!open) {
      focused.current = false
      return
    }
    if (focused.current || list.isPending) return
    const first = panel.current?.querySelector<HTMLElement>('[data-notification-item]')
    ;(first ?? heading.current)?.focus()
    focused.current = true
  }, [open, list.isPending, list.data])

  const openItem = (n: NotificationRow) => {
    if (!n.read_at && !n.needs_action) markRead.mutate([n.id])
    setOpen(false)
    navigate(`/projects/${n.project_id}/${describeNotification(n).tab}`)
  }
  const dismiss = (n: NotificationRow) => markRead.mutate([n.id])

  const rows = list.data ?? []
  const needsYou = rows.filter((n) => !n.read_at && n.needs_action)
  const fresh = rows.filter((n) => !n.read_at && !n.needs_action)
  const earlier = rows.filter((n) => n.read_at)

  return (
    <div ref={wrapper} className="sm:relative">
      <button
        ref={button}
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="relative flex min-h-11 items-center gap-1 rounded-md px-3 py-2"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <UnreadBadge count={unread} />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Notifications"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
              button.current?.focus()
            }
          }}
          className="fixed inset-x-2 top-16 z-30 flex max-h-[70vh] flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-md sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[22rem]"
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-1">
            <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">
              Notifications
            </h2>
            {fresh.length > 0 && (
              <Button variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate()}>
                Mark all read
              </Button>
            )}
          </div>
          <AsyncView query={list} empty={<p className="px-3 py-4 text-sm text-[var(--muted)]">You're all caught up.</p>} onRetry={() => void list.refetch()}>
            {() => (
              <>
                <Section title="Needs you" items={needsYou} onOpen={openItem} onDismiss={dismiss} />
                <Section title="New" items={fresh} onOpen={openItem} onDismiss={dismiss} />
                <Section title="Earlier" items={earlier} onOpen={openItem} onDismiss={dismiss} />
              </>
            )}
          </AsyncView>
        </div>
      )}
    </div>
  )
}
