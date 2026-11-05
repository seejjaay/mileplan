import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Reads .env.test.local (git-ignored), produced by: npx supabase status -o env > .env.test.local
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync('.env.test.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const env = loadEnv()
export const API_URL = env.API_URL
export const FUNCTIONS_URL = env.FUNCTIONS_URL ?? `${env.API_URL}/functions/v1`
export const SEED_PASSWORD = 'mileplan-dev-pw'

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

export async function signIn(email: string, password = SEED_PASSWORD): Promise<SupabaseClient> {
  const client = createClient(API_URL, env.ANON_KEY, noSession)
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`)
  return client
}

export function anonClient(): SupabaseClient {
  return createClient(API_URL, env.ANON_KEY, noSession)
}

export function adminServiceClient(): SupabaseClient {
  return createClient(API_URL, env.SERVICE_ROLE_KEY, noSession)
}
