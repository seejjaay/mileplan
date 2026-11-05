import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../../auth/AuthProvider'
import { ToastProvider } from '../../../ui/Toast'
import { addMilestone, deleteMilestone, listMilestones, mergeMilestones, updateMilestone, type Milestone } from '../../../api/milestones'
import { listReviews, type Review } from '../../../api/reviews'
import type { ProjectSummary } from '../../../api/projects'
import MilestonesTab from './MilestonesTab'

vi.mock('../../../api/reviews', async (orig) => ({ ...(await orig<typeof import('../../../api/reviews')>()), listReviews: vi.fn(), submitReview: vi.fn() }))
vi.mock('../../../api/milestones', async (orig) => ({
  ...(await orig<typeof import('../../../api/milestones')>()),
  listMilestones: vi.fn(),
  addMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  reorderMilestones: vi.fn(),
  reorderTasks: vi.fn(),
  mergeMilestones: vi.fn(),
  splitMilestone: vi.fn(),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))

const project = (status: ProjectSummary['status']): ProjectSummary => ({
  id: 'p1',
  title: 'Website rebuild',
  summary: null,
  status,
  currency: 'PHP',
  start_date: null,
  end_date: null,
  activated_at: null,
  closed_at: null,
  created_at: '2026-11-01T00:00:00Z',
  percent: 0,
  nextDue: null,
})

const m1: Milestone = {
  id: 'm1',
  project_id: 'p1',
  position: 1,
  title: 'Discovery',
  description: 'Research',
  acceptance_criteria: ['Wireframes approved'],
  due_date: '2026-12-01',
  amount: 1000,
  status: 'planned',
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [],
}

function renderTab(status: ProjectSummary['status'] = 'active', role: 'admin' | 'client' = 'admin') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'X', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <MemoryRouter>
            <MilestonesTab project={project(status)} />
          </MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(listReviews).mockResolvedValue([])
  vi.mocked(listMilestones).mockResolvedValue([m1])
  vi.mocked(updateMilestone).mockResolvedValue()
  vi.mocked(deleteMilestone).mockResolvedValue()
  vi.mocked(addMilestone).mockResolvedValue('new-id')
})
afterEach(() => vi.clearAllMocks())

async function row() {
  return within(await screen.findByRole('group', { name: 'Discovery' }))
}

describe('MilestonesTab (admin)', () => {
  it('shows the exact empty copy only after an empty result', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab()
    expect(screen.queryByText('No milestones yet. Add the first one.')).not.toBeInTheDocument()
    expect(await screen.findByText('No milestones yet. Add the first one.')).toBeInTheDocument()
  })

  it('keeps Save disabled until the row is dirty', async () => {
    renderTab()
    const r = await row()
    const save = r.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await userEvent.clear(r.getByLabelText('Amount'))
    await userEvent.type(r.getByLabelText('Amount'), '2000')
    expect(save).toBeEnabled()
    await userEvent.clear(r.getByLabelText('Amount'))
    await userEvent.type(r.getByLabelText('Amount'), '1000')
    expect(save).toBeDisabled()
  })

  it('asks for a reason on a plan-field edit of an active project, not for a status edit', async () => {
    renderTab('active')
    const r = await row()
    await userEvent.selectOptions(r.getByLabelText('Status'), 'in_progress')
    expect(r.queryByLabelText('Reason for change (optional)')).not.toBeInTheDocument()
    await userEvent.clear(r.getByLabelText('Amount'))
    await userEvent.type(r.getByLabelText('Amount'), '2000')
    expect(r.getByLabelText('Reason for change (optional)')).toBeInTheDocument()
  })

  it('does not ask for a reason while the project is still in setup', async () => {
    renderTab('setup')
    const r = await row()
    await userEvent.clear(r.getByLabelText('Amount'))
    await userEvent.type(r.getByLabelText('Amount'), '2000')
    expect(r.queryByLabelText('Reason for change (optional)')).not.toBeInTheDocument()
  })

  it('sends only the changed fields and the reason, then toasts', async () => {
    renderTab('active')
    const r = await row()
    await userEvent.clear(r.getByLabelText('Amount'))
    await userEvent.type(r.getByLabelText('Amount'), '2000')
    await userEvent.type(r.getByLabelText('Reason for change (optional)'), 'client asked')
    await userEvent.click(r.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalledWith('m1', { amount: 2000 }, 'client asked'))
    expect(await screen.findByText('Milestone saved')).toBeInTheDocument()
  })

  it('turns acceptance criteria lines into an array', async () => {
    renderTab('setup')
    const r = await row()
    const box = r.getByLabelText('Acceptance criteria (one per line)')
    await userEvent.clear(box)
    await userEvent.type(box, 'First{enter}Second{enter}{enter}')
    await userEvent.click(r.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateMilestone).toHaveBeenCalledWith('m1', { acceptance_criteria: ['First', 'Second'] }, undefined))
  })

  it('asks for confirmation before deleting', async () => {
    renderTab('active')
    const r = await row()
    await userEvent.click(r.getByRole('button', { name: 'Delete milestone' }))
    expect(deleteMilestone).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(deleteMilestone).toHaveBeenCalledWith('m1', undefined))
    expect(await screen.findByText('Milestone deleted')).toBeInTheDocument()
  })

  it('adds a milestone with only a title, Add disabled until then', async () => {
    renderTab('setup')
    await screen.findByRole('group', { name: 'Discovery' })
    await userEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add milestone' }))
    const add = dialog.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    await userEvent.type(dialog.getByLabelText('Title'), 'Build')
    expect(add).toBeEnabled()
    await userEvent.click(add)
    await waitFor(() => expect(addMilestone).toHaveBeenCalledWith('p1', expect.objectContaining({ title: 'Build' }), undefined))
    expect(await screen.findByText('Milestone added')).toBeInTheDocument()
  })
})

describe('MilestonesTab split and merge', () => {
  const m2: Milestone = { ...m1, id: 'm2', position: 2, title: 'Build' }

  it('offers Merge with next on every milestone except the last, behind a confirmation', async () => {
    vi.mocked(listMilestones).mockResolvedValue([m1, m2])
    vi.mocked(mergeMilestones).mockResolvedValue()
    renderTab('active')
    const first = within(await screen.findByRole('group', { name: 'Discovery' }))
    const second = within(await screen.findByRole('group', { name: 'Build' }))
    expect(second.queryByRole('button', { name: 'Merge with next' })).not.toBeInTheDocument()
    await userEvent.click(first.getByRole('button', { name: 'Merge with next' }))
    expect(mergeMilestones).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm merge' }))
    await waitFor(() => expect(mergeMilestones).toHaveBeenCalledWith('m1', 'm2', undefined))
    expect(await screen.findByText('Milestones merged')).toBeInTheDocument()
  })

  it('disables Split and Merge while the row has unsaved edits', async () => {
    vi.mocked(listMilestones).mockResolvedValue([m1, m2])
    renderTab('setup')
    const first = within(await screen.findByRole('group', { name: 'Discovery' }))
    expect(first.getByRole('button', { name: 'Split milestone' })).toBeEnabled()
    await userEvent.type(first.getByLabelText('Title'), ' v2')
    expect(first.getByRole('button', { name: 'Split milestone' })).toBeDisabled()
    expect(first.getByRole('button', { name: 'Merge with next' })).toBeDisabled()
  })
})

describe('MilestonesTab (client)', () => {
  it('shows a read-only list with no inputs or buttons that edit', async () => {
    renderTab('active', 'client')
    expect(await screen.findByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText('Wireframes approved')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save changes|Delete milestone|Add milestone/ })).not.toBeInTheDocument()
  })

  it('lets a client review a milestone that is in review, and shows the latest review', async () => {
    vi.mocked(listMilestones).mockResolvedValue([{ ...m1, status: 'in_review' }])
    const review: Review = { id: 'r0', milestone_id: 'm1', user_id: 'c1', decision: 'changes_requested', comment: 'Earlier note', created_at: '2026-11-01T00:00:00Z', reviewer_name: 'Dee' }
    vi.mocked(listReviews).mockResolvedValue([review])
    renderTab('active', 'client')
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument()
    expect(await screen.findByText('Changes requested by Dee: “Earlier note”')).toBeInTheDocument()
  })
})
