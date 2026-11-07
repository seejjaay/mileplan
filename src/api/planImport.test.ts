import { applyPlan, planImportSummary, previewPlan, type PlanImportResult } from './planImport'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

afterEach(() => vi.clearAllMocks())

const empty: PlanImportResult = {
  valid: true,
  applied: false,
  errors: [],
  project: { changes: {} },
  milestones: { added: [], changed: [], removed: [], kept: [], reordered: false },
  payments: { added: [], changed: [], removed: [], kept: [] },
}
const plan = { schema_version: 1 }

describe('previewPlan', () => {
  it('runs import_plan as a dry run with no reason', async () => {
    rpc.mockResolvedValue({ data: empty, error: null })
    expect(await previewPlan('p1', plan)).toEqual(empty)
    expect(rpc).toHaveBeenCalledWith('import_plan', { p_project_id: 'p1', p_plan: plan, p_dry_run: true, p_reason: null })
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'forbidden' }
    rpc.mockResolvedValue({ data: null, error })
    await expect(previewPlan('p1', plan)).rejects.toBe(error)
  })
})

describe('applyPlan', () => {
  it('applies with the reason', async () => {
    rpc.mockResolvedValue({ data: { ...empty, applied: true }, error: null })
    await applyPlan('p1', plan, 'SOW revised')
    expect(rpc).toHaveBeenCalledWith('import_plan', { p_project_id: 'p1', p_plan: plan, p_dry_run: false, p_reason: 'SOW revised' })
  })

  it('sends a null reason when none is given', async () => {
    rpc.mockResolvedValue({ data: { ...empty, applied: true }, error: null })
    await applyPlan('p1', plan)
    expect(rpc.mock.calls[0][1].p_reason).toBeNull()
  })

  it('throws the RPC error (a refused apply)', async () => {
    const error = { code: '22023', message: 'payments.r3 "R3" can\'t be removed' }
    rpc.mockResolvedValue({ data: null, error })
    await expect(applyPlan('p1', plan)).rejects.toBe(error)
  })
})

describe('planImportSummary', () => {
  it('detects a no-op', () => {
    expect(planImportSummary(empty)).toEqual({ added: 0, changed: 0, removed: 0, isNoop: true, message: 'Nothing to change' })
  })

  it('counts milestones and payments together for the toast', () => {
    const r: PlanImportResult = {
      ...empty,
      milestones: {
        added: [{ key: 'm3', title: 'Launch', due_date: '2027-01-10', amount: 500, tasks: [] }],
        changed: [{ key: 'm1', title: 'Discovery', changes: { due_date: ['2026-12-01', '2026-12-02'] }, tasks: { added: [], removed: [], reordered: false } }],
        removed: [{ key: 'm2', title: 'Build' }],
        kept: [{ title: 'Manual' }],
        reordered: false,
      },
      payments: {
        added: [{ key: 'p2', title: 'Final', amount: 900, due_date: '2027-01-10', milestone: 'm3' }],
        changed: [],
        removed: [],
        kept: [],
      },
    }
    expect(planImportSummary(r)).toEqual({ added: 2, changed: 1, removed: 1, isNoop: false, message: 'Plan imported: 2 added, 1 changed, 1 removed' })
  })

  it('counts a project field change and a reorder as changes', () => {
    expect(planImportSummary({ ...empty, project: { changes: { title: ['a', 'b'] } } })).toMatchObject({ changed: 1, isNoop: false })
    expect(planImportSummary({ ...empty, milestones: { ...empty.milestones, reordered: true } })).toMatchObject({ changed: 1, isNoop: false })
  })

  it('kept rows alone are still a no-op', () => {
    const r = { ...empty, milestones: { ...empty.milestones, kept: [{ title: 'Manual' }] } }
    expect(planImportSummary(r).isNoop).toBe(true)
  })
})
