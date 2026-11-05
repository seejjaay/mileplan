import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type ClientRow = { id: string; full_name: string | null; email: string | null; company: string | null; active: boolean }
export type CreateClientInput = { email: string; full_name: string; company?: string; project_id?: string }
export type CreateClientResult = { user_id: string; setup_url: string | null; linked_existing: boolean }

const FRIENDLY: Record<string, string> = {
  invalid_email: 'Enter a valid email address',
  invalid_name: 'Enter the client’s name',
  invalid_project: 'That project could not be found',
  create_failed: 'Could not create that account',
  link_failed: 'Could not add the client to that project',
  is_admin: 'That email belongs to an admin account',
  not_found: 'That client could not be found',
  not_a_client: 'Only client accounts can be changed here',
}

/** Calls an Edge Function and turns its JSON error codes into readable messages (keeping the HTTP status for 403 handling). */
async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: body as Record<string, unknown> })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status
    const code = ((await error.context.json().catch(() => ({}))) as { error?: string }).error
    throw Object.assign(new Error((code && FRIENDLY[code]) || 'Request failed'), { status })
  }
  throw error
}

export async function listClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, company, active')
    .eq('role', 'client')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data as ClientRow[]
}

export function createClient(input: CreateClientInput): Promise<CreateClientResult> {
  return invoke<CreateClientResult>('create-client', input)
}

export async function regenerateLink(userId: string): Promise<string> {
  const { setup_url } = await invoke<{ setup_url: string }>('regenerate-setup-link', { user_id: userId })
  return setup_url
}

export async function setClientActive(userId: string, active: boolean): Promise<void> {
  await invoke('set-client-active', { user_id: userId, active })
}
