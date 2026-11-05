import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectNoHorizontalScroll, expectToast, signInAs } from './helpers'

const TITLE = 'Tracker E2E'
const DEE_EMAIL = 'dee@client-d.test'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const
// A real 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n% tracker e2e signed agreement\n%%EOF\n')

async function cleanup() {
  const service = adminServiceClient()
  await service.from('redeem_attempts').delete().gte('at', '1970-01-01') // all local runs share one IP
  await service.from('projects').delete().eq('title', TITLE) // cascades milestones, tasks, updates, documents, activity
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === DEE_EMAIL)) await service.auth.admin.deleteUser(u.id)
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test.describe.configure({ mode: 'serial' })

test('admin builds a project and activates it; the client sees it read-only', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage()
  await signInAs(admin, ...ADMIN)

  // 1. Create the project, add two milestones, tasks, reorder by keyboard
  await admin.getByRole('link', { name: 'New project' }).click()
  await admin.getByLabel('Title').fill(TITLE)
  await admin.getByLabel('Summary').fill('End-to-end tracker check')
  await admin.getByRole('button', { name: 'Create project' }).click()
  await expectToast(admin, 'Project created')
  await expect(admin.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
  await expect(admin.getByText('Setting up')).toBeVisible()

  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  await expect(admin.getByText('No milestones yet. Add the first one.')).toBeVisible()
  for (const [name, amount, due] of [
    ['Discovery', '1000', '2026-12-15'],
    ['Build', '2000', '2026-12-30'],
  ]) {
    await admin.getByRole('button', { name: 'Add milestone' }).click()
    const dialog = admin.getByRole('dialog', { name: 'Add milestone' })
    await dialog.getByLabel('Title').fill(name)
    await dialog.getByLabel('Amount').fill(amount)
    await dialog.getByLabel('Due date').fill(due)
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expectToast(admin, 'Milestone added')
    await expect(admin.getByRole('group', { name, exact: true })).toBeVisible()
  }

  const discovery = admin.getByRole('group', { name: 'Discovery', exact: true })
  for (const task of ['Kickoff call', 'Sitemap']) {
    await discovery.getByLabel('New task').fill(task)
    await discovery.getByRole('button', { name: 'Add task' }).click()
    await expectToast(admin, 'Task added')
    await expect(discovery.getByLabel(`Title of ${task}`)).toBeVisible()
  }

  await admin.getByRole('button', { name: 'Reorder Build' }).focus()
  // dnd-kit measures between key presses, so give each step a frame to settle
  await admin.keyboard.press('Space')
  await admin.waitForTimeout(150)
  await admin.keyboard.press('ArrowUp')
  await admin.waitForTimeout(150)
  await admin.keyboard.press('Space')
  await expectToast(admin, 'Order saved')
  await expect(admin.locator('fieldset > legend').first()).toHaveText('Build') // moved above Discovery

  // 2. Upload a signed PDF; the SHA-256 shown matches the file's hash
  await admin.getByRole('link', { name: 'Files', exact: true }).click()
  await admin.getByLabel('Signed document file').setInputFiles({ name: 'agreement.pdf', mimeType: 'application/pdf', buffer: PDF })
  await admin.getByLabel('Title').fill('Service agreement')
  await admin.getByLabel('Signed on').fill('2026-11-04')
  await admin.getByRole('button', { name: 'Upload document' }).click()
  await expectToast(admin, 'Document uploaded')
  const expectedHash = createHash('sha256').update(PDF).digest('hex')
  await expect(admin.locator(`code[title="${expectedHash}"]`)).toBeVisible()
  await expect(admin.getByText(`${expectedHash.slice(0, 12)}…`)).toBeVisible()

  // 3. Add the client and activate
  await admin.getByRole('link', { name: 'Overview', exact: true }).click()
  await admin.getByRole('button', { name: 'Add client & activate' }).click()
  const activate = admin.getByRole('dialog')
  await activate.getByLabel('Full name').fill('Dee Diaz')
  await activate.getByLabel('Email').fill(DEE_EMAIL)
  await activate.getByRole('button', { name: 'Add client & activate' }).click()
  await expectToast(admin, 'Project activated')
  const setupUrl = await activate.getByLabel('Setup link', { exact: true }).inputValue()
  expect(setupUrl).toMatch(/\/setup#token=/)
  await activate.getByRole('button', { name: 'Done' }).click()
  await expect(admin.getByText('Active', { exact: true }).first()).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Add client & activate' })).toHaveCount(0)

  // 4. A plan change with a reason shows up on the Timeline as a Plan change
  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  await discovery.getByLabel('Due date').fill('2027-01-10')
  await discovery.getByLabel('Reason for change (optional)').fill('client asked for more time')
  await discovery.getByRole('button', { name: 'Save changes' }).click()
  await expectToast(admin, 'Milestone saved')
  await admin.getByRole('link', { name: 'Timeline', exact: true }).click()
  const changeRow = admin.getByRole('listitem').filter({ hasText: 'Reason: client asked for more time' })
  await expect(changeRow).toContainText('Due date: Dec 15, 2026 → Jan 10, 2027')
  await expect(changeRow.getByText('Plan change')).toBeVisible()

  // 5. Split a milestone, then merge it back; both are on the Timeline
  await admin.getByRole('link', { name: 'Milestones', exact: true }).click()
  await discovery.getByRole('button', { name: 'Split milestone' }).click()
  const split = admin.getByRole('dialog')
  await split.getByLabel('Sitemap').check()
  await split.getByLabel('Title of the new milestone').fill('Discovery part 2')
  await split.getByLabel('Amount for the new milestone').fill('400')
  await split.getByRole('button', { name: 'Split', exact: true }).click()
  await expectToast(admin, 'Milestone split')
  await expect(admin.getByRole('group', { name: 'Discovery part 2', exact: true })).toBeVisible()
  await discovery.getByRole('button', { name: 'Merge with next' }).click()
  await admin.getByRole('button', { name: 'Confirm merge' }).click()
  await expectToast(admin, 'Milestones merged')
  await expect(admin.getByRole('group', { name: 'Discovery part 2', exact: true })).toHaveCount(0)
  await admin.getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(admin.getByText('Added milestone “Discovery part 2”')).toBeVisible()
  await expect(admin.getByText('Removed milestone “Discovery part 2”')).toBeVisible()

  // 6. Post an update with a PNG attachment
  await admin.getByRole('link', { name: 'Updates', exact: true }).click()
  await admin.getByLabel('Write an update (Markdown)').fill('Wireframes are **ready**')
  await admin.getByLabel('Attachments').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
  await admin.getByRole('button', { name: 'Post update' }).click()
  await expectToast(admin, 'Update posted')
  await expect(admin.locator('strong', { hasText: 'ready' })).toBeVisible()
  await expect(admin.getByRole('button', { name: /shot\.png/ })).toBeVisible()

  // 7. The client redeems the link and sees everything read-only
  const client = await (await browser.newContext()).newPage()
  await client.goto(setupUrl)
  await client.getByLabel('Password').fill('dee-new-pw-1')
  await client.getByRole('button', { name: 'Set password' }).click()
  await expect(client.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible() // single project: straight in
  await expect(client.getByRole('button', { name: 'Add client & activate' })).toHaveCount(0)

  await client.getByRole('link', { name: 'Milestones', exact: true }).click()
  await expect(client.getByRole('heading', { name: 'Build' })).toBeVisible()
  await expect(client.getByRole('heading', { name: 'Discovery' })).toBeVisible()
  await expect(client.getByRole('textbox')).toHaveCount(0)
  await expect(client.getByRole('button', { name: /Save changes|Delete milestone|Add milestone|Reorder/ })).toHaveCount(0)

  await client.getByRole('link', { name: 'Updates', exact: true }).click()
  await expect(client.locator('strong', { hasText: 'ready' })).toBeVisible()
  await expect(client.getByLabel('Write an update (Markdown)')).toHaveCount(0)

  await client.getByRole('link', { name: 'Files', exact: true }).click()
  await expect(client.getByRole('heading', { name: 'Service agreement' })).toBeVisible()
  await expect(client.getByRole('button', { name: 'Download Service agreement' })).toBeVisible()
  await expect(client.getByLabel('Signed document file')).toHaveCount(0)

  // 8. The Timeline shows every step the client is allowed to see
  await client.getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(client.getByText(/Reason: client asked for more time/)).toBeVisible()
  await expect(client.getByText('Posted an update')).toBeVisible()
  await expect(client.getByText('Added document “Service agreement”')).toBeVisible()
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('project pages do not scroll sideways and the tab bar scrolls', async ({ browser }) => {
    const admin = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
    await signInAs(admin, ...ADMIN)
    await admin.getByRole('link', { name: new RegExp(TITLE) }).click()
    await expect(admin.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
    await expectNoHorizontalScroll(admin)
    await expect(admin.getByRole('navigation', { name: 'Project sections' })).toHaveCSS('overflow-x', 'auto')

    for (const tab of ['Milestones', 'Updates', 'Files', 'Timeline']) {
      await admin.getByRole('link', { name: tab, exact: true }).click()
      await expect(admin.getByRole('heading', { name: tab, level: 2 })).toBeVisible()
      await expectNoHorizontalScroll(admin)
    }
  })
})
