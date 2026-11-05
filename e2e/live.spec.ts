import { expect, test, type Page } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectNoHorizontalScroll, expectToast, signInAs } from './helpers'

const TITLE = 'Live E2E'
const EVE = 'eve@client-e.test'
const EVE_PW = 'eve-e2e-pw-1'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const

const service = adminServiceClient()

/** A project tab link; a changed tab reads "Name (updated)" for screen readers, so accept both. */
const tab = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(String.raw`^${name}( \(updated\))?$`) })

async function cleanup() {
  await service.from('projects').delete().eq('title', TITLE)
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === EVE)) await service.auth.admin.deleteUser(u.id)
}

/** A client with a password, and an active project with two milestones. (Onboarding and activation are covered elsewhere.) */
async function seed() {
  await cleanup()
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: EVE,
    password: EVE_PW,
    email_confirm: true,
    user_metadata: { full_name: 'Eve Estrada' },
  })
  if (userError) throw userError
  // Created while in setup so the seed rows are not "plan changes"; activated afterwards.
  const { data: project, error } = await service.from('projects').insert({ title: TITLE, status: 'setup' }).select('id').single()
  if (error) throw error
  await service.from('milestones').insert([
    { project_id: project.id, title: 'Discovery', position: 1, amount: 1000, due_date: '2026-12-15' },
    { project_id: project.id, title: 'Build', position: 2, amount: 2000, due_date: '2026-12-30' },
  ])
  await service.from('project_members').insert({ project_id: project.id, user_id: user.user.id })
  await service.from('projects').update({ status: 'active' }).eq('id', project.id)
}

test.beforeAll(seed)
test.afterAll(cleanup)

test('two live browsers: plan change, acknowledge, review, markers, names, reconnect, phone', async ({ browser }) => {
  test.setTimeout(120_000) // one long story across two live browsers
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const clientContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const client = await clientContext.newPage()

  // Both sign in and open the project
  await signInAs(admin, ...ADMIN)
  await signInAs(client, EVE, EVE_PW)
  await admin.getByRole('link', { name: new RegExp(TITLE) }).click()
  await expect(admin.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
  await expect(client.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible() // single project: straight in
  const route = client.getByRole('list', { name: 'Milestone route' })
  await expect(route.getByRole('listitem').filter({ hasText: 'Discovery' })).toContainText('Next')
  await expect(route.getByRole('listitem').filter({ hasText: 'Build' })).toContainText('Upcoming')
  await client.waitForTimeout(2500) // let the live channel subscribe and the first visit be recorded

  // 1. LIVE plan change: the client sees the banner without reloading, then acknowledges it
  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  const build = admin.getByRole('group', { name: 'Build', exact: true })
  await build.getByLabel('Due date').fill('2027-02-01')
  await build.getByLabel('Reason for change (optional)').fill('scope grew')
  await build.getByRole('button', { name: 'Save changes' }).click()
  await expectToast(admin, 'Milestone saved')

  const banner = client.getByRole('region', { name: 'The plan changed' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Due date: Dec 30, 2026 → Feb 1, 2027')
  await expect(banner).toContainText('Reason: scope grew')

  await admin.getByRole('link', { name: 'Timeline', exact: true }).click()
  const changeRow = admin.getByRole('listitem').filter({ hasText: 'Reason: scope grew' })
  await expect(changeRow).toContainText('Not yet acknowledged')

  await client.getByRole('button', { name: 'Acknowledge' }).click()
  await expectToast(client, 'Changes acknowledged')
  await expect(banner).toHaveCount(0)
  await expect(changeRow).toContainText('Acknowledged by Eve Estrada') // live on the admin's open Timeline

  // 2. LIVE review: approve
  await tab(client, 'Milestones').click()
  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  const discovery = admin.getByRole('group', { name: 'Discovery', exact: true })
  await discovery.getByLabel('Status').selectOption({ label: 'In review' })
  await discovery.getByRole('button', { name: 'Save changes' }).click()
  await expectToast(admin, 'Milestone saved')

  const eveDiscovery = client.getByRole('listitem').filter({ hasText: 'Discovery' }).first()
  await eveDiscovery.getByRole('button', { name: 'Approve', exact: true }).click()
  await client.getByRole('dialog').getByRole('button', { name: 'Approve milestone' }).click()
  await expectToast(client, 'Milestone approved')
  await expect(discovery.getByLabel('Status')).toHaveValue('approved') // admin sees it without reloading
  await expect(discovery).toContainText('Approved by Eve Estrada')

  await tab(client, 'Overview').click()
  await expect(route.getByRole('listitem').filter({ hasText: 'Discovery' })).toContainText('Done')
  await expect(route.getByRole('listitem').filter({ hasText: 'Build' })).toContainText('Next')
  await client.waitForTimeout(1200) // let the line finish drawing in before the picture
  await client.screenshot({ path: 'test-results/route-desktop.png' })

  // 3. LIVE review: request changes
  await tab(client, 'Milestones').click()
  await build.getByLabel('Status').selectOption({ label: 'In review' })
  await build.getByRole('button', { name: 'Save changes' }).click()
  await expectToast(admin, 'Milestone saved')
  const eveBuild = client.getByRole('listitem').filter({ hasText: 'Build' }).first()
  await eveBuild.getByRole('button', { name: 'Request changes' }).click()
  const dialog = client.getByRole('dialog')
  await dialog.getByLabel('What needs to change?').fill('Logo too small')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expectToast(client, 'Changes requested')
  await expect(build.getByLabel('Status')).toHaveValue('in_progress')
  await expect(build).toContainText('Changes requested by Eve Estrada: “Logo too small”')

  // 4. "Updated since your last visit": the client leaves, the admin posts an update, the client comes back
  await client.goto('/account')
  await admin.getByRole('link', { name: 'Updates', exact: true }).click()
  await admin.getByLabel('Write an update (Markdown)').fill('Fresh **news** for Eve')
  await admin.getByRole('button', { name: 'Post update' }).click()
  await expectToast(admin, 'Update posted')
  await client.goto('/')
  await expect(client.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
  await expect(client.getByRole('link', { name: 'Updates (updated)' })).toBeVisible()
  await expect(tab(client, 'Files')).toBeVisible() // nothing changed there

  // 5. Names: the author is the admin's name, not "Project team"
  await client.getByRole('link', { name: 'Updates (updated)' }).click()
  await expect(client.locator('strong', { hasText: 'news' })).toBeVisible()
  await expect(client.getByText(/^admin · /)).toBeVisible()
  await expect(client.getByText(/^Project team · /)).toHaveCount(0)

  // 6. Reconnect: offline shows the pill; a rename made meanwhile appears after coming back, with no reload
  await clientContext.setOffline(true)
  await expect(client.getByText('Reconnecting…')).toBeVisible({ timeout: 8000 })
  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  await discovery.getByLabel('Title', { exact: true }).fill('Discovery renamed')
  await discovery.getByRole('button', { name: 'Save changes' }).click()
  await expectToast(admin, 'Milestone saved')
  await clientContext.setOffline(false)
  await expect(client.getByText('Reconnecting…')).toBeHidden()
  await tab(client, 'Milestones').click()
  await expect(client.getByRole('heading', { name: 'Discovery renamed' })).toBeVisible()

  // 7. Phone: no sideways scroll, and the route runs vertically
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
  await signInAs(phone, EVE, EVE_PW)
  await expect(phone.getByRole('list', { name: 'Milestone route' })).toBeVisible()
  await expectNoHorizontalScroll(phone)
  const segment = phone.locator('[data-segment]').first()
  const box = await segment.boundingBox()
  expect(box!.height).toBeGreaterThan(box!.width)
  await phone.waitForTimeout(1200)
  await phone.screenshot({ path: 'test-results/route-phone.png' })
})
