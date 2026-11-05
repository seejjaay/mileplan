import { adminClient, requireAdmin } from '../_shared/admin-guard.ts'
import { handle, json, readJson } from '../_shared/http.ts'
import { issueSetupUrl } from '../_shared/setup-link.ts'

Deno.serve(
  handle(async (req) => {
    await requireAdmin(req)
    const { user_id: userId } = await readJson(req)
    if (typeof userId !== 'string') return json(400, { error: 'invalid_user' })

    const admin = adminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (!profile || profile.role !== 'client') return json(404, { error: 'not_found' })

    // issueSetupUrl marks all earlier unused tokens as used before inserting the new one.
    return json(200, { setup_url: await issueSetupUrl(admin, userId) })
  }),
)
