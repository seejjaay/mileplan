import { render, screen, within } from '@testing-library/react'
import type { PlanImportResult } from '../../../api/planImport'
import { PlanPreview } from './PlanPreview'

const empty: PlanImportResult = {
  valid: true,
  applied: false,
  errors: [],
  project: { changes: {} },
  milestones: { added: [], changed: [], removed: [], kept: [], reordered: false },
  payments: { added: [], changed: [], removed: [], kept: [] },
}

const diff: PlanImportResult = {
  ...empty,
  project: { changes: { title: ['Imported', 'Imported v2'] } },
  milestones: {
    added: [{ key: 'm3', title: 'Launch', due_date: '2027-01-10', amount: 500, tasks: ['Go live'] }],
    changed: [
      {
        key: 'm1',
        title: 'Discovery',
        changes: { due_date: ['2026-12-01', '2026-12-02'] },
        tasks: { added: ['Wireframes'], removed: ['Sitemap'], reordered: false },
      },
    ],
    removed: [{ key: 'm2', title: 'Build' }],
    kept: [{ title: 'Manual milestone' }],
    reordered: true,
  },
  payments: {
    added: [{ key: 'p2', title: 'Final', amount: 900, due_date: '2027-01-10', milestone: 'm3' }],
    changed: [{ key: 'p1', title: 'Deposit', changes: { amount: [500, 600] } }],
    removed: [],
    kept: [{ title: 'Manual request' }],
  },
}

const tree: PlanImportResult = {
  ...empty,
  milestones: {
    ...empty.milestones,
    added: [
      { key: 'm1', title: 'Discovery', due_date: '2026-12-01', amount: 1000, tasks: ['Kickoff', 'Sitemap'] },
      { key: 'm2', title: 'Build', due_date: '2026-12-15', amount: 2000, tasks: [] },
    ],
  },
  payments: { ...empty.payments, added: [{ key: 'p1', title: 'Deposit', amount: 500, due_date: '2026-11-30', milestone: 'm1' }] },
}

describe('PlanPreview', () => {
  it('tree: lists what will be created, with tasks, and no diff sections', () => {
    render(<PlanPreview result={tree} currency="PHP" tree />)
    expect(screen.getByRole('heading', { name: 'Will be created' })).toBeInTheDocument()
    const list = within(screen.getByRole('list', { name: 'Milestones to create' }))
    expect(list.getByText('Discovery')).toBeInTheDocument()
    expect(list.getByText('Kickoff')).toBeInTheDocument()
    expect(list.getByText('Sitemap')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Payments to create' })).getByText(/Deposit/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Changed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Removed' })).not.toBeInTheDocument()
  })

  it('shows amounts in the currency the plan sets', () => {
    render(<PlanPreview result={{ ...tree, project: { changes: { currency: ['PHP', 'USD'] } } }} currency="PHP" tree />)
    expect(screen.getAllByText(/1,000\.00/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/₱/)).not.toBeInTheDocument()
  })

  it('diff: shows Added, Changed and Removed sections', () => {
    render(<PlanPreview result={diff} currency="PHP" tree={false} />)
    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Changed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Removed' })).toBeInTheDocument()
    expect(screen.getByText('Launch')).toBeInTheDocument()
    expect(screen.getByText('Build')).toBeInTheDocument()
  })

  it('diff: renders field changes in plain words, for milestones and payments', () => {
    render(<PlanPreview result={diff} currency="PHP" tree={false} />)
    expect(screen.getByText(/Due date: .*Dec 1, 2026.* → .*Dec 2, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Amount: ₱500\.00 → ₱600\.00/)).toBeInTheDocument()
    expect(screen.getByText('Added task: Wireframes')).toBeInTheDocument()
    expect(screen.getByText('Removed task: Sitemap')).toBeInTheDocument()
  })

  it('diff: shows project field changes', () => {
    render(<PlanPreview result={diff} currency="PHP" tree={false} />)
    expect(screen.getByRole('heading', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByText(/Title: .*Imported.* → .*Imported v2/)).toBeInTheDocument()
  })

  it('lists rows the plan does not name under "Not in the plan, kept as is"', () => {
    render(<PlanPreview result={diff} currency="PHP" tree={false} />)
    const kept = within(screen.getByRole('region', { name: 'Not in the plan, kept as is' }))
    expect(kept.getByText('Manual milestone')).toBeInTheDocument()
    expect(kept.getByText('Manual request')).toBeInTheDocument()
  })

  it('notes when milestones will be reordered', () => {
    render(<PlanPreview result={diff} currency="PHP" tree={false} />)
    expect(screen.getByText('Milestones will be reordered to follow the plan')).toBeInTheDocument()
  })

  it('says "Nothing to change" for an identical plan, still listing kept rows', () => {
    const noop: PlanImportResult = { ...empty, milestones: { ...empty.milestones, kept: [{ title: 'Manual milestone' }] } }
    render(<PlanPreview result={noop} currency="PHP" tree={false} />)
    expect(screen.getByText('Nothing to change')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Changed' })).not.toBeInTheDocument()
    expect(screen.getByText('Manual milestone')).toBeInTheDocument()
  })
})
