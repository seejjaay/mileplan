import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { applyPlan, previewPlan, type PlanImportResult } from '../../../api/planImport'
import { qk } from '../../../api/keys'
import { ImportPlanDialog } from './ImportPlanDialog'

vi.mock('../../../api/planImport', async (orig) => ({
  ...(await orig<typeof import('../../../api/planImport')>()),
  previewPlan: vi.fn(),
  applyPlan: vi.fn(),
}))

const empty: PlanImportResult = {
  valid: true,
  applied: false,
  errors: [],
  project: { changes: {} },
  milestones: { added: [], changed: [], removed: [], kept: [], reordered: false },
  payments: { added: [], changed: [], removed: [], kept: [] },
  fingerprint: 'fp1',
}
const withOneAdded: PlanImportResult = {
  ...empty,
  milestones: { ...empty.milestones, added: [{ key: 'm1', title: 'Discovery', due_date: '2026-12-01', amount: 1000, tasks: [] }] },
}
const planText = '{"schema_version":1,"project":{"title":"x"},"milestones":[]}'
const refusal = { code: '22023', message: 'payments.r3 "R3" is in use: it has pending or confirmed payments' }

let queryClient: QueryClient
const onClose = vi.fn()

function renderDialog(projectStatus: 'active' | 'setup' = 'active') {
  queryClient = new QueryClient()
  vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ImportPlanDialog projectId="p1" projectStatus={projectStatus} currency="PHP" emptyProject={false} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function choose(text = planText) {
  await userEvent.upload(screen.getByLabelText('Choose plan.json'), new File([text], 'plan.json', { type: 'application/json' }))
}

beforeEach(() => {
  vi.mocked(previewPlan).mockResolvedValue(withOneAdded)
  vi.mocked(applyPlan).mockResolvedValue({ ...withOneAdded, applied: true })
})
afterEach(() => vi.clearAllMocks())

describe('ImportPlanDialog', () => {
  it('shows a parse error with line and column and does not call the server', async () => {
    renderDialog()
    await choose('{x')
    expect(await screen.findByText("plan.json isn't valid JSON (line 1, column 2)")).toBeInTheDocument()
    expect(previewPlan).not.toHaveBeenCalled()
  })

  it('lists server errors with their JSON paths and offers nothing to apply', async () => {
    vi.mocked(previewPlan).mockResolvedValue({
      ...empty,
      valid: false,
      errors: [{ path: 'milestones[2].due_date', message: 'is before milestones[1].due_date' }],
    })
    renderDialog()
    await choose()
    expect(await screen.findByText('Fix these in plan.json and choose it again')).toBeInTheDocument()
    expect(screen.getByText('milestones[2].due_date')).toBeInTheDocument()
    expect(screen.getByText('is before milestones[1].due_date')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()
  })

  it('asks for a reason on an active project only', async () => {
    renderDialog('active')
    await choose()
    expect(await screen.findByLabelText('Reason for change (optional)')).toBeInTheDocument()
  })

  it('does not ask for a reason on a setup project', async () => {
    renderDialog('setup')
    await choose()
    await screen.findByRole('button', { name: 'Apply changes' })
    expect(screen.queryByLabelText('Reason for change (optional)')).not.toBeInTheDocument()
  })

  it('disables Apply changes when there is nothing to change', async () => {
    vi.mocked(previewPlan).mockResolvedValue(empty)
    renderDialog()
    await choose()
    expect(await screen.findByText('Nothing to change')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
  })

  it('applies with the reason, then toasts, refreshes the project and closes', async () => {
    renderDialog()
    await choose()
    await userEvent.type(await screen.findByLabelText('Reason for change (optional)'), 'SOW revised')
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyPlan).toHaveBeenCalledWith('p1', JSON.parse(planText), 'fp1', 'SOW revised'))
    expect(await screen.findByText('Plan imported: 1 added, 0 changed, 0 removed')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
    const keys = vi.mocked(queryClient.invalidateQueries).mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(qk.milestones('p1')))
    expect(keys).toContain(JSON.stringify(qk.payments('p1')))
    expect(keys).toContain(JSON.stringify(qk.planChanges('p1')))
  })

  it('sends no reason on a setup project', async () => {
    renderDialog('setup')
    await choose()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(applyPlan).toHaveBeenCalledWith('p1', JSON.parse(planText), 'fp1', undefined))
  })

  it('keeps the dialog open on a refused apply, shows why, and re-checks on "Check again"', async () => {
    vi.mocked(applyPlan).mockRejectedValue(refusal)
    renderDialog()
    await choose()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal.message)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled() // its fingerprint is stale now
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(previewPlan).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('applies once on a double click', async () => {
    let finish: (r: PlanImportResult) => void = () => {}
    vi.mocked(applyPlan).mockReturnValue(new Promise<PlanImportResult>((resolve) => (finish = resolve)))
    renderDialog()
    await choose()
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Apply changes' }))
    expect(applyPlan).toHaveBeenCalledTimes(1)
    finish({ ...withOneAdded, applied: true })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows and applies only the latest file when previews come back out of order', async () => {
    let finishA: (r: PlanImportResult) => void = () => {}
    vi.mocked(previewPlan)
      .mockReturnValueOnce(new Promise<PlanImportResult>((resolve) => (finishA = resolve)))
      .mockResolvedValueOnce({ ...withOneAdded, fingerprint: 'fp-b' })
    renderDialog()
    await choose('{"schema_version":1,"from":"a"}')
    await choose(planText)
    const apply = await screen.findByRole('button', { name: 'Apply changes' })
    finishA({ ...empty, fingerprint: 'fp-a' }) // the older file's answer arrives last: a no-op diff
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Nothing to change')).not.toBeInTheDocument()
    expect(apply).toBeEnabled()
    await userEvent.click(apply)
    await waitFor(() => expect(applyPlan).toHaveBeenCalledWith('p1', JSON.parse(planText), 'fp-b', undefined))
  })

  it('lets the same file be chosen again after fixing it', async () => {
    vi.mocked(previewPlan).mockResolvedValueOnce({ ...empty, valid: false, errors: [{ path: 'project.title', message: 'is required' }] })
    renderDialog()
    await choose()
    await screen.findByText('project.title')
    await choose()
    expect(await screen.findByRole('button', { name: 'Apply changes' })).toBeEnabled()
    expect(previewPlan).toHaveBeenCalledTimes(2)
  })
})
