export type RedeemResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid_or_expired' | 'weak_password' | 'rate_limited' | 'error' }

/** Public redeem-setup call. The token travels in the POST body, never in a URL. */
export async function redeemSetup(token: string, password: string): Promise<RedeemResult> {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redeem-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ token, password }),
    })
    const body = (await res.json().catch(() => ({}))) as { email?: string }
    if (res.ok && body.email) return { ok: true, email: body.email }
    if (res.status === 410) return { ok: false, reason: 'invalid_or_expired' }
    if (res.status === 400) return { ok: false, reason: 'weak_password' }
    if (res.status === 429) return { ok: false, reason: 'rate_limited' }
    return { ok: false, reason: 'error' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
