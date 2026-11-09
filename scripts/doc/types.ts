export type Milestone = {
  key: string
  title: string
  description?: string
  acceptance_criteria?: string[]
  due_date: string
  amount?: number
  tasks?: string[]
}

export type Payment = {
  key: string
  title: string
  amount: number
  due_date: string
  milestone?: string
}

export type Plan = {
  schema_version: 1
  project: { title: string; summary?: string; currency?: string; start_date?: string; end_date?: string }
  milestones: Milestone[]
  payments?: Payment[]
}

export type FeeLine = { label: string; amount: number } | { addon: string; qty: number } | { rush: true }

export type DocJson = {
  client: { name: string; address: string; email: string; representative?: string; representative_title?: string }
  academic?: boolean
  school?: string
  course?: string
  payment_method: string
  payment_plan?: '50-50' | 'milestones'
  package: string
  fees: FeeLine[]
  source_code: { multiplier: number }
  dispute_city: string
  agreement_date?: string
  revision_rounds?: number
  warranty_days?: number
  acceptance_days?: number
}

export type Prices = {
  packages: { key: string; name: string; from: number; inclusions: string[] }[]
  addons: { key: string; name: string; price?: number; from?: number; per?: string; percent?: number }[]
  source_code_multiplier: { min: number; max: number }
}

export type Developer = { name: string; title: string; email: string; phone: string; portfolio: string }

export const PROSE_NAMES = [
  'scope',
  'requirements',
  'users',
  'nfr',
  'constraints',
  'assumptions',
  'out-of-scope',
  'glossary',
] as const
export type ProseName = (typeof PROSE_NAMES)[number]

export type ClientInput = {
  slug: string
  dir: string
  plan: Plan
  doc: DocJson
  prose: Record<ProseName, string>
}

export class DocError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(errors.join('\n'))
    this.name = 'DocError'
    this.errors = errors
  }
}
