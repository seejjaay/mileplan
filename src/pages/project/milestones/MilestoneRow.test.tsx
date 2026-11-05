import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { updateMilestone, type Milestone } from '../../../api/milestones'
import type { Review } from '../../../api/reviews'
import { MilestoneRow } from './MilestoneRow'

vi.mock('../../../api/milestones', async (orig) => ({
  ...(await orig<typeof import('../../../api/milestones')>()),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  mergeMilestones: vi.fn(),
  splitMilestone: vi.fn(),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
}))

const base: Milestone = {
  id: 'm1',
  project_id: 'p1',
  position: 1,
  title: 'Discovery',
  description: null,
  acceptance_criteria: [],
  due_date: '2026-12-01',
  amount: 1000,
  status: 'planned',
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [],
}

function mount(milestone: Milestone, review?: Review) {
  const client = new QueryClient() // one client for the whole test, like the real app
  const ui = (m: Milestone) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MilestoneRow milestone={m} review={review} projectStatus="setup" currency="PHP" />
      </ToastProvider>
    </QueryClientProvider>
  )
  const view = render(ui(milestone))
  return { update: (m: Milestone) => view.rerender(ui(m)) }
}

beforeEach(() => {
  // braces matter: a function returned from beforeEach is run by vitest as a teardown
  vi.mocked(updateMilestone).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('MilestoneRow while the data changes underneath it', () => {
  it('a clean row silently picks up new saved values', () => {
    const { update } = mount(base)
    update({ ...base, title: 'Renamed remotely', amount: 1500 })
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed remotely')
    expect(screen.getByLabelText('Amount')).toHaveValue(1500)
    expect(screen.queryByText(/Changed elsewhere/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('a dirty row keeps the typing and says it changed elsewhere', async () => {
    const { update } = mount(base)
    await userEvent.clear(screen.getByLabelText('Amount'))
    await userEvent.type(screen.getByLabelText('Amount'), '2000')
    update({ ...base, title: 'Renamed remotely' })
    expect(screen.getByLabelText('Amount')).toHaveValue(2000)
    expect(screen.getByText(/Changed elsewhere/)).toBeInTheDocument()
  })

  it('Load latest replaces the draft with the saved values', async () => {
    const { update } = mount(base)
    await userEvent.clear(screen.getByLabelText('Amount'))
    await userEvent.type(screen.getByLabelText('Amount'), '2000')
    update({ ...base, title: 'Renamed remotely', amount: 1200 })
    await userEvent.click(screen.getByRole('button', { name: 'Load latest' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed remotely')
    expect(screen.getByLabelText('Amount')).toHaveValue(1200)
    expect(screen.queryByText(/Changed elsewhere/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('saving after a remote change sends only the fields that were edited here', async () => {
    const { update } = mount(base)
    await userEvent.clear(screen.getByLabelText('Amount'))
    await userEvent.type(screen.getByLabelText('Amount'), '2000')
    update({ ...base, title: 'Renamed remotely' }) // CJ's other tab renamed it
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalledWith('m1', { amount: 2000 }, undefined))
  })

  it('after its own save the row follows the refreshed values without a banner', async () => {
    const { update } = mount(base)
    await userEvent.clear(screen.getByLabelText('Amount'))
    await userEvent.type(screen.getByLabelText('Amount'), '2000.50')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalled())
    update({ ...base, amount: 2000.5 })
    expect(screen.queryByText(/Changed elsewhere/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled())
    expect(screen.getByLabelText('Amount')).toHaveValue(2000.5)
  })

  it('a failed save keeps the edits marked as edited', async () => {
    vi.mocked(updateMilestone).mockRejectedValue(new Error('Network down'))
    const { update } = mount(base)
    await userEvent.clear(screen.getByLabelText('Amount'))
    await userEvent.type(screen.getByLabelText('Amount'), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    console.log('A')
    update({ ...base, title: 'Renamed remotely' })
    console.log('B')
    expect(screen.getByLabelText('Amount')).toHaveValue(2000)
    console.log('C')
    expect(screen.getByText(/Changed elsewhere/)).toBeInTheDocument()
  })

  it('shows the admin the latest client review, with the comment', () => {
    mount(base, { id: 'r1', milestone_id: 'm1', user_id: 'c1', decision: 'changes_requested', comment: 'Logo too small', created_at: '2026-11-05T08:00:00Z', reviewer_name: 'Dee' })
    expect(screen.getByText('Changes requested by Dee: “Logo too small”')).toBeInTheDocument()
  })

  it('shows an approval without a comment', () => {
    mount(base, { id: 'r1', milestone_id: 'm1', user_id: 'c1', decision: 'approved', comment: null, created_at: '2026-11-05T08:00:00Z', reviewer_name: 'Dee' })
    expect(screen.getByText('Approved by Dee')).toBeInTheDocument()
  })

  it('shows nothing when there is no review', () => {
    mount(base)
    expect(screen.queryByText(/Approved by|Changes requested by/)).not.toBeInTheDocument()
  })
})
