import { adminClient } from '../_shared/admin-guard.ts'
import { handle, json, readJson } from '../_shared/http.ts'
import { hashToken } from '../_shared/token.ts'

const MIN_PASSWORD = 8

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
}

Deno.serve(
  handle(async (req) => {
    const admin = adminClient()

    const { data: allowed } = await admin.rpc('check_redeem_rate', { p_ip: clientIp(req) })
    if (allowed === false) return json(429, { error: 'rate_limited' })

    const { token, password } = await readJson(req)
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return json(400, { error: 'weak_password' })
    if (typeof token !== 'string' || !token) return json(410, { error: 'invalid_or_expired' })

    // Atomic consume: a single UPDATE, so exactly one concurrent caller gets the row.
    const nowIso = new Date().toISOString()
    const { data: consumed } = await admin
      .from('setup_tokens')
      .update({ used_at: nowIso })
      .eq('token_hash', await hashToken(token))
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .select('id, user_id')
    if (!consumed?.length) return json(410, { error: 'invalid_or_expired' })
    const { id: tokenId, user_id: userId } = consumed[0]

    const { data: profile } = await admin.from('profiles').select('active').eq('id', userId).maybeSingle()
    if (!profile?.active) return json(410, { error: 'invalid_or_expired' })

    const { data, error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error || !data.user?.email) {
      await admin.from('setup_tokens').update({ used_at: null }).eq('id', tokenId) // don't burn the link on our failure
      return json(500, { error: 'server_error' })
    }
    return json(200, { email: data.user.email })
  }),
)
