import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { generateToken, hashToken } from './token.ts'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** Revokes the user's unused tokens, stores a fresh hash, and returns the one-time URL (token in the fragment). */
export async function issueSetupUrl(admin: SupabaseClient, userId: string): Promise<string> {
  await admin.from('setup_tokens').update({ used_at: new Date().toISOString() }).eq('user_id', userId).is('used_at', null)
  const raw = generateToken()
  const { error } = await admin.from('setup_tokens').insert({
    user_id: userId,
    token_hash: await hashToken(raw),
    expires_at: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
  })
  if (error) throw error
  return `${Deno.env.get('SITE_URL')}/setup#token=${raw}`
}
