import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { addTask, deleteTask, updateTask, type Milestone } from '../../../api/milestones'
import { TaskList } from './TaskList'

vi.mock('../../../api/milestones', async (orig) => ({
  ...(await orig<typeof import('../../../api/milestones')>()),
  addTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
}))

const milestone: Milestone = {
  id: 'm1',
  project_id: 'p1',
  position: 1,
  title: 'Build',
  description: null,
  acceptance_criteria: [],
  due_date: null,
  amount: 0,
  status: 'planned',
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [
    { id: 't1', milestone_id: 'm1', position: 1, title: 'Wireframes', status: 'todo' },
    { id: 't2', milestone_id: 'm1', position: 2, title: 'Copy', status: 'done' },
  ],
}

function renderList(canEdit: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <TaskList milestone={milestone} canEdit={canEdit} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(addTask).mockResolvedValue()
  vi.mocked(updateTask).mockResolvedValue()
  vi.mocked(deleteTask).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('TaskList', () => {
  it('adds a task at the end, Add disabled until text is typed', async () => {
    renderList(true)
    const add = screen.getByRole('button', { name: 'Add task' })
    expect(add).toBeDisabled()
    await userEvent.type(screen.getByLabelText('New task'), 'Write copy')
    await userEvent.click(add)
    await waitFor(() => expect(addTask).toHaveBeenCalledWith('m1', 'Write copy', 3))
    expect(await screen.findByText('Task added')).toBeInTheDocument()
  })

  it('changes a task status', async () => {
    renderList(true)
    await userEvent.selectOptions(screen.getByLabelText('Status of Wireframes'), 'doing')
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith('t1', { status: 'doing' }))
  })

  it('deletes a task', async () => {
    renderList(true)
    await userEvent.click(screen.getByRole('button', { name: 'Delete task Copy' }))
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('t2'))
    expect(await screen.findByText('Task deleted')).toBeInTheDocument()
  })

  it('shows a read-only list with status words for clients', () => {
    renderList(false)
    expect(screen.getByText('Wireframes')).toBeInTheDocument()
    expect(screen.getByText('To do')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
