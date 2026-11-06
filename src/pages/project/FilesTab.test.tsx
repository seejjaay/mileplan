import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { listDocuments, uploadDocument, type DocumentRow } from '../../api/documents'
import { signedUrl } from '../../api/storage'
import { openUrl } from '../../lib/openUrl'
import type { ProjectSummary } from '../../api/projects'
import FilesTab from './FilesTab'

vi.mock('../../api/documents', async (orig) => ({
  ...(await orig<typeof import('../../api/documents')>()),
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}))
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
  scheduled: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
}

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  project_id: 'p1',
  kind: 'contract',
  title: 'Service agreement',
  version: 1,
  storage_path: 'p1/11111111-1111-1111-1111-111111111111-contract.pdf',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  signed_at: '2026-11-04',
  status: 'signed',
  uploaded_by: 'admin',
  created_at: '2026-11-04T08:00:00Z',
  ...over,
})

function renderTab(role: 'admin' | 'client' = 'admin') {
  const user = userEvent.setup({ applyAccept: false })
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
          <FilesTab project={project} />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return user
}

beforeEach(() => {
  vi.mocked(listDocuments).mockResolvedValue([doc({})])
  vi.mocked(uploadDocument).mockResolvedValue()
  vi.mocked(signedUrl).mockResolvedValue('https://signed.example/doc')
})
afterEach(() => vi.clearAllMocks())

describe('FilesTab', () => {
  it('shows the exact empty copy only after an empty result', async () => {
    vi.mocked(listDocuments).mockResolvedValue([])
    renderTab()
    expect(screen.queryByText('No documents yet.')).not.toBeInTheDocument()
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
  })

  it('marks superseded documents with the word, and lists them after signed ones', async () => {
    vi.mocked(listDocuments).mockResolvedValue([
      doc({ id: 'd2', title: 'Service agreement v2', version: 2 }),
      doc({ id: 'd1', title: 'Service agreement v1', version: 1, status: 'superseded' }),
    ])
    renderTab()
    expect(await screen.findByText('Superseded')).toBeInTheDocument()
    expect(screen.getByText('Signed')).toBeInTheDocument()
    const titles = within(screen.getByRole('list')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(['Service agreement v2', 'Service agreement v1'])
  })

  it('shows a short hash with the full SHA-256 on hover', async () => {
    renderTab()
    const short = await screen.findByText('ba7816bf8f01…')
    expect(short).toHaveAttribute('title', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('downloads through a fresh signed URL', async () => {
    const user = renderTab()
    await user.click(await screen.findByRole('button', { name: 'Download Service agreement' }))
    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith('documents', 'p1/11111111-1111-1111-1111-111111111111-contract.pdf', 'contract.pdf'))
    expect(openUrl).toHaveBeenCalledWith('https://signed.example/doc')
  })

  it('uploads a document with kind, title, version and signed date, then toasts', async () => {
    const user = renderTab()
    await screen.findByText('Service agreement')
    const file = new File(['%PDF'], 'srs.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Signed document file'), file)
    await user.selectOptions(screen.getByLabelText('Kind'), 'srs')
    await user.type(screen.getByLabelText('Title'), 'Requirements')
    await user.type(screen.getByLabelText('Signed on'), '2026-11-05')
    await user.click(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', uploadedBy: 'u1', file, kind: 'srs', title: 'Requirements', version: 1, signedAt: '2026-11-05' }),
      ),
    )
    expect(await screen.findByText('Document uploaded')).toBeInTheDocument()
  })

  it('blocks a renamed file in the browser: message shown, nothing uploaded', async () => {
    const user = renderTab()
    await screen.findByText('Service agreement')
    await user.upload(screen.getByLabelText('Signed document file'), new File(['<html>'], 'invoice.html', { type: 'application/pdf' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invoice\.html/)
    await user.type(screen.getByLabelText('Title'), 'Invoice')
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeDisabled()
    expect(uploadDocument).not.toHaveBeenCalled()
  })

  it('defaults the version to previous + 1 and supersedes the chosen document', async () => {
    const user = renderTab()
    await screen.findByText('Service agreement')
    await user.selectOptions(screen.getByLabelText('Replaces (optional)'), 'd1')
    expect(screen.getByLabelText('Version')).toHaveValue(2)
    expect(screen.getByLabelText('Kind')).toHaveValue('contract')
    const file = new File(['%PDF'], 'contract-v2.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Signed document file'), file)
    await user.type(screen.getByLabelText('Title'), 'Service agreement v2')
    await user.click(screen.getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ version: 2, supersedes: 'd1', kind: 'contract' })))
  })

  it('shows clients the list and downloads, with no upload form', async () => {
    renderTab('client')
    expect(await screen.findByText('Service agreement')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Service agreement' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Signed document file')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument()
  })
})
