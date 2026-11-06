import { supabase } from '../lib/supabase'
import type { PaymentStatus } from '../lib/paymentState'
import { removeObjects, uploadTo } from './storage'

export type Payment = {
  id: string
  request_id: string
  amount: number
  method: string | null
  reference: string | null
  paid_on: string | null
  proof_path: string | null
  status: PaymentStatus
  submitted_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  submitter_name: string | null
}

export type PaymentRequest = {
  id: string
  project_id: string
  milestone_id: string | null
  title: string
  amount: number
  due_date: string
  created_at: string
  payments: Payment[]
}

/** The schedule by due date, each request with its payments, newest first. */
export async function listPaymentRequests(projectId: string): Promise<PaymentRequest[]> {
  const { data, error } = await supabase
    .from('payment_requests')
    .select('*, payments(*, submitter_name)')
    .eq('project_id', projectId)
    .order('due_date')
    .order('created_at', { referencedTable: 'payments', ascending: false })
  if (error) throw error
  return data as unknown as PaymentRequest[]
}

export type NewPaymentRequest = { projectId: string; title: string; amount: number; dueDate: string; milestoneId?: string | null }
export type PaymentRequestPatch = Partial<{ title: string; amount: number; due_date: string; milestone_id: string | null }>

export async function addPaymentRequest(input: NewPaymentRequest, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_payment_request', {
    p_project_id: input.projectId,
    p_title: input.title,
    p_amount: input.amount,
    p_due_date: input.dueDate,
    p_milestone_id: input.milestoneId ?? null,
    p_reason: reason ?? null,
  })
  if (error) throw error
  return data as string
}

export async function updatePaymentRequest(id: string, patch: PaymentRequestPatch, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('update_payment_request', { p_id: id, p_patch: patch, p_reason: reason ?? null })
  if (error) throw error
}

export async function deletePaymentRequest(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('delete_payment_request', { p_id: id, p_reason: reason ?? null })
  if (error) throw error
}

/** Only a pending payment can be reviewed (22023 otherwise), and a rejection needs a note. */
export async function reviewPayment(id: string, decision: 'confirmed' | 'rejected', note?: string): Promise<void> {
  const { error } = await supabase.rpc('review_payment', { p_id: id, p_decision: decision, p_note: note ?? null })
  if (error) throw error
}

export type RecordPaymentInput = {
  requestId: string
  amount: number
  paidOn: string
  method?: string
  reference?: string
  proofPath?: string
}

export async function recordPayment(input: RecordPaymentInput): Promise<string> {
  const { data, error } = await supabase.rpc('record_payment', {
    p_request_id: input.requestId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_method: input.method ?? null,
    p_reference: input.reference ?? null,
    p_proof_path: input.proofPath ?? null,
  })
  if (error) throw error
  return data as string
}

export type SubmitProofInput = {
  projectId: string
  requestId: string
  userId: string
  amount: number
  paidOn: string
  method?: string
  reference?: string
  file: File
}

/** Uploads the proof, then inserts the pending payment. If the insert fails the file is removed (no orphans). */
export async function submitProof({ projectId, requestId, userId, amount, paidOn, method, reference, file }: SubmitProofInput): Promise<void> {
  const uploaded = await uploadTo('payment-proofs', projectId, file)
  try {
    const { error } = await supabase.from('payments').insert({
      project_id: projectId,
      request_id: requestId,
      amount,
      paid_on: paidOn,
      method: method?.trim() || null,
      reference: reference?.trim() || null,
      proof_path: uploaded.path,
      status: 'pending',
      submitted_by: userId,
    })
    if (error) throw error
  } catch (err) {
    await removeObjects('payment-proofs', [uploaded.path])
    throw err
  }
}
