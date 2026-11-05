import { adminClient, requireAdmin } from '../_shared/admin-guard.ts'
import { handle, json, readJson } from '../_shared/http.ts'

Deno.serve(
  handle(async (req) => {
    await requireAdmin(req)
    const { user_id: userId, active } = await readJson(req)
    if (typeof userId !== 'string' || typeof active !== 'boolean') return json(400, { error: 'invalid_request' })

    const admin = adminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (!profile) return json(404, { error: 'not_found' })
    if (profile.role !== 'client') return json(400, { error: 'not_a_client' })

    const { error: profileError } = await admin.from('profiles').update({ active }).eq('id', userId)
    if (profileError) return json(500, { error: 'server_error' })

    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' })
    if (banError) return json(500, { error: 'server_error' })
    return json(200, { ok: true })
  }),
)
