import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadNotificationCount,
  type NotificationRow,
} from '../api/notifications'
import { ToastProvider } from '../ui/Toast'
import { NotificationBell } from './NotificationBell'

vi.mock('../api/notifications', async (orig) => ({
  ...(await orig<typeof import('../api/notifications')>()),
  listNotifications: vi.fn(),
  unreadNotificationCount: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))

const list = vi.mocked(listNotifications)
const count = vi.mocked(unreadNotificationCount)
const markRead = vi.mocked(markNotificationsRead)
const markAll = vi.mocked(markAllNotificationsRead)

function row(id: string, extra: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id,
    project_id: 'p1',
    kind: 'update_posted',
    needs_action: false,
    count: 1,
    data: { actor_name: 'CJ', snippet: `Update ${id}` },
    created_at: '2026-11-09T10:00:00Z',
    updated_at: '2026-11-09T10:00:00Z',
    read_at: null,
    project: { title: 'Acme storefront', currency: 'PHP' },
    ...extra,
  }
}

const ACTION = row('n1', { kind: 'milestone_in_review', needs_action: true, data: { milestone_title: 'Discovery' } })
const INFO = row('n2')
const READ = row('n3', { read_at: '2026-11-09T11:00:00Z', data: { actor_name: 'CJ', snippet: 'Old news' } })

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderBell() {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/']}>
          <button type="button">Outside</button>
          <NotificationBell />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return user
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ })

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue([ACTION, INFO, READ])
  count.mockResolvedValue(2)
  markRead.mockResolvedValue()
  markAll.mockResolvedValue()
})

describe('NotificationBell', () => {
  it('shows the unread count on the bell', async () => {
    renderBell()
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
  })

  it('caps the badge at 99+', async () => {
    count.mockResolvedValue(150)
    renderBell()
    const b = await screen.findByRole('button', { name: 'Notifications, 150 unread' })
    expect(within(b).getByText('99+')).toBeInTheDocument()
  })

  it('has no count in its name when nothing is unread', async () => {
    count.mockResolvedValue(0)
    renderBell()
    await waitFor(() => expect(count).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('loading, error and empty are distinct', async () => {
    // never completes: loading, and never the empty message
    list.mockReturnValue(new Promise(() => {}))
    const user = renderBell()
    await user.click(bell())
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument()
  })

  it('shows an error with Retry, not the empty message', async () => {
    list.mockRejectedValue(new Error('boom'))
    const user = renderBell()
    await user.click(bell())
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument()
  })

  it('shows the empty message once an empty list has arrived', async () => {
    list.mockResolvedValue([])
    count.mockResolvedValue(0)
    const user = renderBell()
    await user.click(bell())
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument()
  })

  it('groups items into Needs you, New and Earlier, and only action items say "Action needed"', async () => {
    const user = renderBell()
    await user.click(bell())
    const headings = await screen.findAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual(['Needs you', 'New', 'Earlier'])
    expect(screen.getAllByText('Action needed')).toHaveLength(1)
    expect(screen.getByText('Discovery is ready for your review')).toBeInTheDocument()
    expect(screen.getByText('CJ posted an update: Update n2')).toBeInTheDocument()
    expect(screen.getAllByText('Acme storefront').length).toBe(3)
  })

  it('clicking an info item marks it read and opens its tab', async () => {
    const user = renderBell()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: /CJ posted an update: Update n2/ }))
    expect(markRead).toHaveBeenCalledWith(['n2'])
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1/updates')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
  })

  it('clicking an action item opens its tab without marking it read', async () => {
    const user = renderBell()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: /Discovery is ready for your review/ }))
    expect(markRead).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1/milestones')
  })

  it('Dismiss marks one action item read', async () => {
    const user = renderBell()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(markRead).toHaveBeenCalledWith(['n1'])
  })

  it('Mark all read calls the RPC', async () => {
    const user = renderBell()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }))
    expect(markAll).toHaveBeenCalledTimes(1)
  })

  // The button that was clicked disappears from the list; focus must not fall back to the page, or Escape stops working.
  it('keeps focus inside the panel after Dismiss and after Mark all read', async () => {
    const user = renderBell()
    await user.click(bell())
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    const heading = screen.getByRole('heading', { name: 'Notifications', level: 2 })
    await waitFor(() => expect(heading).toHaveFocus())

    screen.getByRole('button', { name: 'Outside' }).focus()
    await user.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('renders an item whose project is hidden', async () => {
    list.mockResolvedValue([row('n9', { project: null })])
    const user = renderBell()
    await user.click(bell())
    expect(await screen.findByText('A project you no longer have access to')).toBeInTheDocument()
  })

  it('Escape closes the panel only when focus is inside it', async () => {
    const user = renderBell()
    await user.click(bell())
    const first = await screen.findByRole('button', { name: /Discovery is ready for your review/ })
    const panel = screen.getByRole('dialog', { name: 'Notifications' })

    screen.getByRole('button', { name: 'Outside' }).focus()
    await user.keyboard('{Escape}')
    expect(panel).toBeInTheDocument()

    first.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(bell()).toHaveFocus()
  })

  it('a pointer press outside closes the panel', async () => {
    const user = renderBell()
    await user.click(bell())
    await screen.findByRole('dialog', { name: 'Notifications' })
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
  })
})
