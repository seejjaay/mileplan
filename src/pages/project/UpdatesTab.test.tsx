import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { listUpdates, postUpdate, type UpdateRow } from '../../api/updates'
import { listMilestones, type Milestone } from '../../api/milestones'
import { signedUrl } from '../../api/storage'
import { openUrl } from '../../lib/openUrl'
import type { ProjectSummary } from '../../api/projects'
import UpdatesTab from './UpdatesTab'

vi.mock('../../api/updates', () => ({ listUpdates: vi.fn(), postUpdate: vi.fn() }))
vi.mock('../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../api/milestones')>()), listMilestones: vi.fn() }))
vi.mock('../../api/storage', async (orig) => ({ ...(await orig<typeof import('../../api/storage')>()), signedUrl: vi.fn() }))
vi.mock('../../lib/openUrl', () => ({ openUrl: vi.fn() }))

const project: ProjectSummary = {
  id: 'p1',
  title: 'Website rebuild',
  summary: null,
  status: 'active',
  currency: 'PHP',
  start_date: null,
  end_date: null,
  activated_at: null,
  closed_at: null,
  created_at: '2026-11-01T00:00:00Z',
  percent: 0,
  nextDue: null,
}

const update: UpdateRow = {
  id: 'u-1',
  project_id: 'p1',
  milestone_id: 'm1',
  author_id: 'admin',
  body: 'Wireframes are **done**',
  attachments: [{ path: 'p1/abc-wire.png', name: 'wire.png', size: 2048, mime: 'image/png' }],
  created_at: '2026-11-05T08:00:00Z',
  author: { full_name: 'CJ' },
  milestone: { title: 'Discovery' },
}

const milestone = { id: 'm1', title: 'Discovery' } as Milestone

function renderTab(role: 'admin' | 'client' = 'admin') {
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
          <UpdatesTab project={project} />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(listUpdates).mockResolvedValue([update])
  vi.mocked(listMilestones).mockResolvedValue([milestone])
  vi.mocked(postUpdate).mockResolvedValue()
  vi.mocked(signedUrl).mockResolvedValue('https://signed.example/file')
})
afterEach(() => vi.clearAllMocks())

describe('UpdatesTab', () => {
  it('shows the exact empty copy only after an empty result', async () => {
    vi.mocked(listUpdates).mockResolvedValue([])
    renderTab()
    expect(screen.queryByText('No updates yet.')).not.toBeInTheDocument()
    expect(await screen.findByText('No updates yet.')).toBeInTheDocument()
  })

  it('keeps Post disabled until a body is entered', async () => {
    renderTab()
    const post = await screen.findByRole('button', { name: 'Post update' })
    expect(post).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Write an update (Markdown)'), '   ')
    expect(post).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Write an update (Markdown)'), 'Hello')
    expect(post).toBeEnabled()
  })

  it('posts the body, milestone and files, then clears the form and toasts', async () => {
    renderTab()
    await userEvent.type(await screen.findByLabelText('Write an update (Markdown)'), 'Hello')
    await userEvent.selectOptions(screen.getByLabelText('Linked milestone (optional)'), 'm1')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Attachments'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Post update' }))
    await waitFor(() =>
      expect(postUpdate).toHaveBeenCalledWith({ projectId: 'p1', authorId: 'u1', body: 'Hello', milestoneId: 'm1', files: [file] }),
    )
    expect(await screen.findByText('Update posted')).toBeInTheDocument()
    expect(screen.getByLabelText('Write an update (Markdown)')).toHaveValue('')
  })

  it('keeps what was typed and toasts the reason when posting fails', async () => {
    vi.mocked(postUpdate).mockRejectedValue(new Error('File is too big'))
    renderTab()
    await userEvent.type(await screen.findByLabelText('Write an update (Markdown)'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Post update' }))
    expect(await screen.findByText('File is too big')).toBeInTheDocument()
    expect(screen.getByLabelText('Write an update (Markdown)')).toHaveValue('Hello')
  })

  it('lists updates with author, linked milestone, rendered Markdown and attachments', async () => {
    renderTab()
    expect(await screen.findByText('done')).toBeInTheDocument()
    expect(screen.getByText(/CJ/)).toBeInTheDocument()
    expect(screen.getByText('Re: Discovery')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wire\.png/ })).toBeInTheDocument()
  })

  it('opens a fresh signed URL when an attachment is clicked', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /wire\.png/ }))
    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith('attachments', 'p1/abc-wire.png', 'wire.png'))
    expect(openUrl).toHaveBeenCalledWith('https://signed.example/file')
  })

  it('shows clients the list with no composer', async () => {
    renderTab('client')
    expect(await screen.findByText('done')).toBeInTheDocument()
    expect(screen.queryByLabelText('Write an update (Markdown)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post update' })).not.toBeInTheDocument()
  })
})
