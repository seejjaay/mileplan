import { expect, test, type Page } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectToast, signInAs } from './helpers'

const TITLE = 'Notifications E2E'
const GIA = 'gia@client-g.test'
const GIA_PW = 'gia-e2e-pw-1'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const
const LONG_TITLE = 'x'.repeat(120)

const service = adminServiceClient()

async function adminId(): Promise<string> {
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  return data.users.find((u) => u.email === ADMIN[0])!.id
}

async function cleanup() {
  await service.from('projects').delete().eq('title', TITLE) // cascades milestones and notifications
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === GIA)) await service.auth.admin.deleteUser(u.id)
}

/**
 * A client and a project built while still in setup (so seeding notifies nobody), then activated.
 * The admin's own notifications are cleared first so the unread counts below start from zero.
 */
async function seed() {
  await cleanup()
  await service.from('notifications').delete().eq('recipient_id', await adminId())
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: GIA,
    password: GIA_PW,
    email_confirm: true,
    user_metadata: { full_name: 'Gia Garcia' },
  })
  if (userError) throw userError
  const { data: project, error } = await service.from('projects').insert({ title: TITLE, status: 'setup' }).select('id').single()
  if (error) throw error
  await service.from('project_members').insert({ project_id: project.id, user_id: user.user.id })
  const { error: milestoneError } = await service.from('milestones').insert([
    { project_id: project.id, title: 'Discovery', status: 'in_progress', due_date: '2027-01-01' },
    { project_id: project.id, title: LONG_TITLE, status: 'in_progress', due_date: '2027-02-01' },
  ])
  if (milestoneError) throw milestoneError
  await service.from('projects').update({ status: 'active' }).eq('id', project.id)
  return project.id as string
}

let projectId: string

test.beforeAll(async () => {
  projectId = await seed()
})
test.afterAll(cleanup)

test.describe.configure({ mode: 'serial' })

async function moveToReview(title: string) {
  const { error } = await service.from('milestones').update({ status: 'in_review' }).eq('project_id', projectId).eq('title', title)
  if (error) throw error
}

const bell = (page: Page, name: string | RegExp) => page.getByRole('button', { name })

test('client is told live, approves, and the admin is told live', async ({ browser }) => {
  test.setTimeout(120_000)
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const giaCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  try {
    const admin = await adminCtx.newPage()
    const gia = await giaCtx.newPage()
    await signInAs(admin, ...ADMIN)
    await signInAs(gia, GIA, GIA_PW)
    await expect(gia.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible() // single project: straight in
    await gia.waitForTimeout(2500) // let the shell's live channel subscribe

    // The milestone goes to review: Gia's bell updates without a reload
    await moveToReview('Discovery')
    await expect(bell(gia, 'Notifications, 1 unread')).toBeVisible()
    await bell(gia, 'Notifications, 1 unread').click()
    const panel = gia.getByRole('dialog', { name: 'Notifications' })
    await expect(panel.getByText('Action needed')).toBeVisible()
    await panel.getByRole('button', { name: /Discovery is ready for your review/ }).click()
    await expect(gia).toHaveURL(/\/milestones$/)

    // Gia approves in the app: her action item clears, and the admin hears about it
    const discovery = gia.getByRole('listitem').filter({ hasText: 'Discovery' }).first()
    await discovery.getByRole('button', { name: 'Approve', exact: true }).click()
    await gia.getByRole('dialog').getByRole('button', { name: 'Approve milestone' }).click()
    await expectToast(gia, 'Milestone approved')
    await expect(bell(gia, 'Notifications')).toBeVisible()
    await expect(bell(gia, /unread/)).toHaveCount(0)

    await expect(bell(admin, 'Notifications, 1 unread')).toBeVisible()
    await bell(admin, 'Notifications, 1 unread').click()
    await expect(admin.getByRole('dialog', { name: 'Notifications' })).toContainText('approved Discovery')
  } finally {
    await giaCtx.close()
    await adminCtx.close()
  }
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('a long title does not make the panel scroll sideways', async ({ page }) => {
    await signInAs(page, GIA, GIA_PW)
    await expect(page.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
    await page.waitForTimeout(2500)
    await moveToReview(LONG_TITLE)
    await expect(bell(page, 'Notifications, 1 unread')).toBeVisible()
    await bell(page, 'Notifications, 1 unread').click()
    const panel = page.getByRole('dialog', { name: 'Notifications' })
    await expect(panel.getByText(new RegExp(LONG_TITLE.slice(0, 20)))).toBeVisible()
    // The panel itself: inside the viewport, and nothing in it scrolls sideways. (The page behind it is not asserted:
    // the Overview does not wrap a 120-character unbroken milestone title, with or without the panel open.)
    const box = (await panel.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(await panel.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0)
  })
})
