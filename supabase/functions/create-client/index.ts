import { adminClient, requireAdmin } from '../_shared/admin-guard.ts'
import { handle, json, readJson } from '../_shared/http.ts'
import { issueSetupUrl } from '../_shared/setup-link.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(
  handle(async (req) => {
    await requireAdmin(req)
    const body = await readJson(req)

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const company = typeof body.company === 'string' ? body.company.trim() : ''
    const projectId = typeof body.project_id === 'string' ? body.project_id : null
    if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' })
    if (!fullName) return json(400, { error: 'invalid_name' })
    if (projectId !== null && !UUID_RE.test(projectId)) return json(400, { error: 'invalid_project' })

    const admin = adminClient()
    const { data: existingId } = await admin.rpc('user_id_by_email', { p_email: email })

    let userId: string
    let setupUrl: string | null = null
    const linkedExisting = typeof existingId === 'string'

    if (linkedExisting) {
      userId = existingId as string
      const { data: profile } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
      if (profile?.role === 'admin') return json(400, { error: 'is_admin' })
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error || !data.user) return json(400, { error: 'create_failed' })
      userId = data.user.id
      if (company) await admin.from('profiles').update({ company }).eq('id', userId)
    }

    if (projectId) {
      const { error } = await admin
        .from('project_members')
        .upsert({ project_id: projectId, user_id: userId }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
      if (error) return json(400, { error: 'link_failed' })
    }

    if (!linkedExisting) setupUrl = await issueSetupUrl(admin, userId)
    return json(200, { user_id: userId, setup_url: setupUrl, linked_existing: linkedExisting })
  }),
)
