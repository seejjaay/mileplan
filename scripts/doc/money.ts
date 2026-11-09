import { DocError } from './types.ts'
import type { ClientInput, Payment, Plan, Prices } from './types.ts'

export type Money = {
  total: number
  deposit: Payment
  projectPayments: Payment[]
  sourcePayment: Payment | null
  buyoutPrice: number
  fees: { label: string; amount: number }[]
  finalDeadline: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatPHP(amount: number): string {
  const cents = Math.round(amount * 100)
  const whole = Math.floor(Math.abs(cents) / 100)
  const frac = String(Math.abs(cents) % 100).padStart(2, '0')
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${cents < 0 ? '-' : ''}PHP ${grouped}.${frac}`
}

// A real calendar date in YYYY-MM-DD form. Date.UTC is only used to count the days of a month, so no timezone is involved.
export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m || !isRealDate(iso)) throw new Error(`not a real YYYY-MM-DD date: ${iso}`)
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

const toCents = (n: number) => Math.round(n * 100)
const moreThan2Decimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) > 1e-6

// The rules import_plan() enforces that plan.schema.json cannot express, so documents are never produced
// for a plan MilePlan would refuse to import.
function planRuleErrors(plan: Plan, agreementDate: string | undefined): string[] {
  const errors: string[] = []
  const real = (path: string, v: string | undefined) => {
    if (v === undefined) return true
    if (isRealDate(v)) return true
    errors.push(`${path} "${v}" is not a real calendar date`)
    return false
  }
  const { start_date: start, end_date: end } = plan.project
  const startOk = real('plan.json: project.start_date', start)
  const endOk = real('plan.json: project.end_date', end)
  if (startOk && endOk && start && end && end < start) errors.push('plan.json: project.end_date is before project.start_date')
  real('doc.json: agreement_date', agreementDate)

  const milestoneKeys = new Map<string, number>()
  plan.milestones.forEach((m, i) => {
    const seen = milestoneKeys.get(m.key)
    if (seen !== undefined) errors.push(`plan.json: milestones[${i}].key duplicates milestones[${seen}].key`)
    else milestoneKeys.set(m.key, i)
    const ok = real(`plan.json: milestones[${i}].due_date`, m.due_date)
    const prev = plan.milestones[i - 1]
    if (ok && prev && isRealDate(prev.due_date) && m.due_date < prev.due_date) {
      errors.push(`plan.json: milestones[${i}].due_date is before milestones[${i - 1}].due_date`)
    }
  })

  const paymentKeys = new Map<string, number>()
  let prevProject = -1
  ;(plan.payments ?? []).forEach((p, i) => {
    const seen = paymentKeys.get(p.key)
    if (seen !== undefined) errors.push(`plan.json: payments[${i}].key duplicates payments[${seen}].key`)
    else paymentKeys.set(p.key, i)
    const ok = real(`plan.json: payments[${i}].due_date`, p.due_date)
    if (moreThan2Decimals(p.amount)) errors.push(`plan.json: payments[${i}].amount can have at most 2 decimals`)
    if (p.milestone !== undefined && !milestoneKeys.has(p.milestone)) {
      errors.push(`plan.json: payments[${i}].milestone "${p.milestone}" is not a milestone key in this plan`)
    }
    if (p.key !== 'source-code') {
      const prev = plan.payments![prevProject]
      if (ok && prev && isRealDate(prev.due_date) && p.due_date < prev.due_date) {
        errors.push(`plan.json: payments[${i}].due_date is before payments[${prevProject}].due_date`)
      }
      prevProject = i
    }
  })
  if ((plan.payments ?? []).filter((p) => p.key === 'source-code').length > 1) {
    errors.push('plan.json: payments can have the key "source-code" only once')
  }
  return errors
}
// Integer half-up percentage: round(cents * pct / 100).
const percentOf = (cents: number, pct: number) => Math.floor((cents * pct + 50) / 100)

export function checkMoney(input: ClientInput, prices: Prices): Money {
  const { plan, doc } = input
  const errors: string[] = []
  errors.push(...planRuleErrors(plan, doc.agreement_date))
  const startDate = plan.project.start_date
  if (!startDate) errors.push('plan.json: project.start_date is required for documents')
  if (!plan.project.summary?.trim()) errors.push('plan.json: project.summary is required for documents')
  if (moreThan2Decimals(doc.source_code.multiplier)) {
    errors.push(`doc.json: source_code.multiplier must have at most 2 decimals (is ${doc.source_code.multiplier})`)
  }
  if (plan.project.currency !== undefined && plan.project.currency !== 'PHP') {
    errors.push(`plan.json: project.currency must be PHP for documents (is ${plan.project.currency})`)
  }
  if (!prices.packages.some((p) => p.key === doc.package)) {
    errors.push(`doc.json: package "${doc.package}" is not in prices.json`)
  }

  const all = plan.payments ?? []
  const projectPayments = all.filter((p) => p.key !== 'source-code')
  const sourcePayment = all.find((p) => p.key === 'source-code') ?? null
  const lastMilestone = plan.milestones[plan.milestones.length - 1]
  const mode = doc.payment_plan ?? '50-50'
  const totalCents = projectPayments.reduce((sum, p) => sum + toCents(p.amount), 0)

  if (mode === '50-50') {
    if (projectPayments.length !== 2) {
      errors.push(`plan.json: payments must be exactly 2 project payments in 50-50 mode (found ${projectPayments.length})`)
    } else if (toCents(projectPayments[0].amount) !== toCents(projectPayments[1].amount)) {
      errors.push('plan.json: the 2 payments must be equal in 50-50 mode')
    }
  } else if (projectPayments.length < 2) {
    errors.push('plan.json: payments must have at least 2 project payments in milestones mode')
  }

  const first = projectPayments[0]
  const last = projectPayments[projectPayments.length - 1]
  if (first && startDate && first.due_date > startDate) {
    errors.push(`plan.json: the first payment (${first.key}) must be due on or before project.start_date (${startDate})`)
  }
  if (last && last.milestone !== lastMilestone.key) {
    errors.push(`plan.json: the last payment (${last.key}) must be tied to the last milestone (${lastMilestone.key})`)
  }

  const multCents = toCents(doc.source_code.multiplier)
  const buyoutCents = percentOf(totalCents, multCents)
  if (sourcePayment) {
    if (toCents(sourcePayment.amount) !== buyoutCents) {
      errors.push(
        `plan.json: the source-code payment must be ${formatPHP(buyoutCents / 100)} (total x ${doc.source_code.multiplier}), not ${formatPHP(sourcePayment.amount)}`,
      )
    }
    if (last && sourcePayment.due_date < last.due_date) {
      errors.push(`plan.json: the source-code payment must be due on or after the last project payment (${last.due_date})`)
    }
  }

  const fees: { label: string; amount: number }[] = []
  let feeCents = 0
  doc.fees.forEach((line, i) => {
    if ('label' in line) {
      fees.push({ label: line.label, amount: line.amount })
      feeCents += toCents(line.amount)
    } else if ('addon' in line) {
      const addon = prices.addons.find((a) => a.key === line.addon)
      if (!addon) errors.push(`doc.json: fees addon "${line.addon}" is not in prices.json`)
      else if (addon.price === undefined) errors.push(`doc.json: fees addon "${line.addon}" has no fixed price, so it can't be a fee line`)
      else {
        const cents = toCents(addon.price) * line.qty
        fees.push({ label: line.qty > 1 ? `${addon.name} × ${line.qty}` : addon.name, amount: cents / 100 })
        feeCents += cents
      }
    } else {
      const pct = prices.addons.find((a) => a.key === 'rush')?.percent ?? 30
      if (i !== doc.fees.length - 1 || doc.fees.filter((f) => 'rush' in f).length > 1) {
        errors.push('doc.json: fees rush must appear once, as the last line')
      }
      const cents = percentOf(feeCents, pct)
      fees.push({ label: `Rush delivery (+${pct}%)`, amount: cents / 100 })
      feeCents += cents
    }
  })
  if (feeCents !== totalCents) {
    errors.push(`doc.json: fees total ${formatPHP(feeCents / 100)} but the project payments total ${formatPHP(totalCents / 100)}`)
  }

  if (errors.length) throw new DocError(errors)
  return {
    total: totalCents / 100,
    deposit: first,
    projectPayments,
    sourcePayment,
    buyoutPrice: buyoutCents / 100,
    fees,
    finalDeadline: plan.project.end_date ?? lastMilestone.due_date,
  }
}
