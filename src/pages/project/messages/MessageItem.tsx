import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { editMessage, type MessageRow } from '../../../api/messages'
import { signedUrl } from '../../../api/storage'
import { toUserMessage } from '../../../lib/errors'
import { formatBytes } from '../../../lib/format'
import { linkify } from '../../../lib/linkify'
import { openUrl } from '../../../lib/openUrl'
import { Button } from '../../../ui/Button'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'

const EDIT_WINDOW_MS = 15 * 60 * 1000
const WINDOW_CLOSED = 'The 15-minute edit window has closed'

/** Epoch ms after which the sender can no longer edit; the database enforces the same cut-off. */
export function canEditUntil(m: MessageRow): number {
  return new Date(m.created_at).getTime() + EDIT_WINDOW_MS
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function isRefusedEdit(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
  return code === 'PGRST116' || code === '42501'
}

type Props = {
  message: MessageRow
  own: boolean
  onEdited: (m: MessageRow) => void
  /** Shown for other people's messages; the thread resolves it, as a message row carries only sender_id. */
  senderName?: string
}

export function MessageItem({ message, own, onEdited, senderName }: Props) {
  const toast = useToast()
  const until = canEditUntil(message)
  const [expired, setExpired] = useState(() => Date.now() >= until)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const editSlot = useRef<HTMLDivElement>(null) // Button doesn't forward refs, so focus goes through its wrapper
  const refocusEdit = useRef(false)

  // Flip to expired at the deadline so Edit disappears without waiting for another render.
  useEffect(() => {
    if (!own) return
    const t = setTimeout(() => setExpired(true), Math.max(until - Date.now(), 0))
    return () => clearTimeout(t)
  }, [own, until])

  useEffect(() => {
    if (!editing && refocusEdit.current) {
      refocusEdit.current = false
      editSlot.current?.querySelector('button')?.focus()
    }
  }, [editing])

  const open = useMutation({
    mutationFn: async (a: MessageRow['attachments'][number]) => openUrl(await signedUrl('attachments', a.path, a.name)),
    onError: (err) => toast.error(toUserMessage(err)),
  })

  const save = useMutation({
    mutationFn: () => editMessage(message.id, draft.trim()),
    onSuccess: (saved) => {
      onEdited(saved)
      toast.success('Message edited')
      refocusEdit.current = true
      setEditing(false)
    },
    onError: (err) => toast.error(isRefusedEdit(err) ? WINDOW_CLOSED : toUserMessage(err)),
  })

  function startEdit() {
    setDraft(message.body)
    setEditing(true)
  }
  function cancel() {
    refocusEdit.current = true
    setEditing(false)
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      cancel()
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSave) save.mutate()
  }

  const trimmed = draft.trim()
  const canSave = trimmed !== '' && trimmed !== message.body

  return (
    <li className={`flex flex-col gap-1 ${own ? 'items-end' : 'items-start'}`}>
      <div
        className={`flex max-w-[85%] flex-col gap-2 rounded-md border border-[var(--border)] p-3 ${own ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}`}
      >
        <p className="text-sm text-[var(--muted)]">
          {own ? 'You' : (senderName ?? 'Project team')} · {whenLabel(message.created_at)}
          {message.edited_at && <span className="ml-2 italic">edited</span>}
        </p>
        {editing ? (
          <form onSubmit={onSubmit} onKeyDown={onKeyDown} className="flex flex-col gap-2">
            <Field label="Message">
              <textarea
                autoFocus
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending} disabled={!canSave}>
                Save
              </Button>
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {linkify(message.body).map((seg, i) =>
              seg.kind === 'link' ? (
                <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">
                  {seg.text}
                </a>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        )}
        {message.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <li key={a.path}>
                <Button variant="secondary" loading={open.isPending && open.variables?.path === a.path} onClick={() => open.mutate(a)}>
                  {a.name} ({formatBytes(a.size)})
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {own && !expired && !editing && (
        <div ref={editSlot}>
          <Button variant="secondary" onClick={startEdit}>
            Edit
          </Button>
        </div>
      )}
    </li>
  )
}
