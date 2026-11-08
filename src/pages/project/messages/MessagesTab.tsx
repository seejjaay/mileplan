import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '../../../api/keys'
import { appendMessage, nextCursor, replaceMessage, threadOrder, type Thread } from '../../../api/messageCache'
import { listMessages, markRead, type Cursor, type MessageRow } from '../../../api/messages'
import type { ProjectSummary } from '../../../api/projects'
import { useAuth } from '../../../auth/AuthProvider'
import { toUserMessage } from '../../../lib/errors'
import { messageWindow } from '../../../lib/messageWindow'
import { Button } from '../../../ui/Button'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { useStickToBottom } from './useStickToBottom'

const DEBOUNCE_MS = 1000

function dMMM(d: Date): string {
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' })
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-16 w-2/3 animate-pulse rounded-md bg-[var(--border)] ${i % 2 ? 'self-end' : ''}`} />
      ))}
    </div>
  )
}

export default function MessagesTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const me = profile?.id ?? ''
  const otherName = profile?.role === 'admin' ? 'Client' : 'CJ'
  const win = messageWindow(project, new Date())

  const query = useInfiniteQuery({
    queryKey: qk.messages(project.id),
    queryFn: ({ pageParam }) => listMessages(project.id, pageParam),
    initialPageParam: undefined as Cursor | undefined,
    getNextPageParam: nextCursor,
  })
  const messages = useMemo(() => (query.data ? threadOrder(query.data as Thread) : []), [query.data])
  const latestId = messages.length > 0 ? messages[messages.length - 1].id : undefined

  const scroller = useRef<HTMLDivElement>(null)
  const { atBottom, scrollToBottom, keepPositionWhilePrepending } = useStickToBottom(scroller)
  const visible = useDocumentVisible()

  // --- read state -----------------------------------------------------------
  // readId is the newest message we have marked read; it stays undefined until the first mark (opening the tab).
  const [readId, setReadId] = useState<string | undefined>(undefined)
  const newest = messages[messages.length - 1]
  // Anything from the other side after the last read point, not just the newest: my own reply can land on top of an
  // unread message I never scrolled down to, and that message still has to be marked read.
  const needsRead = useMemo(() => {
    if (!query.isSuccess) return false
    const from = readId === undefined ? 0 : messages.findIndex((m) => m.id === readId) + 1
    return messages.slice(from).some((m) => m.sender_id !== me)
  }, [query.isSuccess, messages, readId, me])

  const markNow = useCallback(() => {
    setReadId(latestId)
    queryClient.setQueryData<Record<string, number>>(qk.unread(), (u) => ({ ...u, [project.id]: 0 }))
    markRead(project.id).catch(() => void queryClient.invalidateQueries({ queryKey: qk.unread() }))
  }, [latestId, project.id, queryClient])

  useEffect(() => {
    if (!needsRead || !atBottom || !visible) return
    const t = setTimeout(markNow, readId === undefined ? 0 : DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [needsRead, atBottom, visible, readId, markNow])

  // --- new messages ---------------------------------------------------------
  const seenLatest = useRef<string | undefined>(undefined)

  useLayoutEffect(() => {
    if (!query.isSuccess || latestId === seenLatest.current) return
    const first = seenLatest.current === undefined
    seenLatest.current = latestId
    if (first || (newest?.sender_id !== me && atBottom)) scrollToBottom() // own sends scroll in onSent
  }, [latestId, query.isSuccess, newest, me, atBottom, scrollToBottom])

  const showPill = needsRead && !atBottom && readId !== undefined

  function jumpToNew() {
    scrollToBottom()
    markNow()
  }

  // --- older pages ----------------------------------------------------------
  const restore = useRef<(() => void) | null>(null)
  const oldestId = messages[0]?.id

  useLayoutEffect(() => {
    if (restore.current) {
      restore.current()
      restore.current = null
    }
  }, [oldestId])

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const loadEarlier = useCallback(() => {
    if (isFetchingNextPage) return
    restore.current = keepPositionWhilePrepending()
    void fetchNextPage()
  }, [isFetchingNextPage, keepPositionWhilePrepending, fetchNextPage])

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined' || !hasNextPage || isFetchNextPageError) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadEarlier()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchNextPageError, loadEarlier, oldestId])

  // --- cache patches from this tab -----------------------------------------
  const onSent = useCallback(
    (m: MessageRow) => {
      queryClient.setQueryData<Thread>(qk.messages(project.id), (t) => appendMessage(t, m))
      scrollToBottom()
    },
    [project.id, queryClient, scrollToBottom],
  )
  const onEdited = useCallback(
    (m: MessageRow) => queryClient.setQueryData<Thread>(qk.messages(project.id), (t) => replaceMessage(t, m)),
    [project.id, queryClient],
  )

  // --- render ---------------------------------------------------------------
  let body
  if (query.isPending) {
    body = <Skeleton />
  } else if (!query.data) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)] p-4">
        <p>{toUserMessage(query.error)}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  } else if (messages.length === 0) {
    body = <p className="m-auto text-[var(--muted)]">No messages yet</p>
  } else {
    body = (
      <>
        <div ref={sentinel} className="flex flex-col items-center gap-2">
          {isFetchNextPageError ? (
            <div role="alert" className="flex items-center gap-3 text-sm">
              <span>{toUserMessage(query.error)}</span>
              <Button variant="secondary" onClick={loadEarlier}>
                Retry
              </Button>
            </div>
          ) : (
            hasNextPage && (
              <Button variant="secondary" loading={isFetchingNextPage} onClick={loadEarlier}>
                Load earlier
              </Button>
            )
          )}
        </div>
        <ul className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at)) && (
                <li className="py-1 text-center text-xs text-[var(--muted)]">
                  <time dateTime={m.created_at}>{dayLabel(m.created_at)}</time>
                </li>
              )}
              <MessageItem message={m} own={m.sender_id === me} onEdited={onEdited} senderName={otherName} />
            </Fragment>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-80 flex-col gap-3">
      <h2 className="sr-only">Messages</h2>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} data-testid="thread-scroll" className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
          {body}
        </div>
        {showPill && (
          <Button onClick={jumpToNew} className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md">
            New messages ↓
          </Button>
        )}
      </div>
      {win.until && win.open && (
        <p className="text-sm text-[var(--muted)]">Project closed. Messages stay open until {dMMM(win.until)}</p>
      )}
      {win.open ? (
        profile && <Composer projectId={project.id} senderId={profile.id} onSent={onSent} />
      ) : (
        <p className="border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
          This thread closed on {win.until ? dMMM(win.until) : ''}
        </p>
      )}
    </div>
  )
}
