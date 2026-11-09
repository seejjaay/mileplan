// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { loadClient, loadPrices } from '../../../scripts/doc/load.ts'
import { checkMoney, formatDate, formatPHP } from '../../../scripts/doc/money.ts'
import { DocError } from '../../../scripts/doc/types.ts'
import type { ClientInput, DocJson, Payment, Plan } from '../../../scripts/doc/types.ts'

const prices = loadPrices()

function make(opts: { payments?: Payment[]; doc?: Partial<DocJson>; project?: Partial<Plan['project']> } = {}): ClientInput {
  const c = structuredClone(loadClient('scripts/doc/fixtures/acme'))
  if (opts.payments) c.plan.payments = opts.payments
  if (opts.doc) Object.assign(c.doc, opts.doc)
  if (opts.project) Object.assign(c.plan.project, opts.project)
  return c
}

function errorsOf(c: ClientInput): string[] {
  try {
    checkMoney(c, prices)
  } catch (e) {
    if (e instanceof DocError) return e.errors
    throw e
  }
  return []
}

const pay = (key: string, amount: number, due_date: string, milestone?: string): Payment => ({
  key,
  title: key,
  amount,
  due_date,
  ...(milestone ? { milestone } : {}),
})

describe('checkMoney', () => {
  it('fixture passes', () => {
    const m = checkMoney(make(), prices)
    expect(m.total).toBe(70000)
    expect(m.deposit.key).toBe('deposit')
    expect(m.buyoutPrice).toBe(105000)
    expect(m.finalDeadline).toBe('2027-02-26')
    expect(m.sourcePayment).toBeNull()
  })

  it('50-50 rejects unequal', () => {
    const c = make({ payments: [pay('deposit', 30000, '2026-11-16'), pay('final', 40000, '2027-02-26', 'launch')] })
    expect(errorsOf(c).some((e) => e.includes('equal'))).toBe(true)
  })

  it('50-50 rejects three project payments', () => {
    const c = make({
      payments: [
        pay('deposit', 20000, '2026-11-16'),
        pay('mid', 30000, '2027-01-29', 'build'),
        pay('final', 20000, '2027-02-26', 'launch'),
      ],
    })
    expect(errorsOf(c).some((e) => e.includes('exactly 2'))).toBe(true)
  })

  it('deposit due after start', () => {
    const c = make({ payments: [pay('deposit', 35000, '2026-11-17'), pay('final', 35000, '2027-02-26', 'launch')] })
    expect(errorsOf(c).some((e) => e.includes('start_date'))).toBe(true)
  })

  it('last payment must be tied to last milestone', () => {
    const c = make({ payments: [pay('deposit', 35000, '2026-11-16'), pay('final', 35000, '2027-02-26', 'build')] })
    expect(errorsOf(c).some((e) => e.includes('last milestone'))).toBe(true)
  })

  it('milestones mode allows 30/40/30', () => {
    const c = make({
      doc: { payment_plan: 'milestones' },
      payments: [
        pay('deposit', 21000, '2026-11-16'),
        pay('after-build', 28000, '2027-01-29', 'build'),
        pay('final', 21000, '2027-02-26', 'launch'),
      ],
    })
    expect(errorsOf(c)).toEqual([])
  })

  it('source-code payment amount must equal total x multiplier', () => {
    const c = make({
      payments: [
        pay('deposit', 35000, '2026-11-16'),
        pay('final', 35000, '2027-02-26', 'launch'),
        pay('source-code', 100000, '2027-03-05'),
      ],
    })
    expect(errorsOf(c).some((e) => e.includes('PHP 105,000.00'))).toBe(true)
  })

  it('a correct source-code payment is exposed and kept out of the total', () => {
    const c = make({
      payments: [
        pay('deposit', 35000, '2026-11-16'),
        pay('final', 35000, '2027-02-26', 'launch'),
        pay('source-code', 105000, '2027-03-05'),
      ],
    })
    const m = checkMoney(c, prices)
    expect(m.total).toBe(70000)
    expect(m.sourcePayment?.amount).toBe(105000)
    expect(m.projectPayments.map((p) => p.key)).toEqual(['deposit', 'final'])
  })

  it('source-code payment due before the final payment is rejected', () => {
    const c = make({
      payments: [
        pay('deposit', 35000, '2026-11-16'),
        pay('final', 35000, '2027-02-26', 'launch'),
        pay('source-code', 105000, '2027-02-01'),
      ],
    })
    expect(errorsOf(c).some((e) => e.includes('source-code') && e.includes('after'))).toBe(true)
  })

  it('non-PHP currency rejected', () => {
    expect(errorsOf(make({ project: { currency: 'USD' } })).some((e) => e.includes('PHP'))).toBe(true)
  })

  it('missing start_date rejected', () => {
    const c = make()
    delete c.plan.project.start_date
    expect(errorsOf(c)).toContain('plan.json: project.start_date is required for documents')
  })

  it('unknown package rejected', () => {
    expect(errorsOf(make({ doc: { package: 'nope' } })).some((e) => e.includes('package'))).toBe(true)
  })
})

describe('fee breakdown', () => {
  it('addon lines are priced from prices.json', () => {
    const m = checkMoney(make(), prices)
    expect(m.fees.find((f) => f.label.startsWith('Extra page'))?.amount).toBe(2000)
  })

  it('rush is 30% of the lines above', () => {
    const c = make({
      payments: [pay('deposit', 6500, '2026-11-16'), pay('final', 6500, '2027-02-26', 'launch')],
      doc: { fees: [{ label: 'X', amount: 10000 }, { rush: true }] },
    })
    const m = checkMoney(c, prices)
    expect(m.fees[1]).toEqual({ label: 'Rush delivery (+30%)', amount: 3000 })
    expect(m.total).toBe(13000)
  })

  it('rush not last is rejected', () => {
    const c = make({ doc: { fees: [{ rush: true }, { label: 'X', amount: 10000 }] } })
    expect(errorsOf(c).some((e) => e.includes('rush'))).toBe(true)
  })

  it('rush twice is rejected', () => {
    const c = make({ doc: { fees: [{ label: 'X', amount: 10000 }, { rush: true }, { rush: true }] } })
    expect(errorsOf(c).some((e) => e.includes('rush'))).toBe(true)
  })

  it('non-fixed addon is rejected', () => {
    const c = make({ doc: { fees: [{ label: 'X', amount: 69000 }, { addon: 'maintenance', qty: 1 }] } })
    expect(errorsOf(c).some((e) => e.includes('maintenance'))).toBe(true)
  })

  it('unknown addon is rejected', () => {
    const c = make({ doc: { fees: [{ label: 'X', amount: 69000 }, { addon: 'nope', qty: 1 }] } })
    expect(errorsOf(c).some((e) => e.includes('nope'))).toBe(true)
  })

  it('fees must equal the total, showing both amounts', () => {
    const c = make({ doc: { fees: [{ label: 'X', amount: 60000 }] } })
    const e = errorsOf(c).find((x) => x.includes('fees'))
    expect(e).toContain('PHP 60,000.00')
    expect(e).toContain('PHP 70,000.00')
  })
})

describe('exact cents', () => {
  it('sums 10000.10 + 10000.20 without float drift', () => {
    const c = make({
      doc: { payment_plan: 'milestones', fees: [{ label: 'X', amount: 20000.3 }] },
      payments: [pay('deposit', 10000.1, '2026-11-16'), pay('final', 10000.2, '2027-02-26', 'launch')],
    })
    expect(formatPHP(checkMoney(c, prices).total)).toBe('PHP 20,000.30')
  })

  it('buyout rounds half up', () => {
    const c = make({
      doc: { payment_plan: 'milestones', fees: [{ label: 'X', amount: 33333.33 }] },
      payments: [pay('deposit', 16666.66, '2026-11-16'), pay('final', 16666.67, '2027-02-26', 'launch')],
    })
    expect(checkMoney(c, prices).buyoutPrice).toBe(50000)
  })
})

describe('formatting', () => {
  it('formatPHP', () => {
    expect(formatPHP(0)).toBe('PHP 0.00')
    expect(formatPHP(1234567.5)).toBe('PHP 1,234,567.50')
    expect(formatPHP(21000)).toBe('PHP 21,000.00')
  })

  it('formatDate ignores timezone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(formatDate('2026-11-16')).toBe('16 November 2026')
    vi.stubEnv('TZ', 'Pacific/Kiritimati')
    expect(formatDate('2026-11-16')).toBe('16 November 2026')
    vi.unstubAllEnvs()
  })
})
