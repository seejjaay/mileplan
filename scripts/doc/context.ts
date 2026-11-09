import { checkMoney, formatDate, formatPHP } from './money.ts'
import type { ClientInput, Developer, Prices, ProseName } from './types.ts'

// Data values go into Markdown, so characters that mean something to it are backslash-escaped.
// Prose files are Markdown on purpose and are not escaped.
export function mdEscape(s: string): string {
  const escaped = s.replace(/[\\*_[\]<>|#`~]/g, '\\$&')
  return escaped.replace(/^(\s*)([-+]|\d+[.)])(\s)/, (_m, lead: string, mark: string, space: string) => {
    const m = /^(\d+)([.)])$/.exec(mark)
    return m ? `${lead}${m[1]}\\${m[2]}${space}` : `${lead}\\${mark}${space}`
  })
}

export function parseRequirements(md: string): string[] {
  const items: string[] = []
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim()) continue
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) items.push(bullet[1].trim())
    else if (/^\s/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`
    else items.push(line.trim())
  }
  return items
}

export type RenderContext = {
  developer: Developer
  client: { name: string; address: string; email: string; representative: string; representativeTitle: string }
  project: { title: string; summary: string }
  academic: boolean
  school: string
  course: string
  package: { name: string; inclusions: string[] }
  fees: { label: string; amount: string }[]
  total: string
  deposit: string
  payments: { title: string; amount: string; due: string }[]
  source: { price: string; purchased: boolean; multiplier: string; due: string }
  startDate: string
  finalDeadline: string
  milestones: { title: string; due: string; description: string; criteria: string[]; tasks: string[] }[]
  terms: {
    revisionRounds: number
    warrantyDays: number
    acceptanceDays: number
    extraRound: string
    bugFix: string
    maintenance: string
  }
  paymentMethod: string
  disputeCity: string
  agreementDate: string
  requirements: string[]
  contractNo: { academic: number; esign: number; signatures: number }
  prose: Record<ProseName, string>
}

export function buildContext(input: ClientInput, prices: Prices, developer: Developer): RenderContext {
  const money = checkMoney(input, prices)
  const { plan, doc } = input
  const pkg = prices.packages.find((p) => p.key === doc.package)!
  const addon = (key: string) => prices.addons.find((a) => a.key === key)
  const e = mdEscape
  const academic = doc.academic ?? false
  const sp = money.sourcePayment
  return {
    developer: {
      name: e(developer.name),
      title: e(developer.title),
      email: e(developer.email),
      phone: e(developer.phone),
      portfolio: e(developer.portfolio),
    },
    client: {
      name: e(doc.client.name),
      address: e(doc.client.address),
      email: e(doc.client.email),
      representative: e(doc.client.representative ?? ''),
      representativeTitle: e(doc.client.representative_title ?? ''),
    },
    project: { title: e(plan.project.title), summary: e(plan.project.summary ?? '') },
    academic,
    school: e(doc.school ?? ''),
    course: e(doc.course ?? ''),
    package: { name: e(pkg.name), inclusions: pkg.inclusions.map(e) },
    fees: money.fees.map((f) => ({ label: e(f.label), amount: formatPHP(f.amount) })),
    total: formatPHP(money.total),
    deposit: formatPHP(money.deposit.amount),
    payments: money.projectPayments.map((p) => ({ title: e(p.title), amount: formatPHP(p.amount), due: formatDate(p.due_date) })),
    source: {
      price: formatPHP(money.buyoutPrice),
      purchased: sp !== null,
      multiplier: String(doc.source_code.multiplier),
      due: sp ? formatDate(sp.due_date) : '',
    },
    startDate: formatDate(plan.project.start_date!),
    finalDeadline: formatDate(money.finalDeadline),
    milestones: plan.milestones.map((m) => ({
      title: e(m.title),
      due: formatDate(m.due_date),
      description: e(m.description ?? ''),
      criteria: (m.acceptance_criteria ?? []).map(e),
      tasks: (m.tasks ?? []).map(e),
    })),
    terms: {
      revisionRounds: doc.revision_rounds ?? 2,
      warrantyDays: doc.warranty_days ?? 30,
      acceptanceDays: doc.acceptance_days ?? 7,
      extraRound: formatPHP(addon('extra-revision')!.price!),
      bugFix: formatPHP(addon('bug-fix')!.from!),
      maintenance: formatPHP(addon('maintenance')!.from!),
    },
    paymentMethod: e(doc.payment_method),
    disputeCity: e(doc.dispute_city),
    agreementDate: doc.agreement_date ? formatDate(doc.agreement_date) : '',
    requirements: parseRequirements(input.prose.requirements),
    contractNo: { academic: 17, esign: academic ? 18 : 17, signatures: academic ? 19 : 18 },
    prose: input.prose,
  }
}
