import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectNoHorizontalScroll, expectToast, signInAs } from './helpers'

const TITLE = 'Import E2E'
const EVE = 'eve.import@client-e.test'
const EVE_PW = 'eve-import-e2e-pw-1'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const

const service = adminServiceClient()
const example = JSON.parse(readFileSync('schemas/plan.example.json', 'utf8'))

/** A plan file as the browser's file input takes it. */
const planFile = (plan: unknown) => ({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) })

/** The example, revised: the build milestone slips a week and gains a task, and the final payment is dropped. */
function variant() {
  const plan = structuredClone(example)
  const build = plan.milestones.find((m: { key: string }) => m.key === 'build')
  build.due_date = '2027-02-05'
  build.tasks.push('Load testing')
  plan.payments = plan.payments.filter((p: { key: string }) => p.key !== 'final')
  return plan
}

/** A project tab link; a changed tab reads "Name (updated)" for screen readers, so accept both. */
const tab = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(String.raw`^${name}( \(updated\))?$`) })

async function cleanup() {
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  const eve = data.users.find((x) => x.email === EVE)
  if (eve) {
    // An import renames the project, so find it through its member and not only by title.
    const { data: rows } = await service.from('project_members').select('project_id').eq('user_id', eve.id)
    for (const r of rows ?? []) await service.from('projects').delete().eq('id', r.project_id)
    await service.auth.admin.deleteUser(eve.id)
  }
  await service.from('projects').delete().eq('title', TITLE)
}

let projectId = ''

/** An empty setup project with a client member. Nothing is imported yet. */
async function seed() {
  await cleanup()
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: EVE,
    password: EVE_PW,
    email_confirm: true,
    user_metadata: { full_name: 'Eve Estrada' },
  })
  if (userError) throw userError
  const { data: project, error } = await service.from('projects').insert({ title: TITLE, status: 'setup' }).select('id').single()
  if (error) throw error
  projectId = project.id
  await service.from('project_members').insert({ project_id: projectId, user_id: user.user.id })
}

test.beforeAll(seed)
test.afterAll(cleanup)

async function openImport(admin: Page, file: ReturnType<typeof planFile>) {
  await admin.getByRole('button', { name: 'Import plan' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Import plan' })
  await dialog.getByLabel('Choose plan.json').setInputFiles(file)
  return dialog
}

test('import the example into an empty project, then re-import a revision on the live project', async ({ browser }) => {
  test.setTimeout(150_000)
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

  // 1. The admin imports the example into the empty setup project: a tree first, then everything appears.
  await signInAs(admin, ...ADMIN)
  await admin.goto(`/projects/${projectId}`)
  await tab(admin, 'Milestones').click()
  await expect(admin.getByText('No milestones yet. Add the first one, or import a plan.')).toBeVisible()

  const first = await openImport(admin, planFile(example))
  await expect(first.getByRole('heading', { name: 'Will be created' })).toBeVisible()
  await expect(first.getByRole('list', { name: 'Milestones to create' }).locator(':scope > li')).toHaveCount(3)
  await expect(first.getByRole('list', { name: 'Payments to create' }).locator(':scope > li')).toHaveCount(3)
  await expect(first.getByLabel('Reason for change (optional)')).toHaveCount(0) // a setup import has no plan changes to explain
  await first.getByRole('button', { name: 'Apply changes' }).click()
  await expectToast(admin, 'Plan imported: 6 added, 1 changed, 0 removed')

  await expect(admin.getByRole('group', { name: 'Discovery and wireframes' })).toBeVisible()
  await expect(admin.getByRole('group', { name: 'Build the storefront' })).toBeVisible()
  await expect(admin.getByRole('group', { name: 'Launch', exact: true })).toBeVisible()
  await expect(admin.getByLabel('Status of Kickoff call')).toBeVisible()
  await tab(admin, 'Payments').click()
  await expect(admin.getByRole('heading', { name: 'Deposit (30%)', level: 3 })).toBeVisible()
  await expect(admin.getByRole('heading', { name: 'Final payment', level: 3 })).toBeVisible()
  await tab(admin, 'Milestones').click()

  // 2. The project goes live and the client is looking at it.
  await service.from('projects').update({ status: 'active', activated_at: new Date().toISOString() }).eq('id', projectId)
  const client = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await signInAs(client, EVE, EVE_PW)
  await expect(client.getByRole('heading', { name: 'Acme storefront', level: 1 })).toBeVisible() // single project: straight in
  await client.waitForTimeout(2500) // let the live channel subscribe and the first visit be recorded

  // A Done task is the work that must survive a re-import.
  await service.from('tasks').update({ status: 'done' }).eq('project_id', projectId).eq('title', 'Kickoff call')

  // 3. The admin re-imports a revision with a reason and reads the diff first.
  await admin.reload()
  await tab(admin, 'Milestones').click()
  const second = await openImport(admin, planFile(variant()))
  await expect(second.getByRole('heading', { name: 'Changed' })).toBeVisible()
  await expect(second.getByText(/Due date: .*Jan 29, 2027.* → .*Feb 5, 2027/)).toBeVisible()
  await expect(second.getByText('Added task: Load testing')).toBeVisible()
  await expect(second.getByRole('heading', { name: 'Removed' })).toBeVisible()
  await expect(second.getByText('Final payment')).toBeVisible()
  await second.getByLabel('Reason for change (optional)').fill('Scope trimmed')
  await second.getByRole('button', { name: 'Apply changes' }).click()
  await expectToast(admin, 'Plan imported: 0 added, 1 changed, 1 removed')

  // 4. The client sees the plan change live, with the reason, and acknowledges it all in one click.
  const banner = client.getByRole('region', { name: 'The plan changed' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Scope trimmed')
  await expect(banner).toContainText('Build the storefront')
  await expect(banner).toContainText('Final payment')
  await client.getByRole('button', { name: 'Acknowledge' }).click()
  await expectToast(client, 'Changes acknowledged')
  await expect(banner).toHaveCount(0)

  // 5. The Done task is still Done, and the new task arrived.
  await expect(admin.getByLabel('Status of Kickoff call')).toHaveValue('done')
  await expect(admin.getByLabel('Status of Load testing')).toHaveValue('todo')

  // 6. Re-importing the same revision is a no-op.
  const again = await openImport(admin, planFile(variant()))
  await expect(again.getByText('Nothing to change')).toBeVisible()
  await expect(again.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
  await again.getByRole('button', { name: 'Cancel' }).click()

  // 7. On a phone the dialog and a big diff (the revision undone) stay inside the screen.
  await admin.setViewportSize({ width: 375, height: 812 })
  const phone = await openImport(admin, planFile(example))
  await expect(phone.getByRole('heading', { name: 'Changed' })).toBeVisible()
  await expectNoHorizontalScroll(admin)
  const box = await phone.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  expect(box!.y + box!.height).toBeLessThanOrEqual(812)
})
