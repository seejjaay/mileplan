import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { splitMilestone, type Milestone } from '../../../api/milestones'
import { SplitDialog } from './SplitDialog'

vi.mock('../../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../../api/milestones')>()), splitMilestone: vi.fn() }))

const milestone: Milestone = {
  id: 'm1',
  project_id: 'p1',
  position: 1,
  title: 'Build',
  description: null,
  acceptance_criteria: [],
  due_date: null,
  amount: 1000,
  status: 'planned',
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [
    { id: 't1', milestone_id: 'm1', position: 1, title: 'Wireframes', status: 'todo' },
    { id: 't2', milestone_id: 'm1', position: 2, title: 'Copy', status: 'todo' },
  ],
}

function renderDialog(projectStatus: 'active' | 'setup' = 'active') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <SplitDialog milestone={milestone} projectStatus={projectStatus} currency="PHP" open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(splitMilestone).mockResolvedValue('new-id')
})
afterEach(() => vi.clearAllMocks())

describe('SplitDialog', () => {
  it('disables Split and shows the limit when the amount is above the original', async () => {
    renderDialog()
    await userEvent.type(screen.getByLabelText('Amount for the new milestone'), '1000.01')
    expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
    expect(screen.getByText('Can’t be more than ₱1,000.00')).toBeInTheDocument()
  })

  it('shows what stays on the original milestone', async () => {
    renderDialog()
    await userEvent.type(screen.getByLabelText('Amount for the new milestone'), '400')
    expect(screen.getByText('Stays on “Build”: ₱600.00')).toBeInTheDocument()
  })

  it('sends the chosen task ids, title, amount and reason', async () => {
    renderDialog()
    await userEvent.click(screen.getByLabelText('Copy'))
    await userEvent.clear(screen.getByLabelText('Title of the new milestone'))
    await userEvent.type(screen.getByLabelText('Title of the new milestone'), 'Build part 2')
    await userEvent.type(screen.getByLabelText('Amount for the new milestone'), '400')
    await userEvent.type(screen.getByLabelText('Reason for change (optional)'), 'phasing')
    await userEvent.click(screen.getByRole('button', { name: 'Split' }))
    await waitFor(() => expect(splitMilestone).toHaveBeenCalledWith('m1', ['t2'], 'Build part 2', 400, 'phasing'))
    expect(await screen.findByText('Milestone split')).toBeInTheDocument()
  })

  it('does not ask for a reason while the project is in setup', () => {
    renderDialog('setup')
    expect(screen.queryByLabelText('Reason for change (optional)')).not.toBeInTheDocument()
  })
})
