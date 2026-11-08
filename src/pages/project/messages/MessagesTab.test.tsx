import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../../auth/AuthProvider'
import { ToastProvider } from '../../../ui/Toast'
import { qk } from '../../../api/keys'
import { appendMessage, type Thread } from '../../../api/messageCache'
import { listMessages, markRead, type MessageRow } from '../../../api/messages'
import type { ProjectSummary } from '../../../api/projects'
import MessagesTab from './MessagesTab'

vi.mock('../../../api/messages', async (orig) => ({
  ...(await orig<typeof import('../../../api/messages')>()),
  listMessages: vi.fn(),
  markRead: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
}))

const project: ProjectSummary = {
  id: 'p1', title: 'Website rebuild', summary: null, status: 'active', currency: 'PHP', start_date: null, end_date: null,
  activated_at: null, closed_at: null, created_at: '2026-11-01T00:00:00Z', percent: 0, nextDue: null, scheduled: 0, paid: 0, outstanding: 0, overdue: 0,
}

function msg(n: number, over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: `m${n}`, created_at: new Date(Date.UTC(2026, 10, 7, 12, 0, n)).toISOString(), project_id: 'p1', sender_id: 'other',
    body: `body ${n}`, attachments: [], edited_at: null, ...over,
  }
}

let client: QueryClient
function renderTab(p: ProjectSummary = project) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(qk.unread(), { p1: 2 })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthContext.Provider
          value={{ session: { user: { id: 'me' } } as Session, profile: { id: 'me', role: 'admin', full_name: 'CJ', active: true }, loading: false, signOut: async () => {} }}
        >
          <MessagesTab project={p} />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** Gives the scroll container fixed geometry so "at bottom" is decided by scrollTop. */
function geometry(scrollTop: number) {
  const el = screen.getByTestId('thread-scroll')
  let top = scrollTop
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 })
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) })
  return {
    el,
    scrollTo(v: number) {
      top = v
      act(() => void el.dispatchEvent(new Event('scroll')))
    },
  }
}

function pushMessage(m: MessageRow) {
  act(() => void client.setQueryData<Thread>(qk.messages('p1'), (t) => appendMessage(t, m)))
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

const PILL = 'New messages ↓'

beforeEach(() => {
  vi.mocked(markRead).mockResolvedValue(undefined)
  setVisibility('visible')
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('MessagesTab', () => {
  it('shows a skeleton while loading, never the empty state', () => {
    vi.mocked(listMessages).mockReturnValue(new Promise(() => {}))
    renderTab()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
  })

  it('shows Retry when the load fails', async () => {
    vi.mocked(listMessages).mockRejectedValueOnce(new Error('nope')).mockResolvedValue([msg(1)])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('body 1')).toBeInTheDocument()
  })

  it('shows the empty state for an empty thread', async () => {
    vi.mocked(listMessages).mockResolvedValue([])
    renderTab()
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
  })

  it('renders oldest to newest with a separator between days', async () => {
    const newer = msg(3, { created_at: '2026-11-08T12:00:00Z' })
    vi.mocked(listMessages).mockResolvedValue([newer, msg(2), msg(1)]) // newest first, as the API returns
    renderTab()
    await screen.findByText('body 1')
    const text = screen.getByTestId('thread-scroll').textContent ?? ''
    expect(text.indexOf('body 1')).toBeLessThan(text.indexOf('body 2'))
    expect(text.indexOf('body 2')).toBeLessThan(text.indexOf('body 3'))
    expect(screen.getByText('Nov 7, 2026')).toBeInTheDocument()
    expect(screen.getByText('Nov 8, 2026')).toBeInTheDocument()
  })

  it('Load earlier asks for the page before the oldest loaded message', async () => {
    const page = Array.from({ length: 50 }, (_, i) => msg(100 - i)) // newest first: m100 … m51
    vi.mocked(listMessages).mockResolvedValueOnce(page).mockResolvedValueOnce([msg(1)])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }))
    expect(listMessages).toHaveBeenLastCalledWith('p1', { created_at: page[49].created_at, id: 'm51' })
    expect(await screen.findByText('body 1')).toBeInTheDocument()
  })

  it('keeps loaded messages and offers Retry when Load earlier fails', async () => {
    const page = Array.from({ length: 50 }, (_, i) => msg(100 - i))
    vi.mocked(listMessages).mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([msg(1)])
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('offline')
    expect(screen.getByText('body 100')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('body 1')).toBeInTheDocument()
  })

  it('marks the thread read once on open and zeroes the unread count', async () => {
    vi.mocked(listMessages).mockResolvedValue([msg(1)])
    renderTab()
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    expect(markRead).toHaveBeenCalledWith('p1')
    expect(client.getQueryData<Record<string, number>>(qk.unread())?.p1).toBe(0)
  })

  it('marks read 1s after a new message arrives while at the bottom', async () => {
    vi.mocked(listMessages).mockResolvedValue([msg(1)])
    renderTab()
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    vi.useFakeTimers()
    pushMessage(msg(2))
    await act(async () => void (await vi.advanceTimersByTimeAsync(0))) // let the cache notification render
    expect(markRead).toHaveBeenCalledTimes(1)
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)))
    expect(markRead).toHaveBeenCalledTimes(2)
  })

  it('shows the pill and does not mark read when a message arrives while scrolled up', async () => {
    vi.mocked(listMessages).mockResolvedValue([msg(1)])
    renderTab()
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    const g = geometry(0)
    g.scrollTo(0) // 600px from the bottom
    pushMessage(msg(2))
    const pill = await screen.findByRole('button', { name: PILL })
    await new Promise((r) => setTimeout(r, 1100))
    expect(markRead).toHaveBeenCalledTimes(1)
    expect(g.el.scrollTop).toBe(0) // the view did not move
    await userEvent.click(pill)
    expect(g.el.scrollTop).toBe(1000)
    expect(markRead).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: PILL })).not.toBeInTheDocument()
  })

  it('marks read when the reader scrolls back to the bottom', async () => {
    vi.mocked(listMessages).mockResolvedValue([msg(1)])
    renderTab()
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    const g = geometry(0)
    g.scrollTo(0)
    pushMessage(msg(2))
    await screen.findByRole('button', { name: PILL })
    vi.useFakeTimers()
    g.scrollTo(580) // 20px from the bottom
    expect(screen.queryByRole('button', { name: PILL })).not.toBeInTheDocument()
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)))
    expect(markRead).toHaveBeenCalledTimes(2)
  })

  it('does not mark read while the browser tab is hidden, then does once it is visible', async () => {
    vi.mocked(listMessages).mockResolvedValue([msg(1)])
    renderTab()
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    pushMessage(msg(2))
    await new Promise((r) => setTimeout(r, 1100))
    expect(markRead).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    setVisibility('visible')
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)))
    expect(markRead).toHaveBeenCalledTimes(2)
  })

  it('notes the remaining window on a closed project and replaces the composer after it', async () => {
    vi.mocked(listMessages).mockResolvedValue([])
    const recent = new Date(Date.now() - 2 * 86400000).toISOString()
    const { unmount } = renderTab({ ...project, status: 'completed', closed_at: recent })
    expect(await screen.findByText(/^Project closed\. Messages stay open until \d{1,2} [A-Z][a-z]{2}$/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    unmount()
    const old = new Date(Date.now() - 40 * 86400000).toISOString()
    renderTab({ ...project, status: 'completed', closed_at: old })
    expect(await screen.findByText(/^This thread closed on \d{1,2} [A-Z][a-z]{2}$/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
  })
})
