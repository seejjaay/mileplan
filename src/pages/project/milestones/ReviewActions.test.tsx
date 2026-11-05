import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../../auth/AuthProvider'
import { ToastProvider } from '../../../ui/Toast'
import { qk } from '../../../api/keys'
import type { Milestone } from '../../../api/milestones'
import { latestReview, submitReview, type Review } from '../../../api/reviews'
import { ReviewActions } from './ReviewActions'

vi.mock('../../../api/reviews', async (orig) => ({ ...(await orig<typeof import('../../../api/reviews')>()), submitReview: vi.fn() }))

const milestone = (status: Milestone['status']): Milestone => ({
  id: 'm1',
  project_id: 'p1',
  position: 1,
  title: 'Discovery',
  description: null,
  acceptance_criteria: [],
  due_date: null,
  amount: 0,
  status,
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [],
})

let queryClient: QueryClient

function renderActions(status: Milestone['status'], role: 'admin' | 'client' = 'client') {
  queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'Eve', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <ReviewActions milestone={milestone(status)} />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(submitReview).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('ReviewActions', () => {
  it('renders nothing unless the milestone is in review', () => {
    renderActions('planned')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing for the admin', () => {
    renderActions('in_review', 'admin')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers Approve and Request changes to a client', () => {
    renderActions('in_review')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument()
  })

  it('asks for confirmation before approving, then submits and toasts', async () => {
    renderActions('in_review')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(submitReview).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve milestone' }))
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith('m1', 'u1', 'approved', undefined))
    expect(await screen.findByText('Milestone approved')).toBeInTheDocument()
  })

  it('requires a comment to request changes', async () => {
    renderActions('in_review')
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    const dialog = within(screen.getByRole('dialog'))
    const send = dialog.getByRole('button', { name: 'Send request' })
    expect(send).toBeDisabled()
    await userEvent.type(dialog.getByLabelText('What needs to change?'), '   ')
    expect(send).toBeDisabled()
    await userEvent.type(dialog.getByLabelText('What needs to change?'), 'Logo too small')
    expect(send).toBeEnabled()
    await userEvent.click(send)
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith('m1', 'u1', 'changes_requested', 'Logo too small'))
    expect(await screen.findByText('Changes requested')).toBeInTheDocument()
  })

  it('a review that lost the race shows the already-reviewed copy and refetches', async () => {
    vi.mocked(submitReview).mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' })
    renderActions('in_review')
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve milestone' }))
    expect(await screen.findByText('This milestone was already reviewed.')).toBeInTheDocument()
    expect(screen.queryByText("You don't have access to this")).not.toBeInTheDocument()
    await waitFor(() => expect(spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))).toContain(JSON.stringify(qk.milestones('p1'))))
  })

  it('other failures keep the dialog open and show the reason', async () => {
    vi.mocked(submitReview).mockRejectedValue(new Error('Network down'))
    renderActions('in_review')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve milestone' }))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('latestReview', () => {
  const r = (id: string, milestone_id: string, created_at: string): Review => ({
    id,
    milestone_id,
    user_id: 'u',
    decision: 'approved',
    comment: null,
    created_at,
    reviewer_name: 'Eve',
  })

  it('picks the newest review for the milestone', () => {
    const all = [r('a', 'm1', '2026-11-01T00:00:00Z'), r('b', 'm1', '2026-11-03T00:00:00Z'), r('c', 'm2', '2026-11-04T00:00:00Z')]
    expect(latestReview(all, 'm1')?.id).toBe('b')
    expect(latestReview(all, 'nope')).toBeUndefined()
  })
})
