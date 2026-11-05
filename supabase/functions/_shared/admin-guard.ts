import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { json } from './http.ts'

/** Service-role client. The service key exists only in Edge Function env, never in the browser. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Throws a 403 Response unless the caller's JWT belongs to an active admin profile. */
export async function requireAdmin(req: Request): Promise<{ userId: string }> {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) throw json(403, { error: 'forbidden' })
  const admin = adminClient()
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) throw json(403, { error: 'forbidden' })
  const { data: profile } = await admin.from('profiles').select('role, active').eq('id', data.user.id).maybeSingle()
  if (profile?.role !== 'admin' || !profile.active) throw json(403, { error: 'forbidden' })
  return { userId: data.user.id }
}
