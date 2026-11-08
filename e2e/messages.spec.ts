import { expect, test } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectNoHorizontalScroll, expectToast, signInAs } from './helpers'

const TITLE = 'Messages E2E'
const FAY = 'fay@client-f.test'
const FAY_PW = 'fay-e2e-pw-1'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const

/** The tab link, with or without an unread count in its name. */
const MESSAGES_TAB = /^Messages( \d+ unread)?$/

const service = adminServiceClient()

async function cleanup() {
  await service.from('projects').delete().eq('title', TITLE)
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === FAY)) await service.auth.admin.deleteUser(u.id)
}

/** A client, an active project, and 60 earlier messages from the admin so the thread is paginated. */
async function seed() {
  await cleanup()
  const { data: user, error: userError } = await service.auth.admin.createUser({
    email: FAY,
    password: FAY_PW,
    email_confirm: true,
    user_metadata: { full_name: 'Fay Flores' },
  })
  if (userError) throw userError
  const { data: project, error } = await service.from('projects').insert({ title: TITLE, status: 'active' }).select('id').single()
  if (error) throw error
  await service.from('project_members').insert({ project_id: project.id, user_id: user.user.id })
  const { data: users } = await service.auth.admin.listUsers({ perPage: 200 })
  const adminId = users.users.find((u) => u.email === ADMIN[0])!.id
  const base = Date.now() - 2 * 24 * 60 * 60 * 1000
  const { error: seedError } = await service.from('messages').insert(
    Array.from({ length: 60 }, (_, i) => ({
      project_id: project.id,
      sender_id: adminId,
      body: `Earlier message ${i + 1}`,
      created_at: new Date(base + i * 60_000).toISOString(),
    })),
  )
  if (seedError) throw seedError
}

test.beforeAll(seed)
test.afterAll(cleanup)

test('two live browsers: send, unread, reply, edit, pill, keyboard', async ({ browser }) => {
  test.setTimeout(120_000)
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const fay = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await signInAs(admin, ...ADMIN)
  await signInAs(fay, FAY, FAY_PW)
  await expect(fay.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible() // single project: straight in

  // The admin sits on the dashboard; Fay sends a message with a link and a PDF
  const card = admin.getByRole('link', { name: new RegExp(TITLE) })
  await expect(card).toBeVisible()
  await admin.waitForTimeout(2500) // let the app-shell unread channel subscribe
  await fay.getByRole('link', { name: MESSAGES_TAB }).click()
  await fay.getByLabel('Message', { exact: true }).fill('Hi, link https://example.com.')
  await fay.getByLabel('Attach').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
  await fay.getByRole('button', { name: 'Send', exact: true }).click()
  const sent = fay.getByRole('listitem').filter({ hasText: 'Hi, link' })
  await expect(sent).toBeVisible()

  // 1. The admin's dashboard card shows "1 unread" before the tab is opened
  await expect(card.getByLabel('1 unread')).toBeVisible()

  // 2. The admin opens Messages: live message with a link and a chip, badge clears, the reply reaches Fay
  await card.click()
  await admin.getByRole('link', { name: MESSAGES_TAB }).click()
  const incoming = admin.getByRole('listitem').filter({ hasText: 'Hi, link' })
  await expect(incoming.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('href', 'https://example.com')
  await expect(incoming).toContainText('brief.pdf')
  await admin.getByLabel('Message', { exact: true }).fill('Thanks Fay, got it')
  await admin.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(fay.getByRole('listitem').filter({ hasText: 'Thanks Fay, got it' })).toBeVisible()

  // 3. Fay edits her message within the window; the admin sees "edited"
  await sent.getByRole('button', { name: 'Edit' }).click()
  await fay.getByLabel('Message', { exact: true }).first().fill('Hi, updated https://example.com')
  await fay.getByRole('button', { name: 'Save' }).click()
  await expectToast(fay, 'Message edited')
  await expect(admin.getByRole('listitem').filter({ hasText: 'Hi, updated' })).toContainText('edited')

  // 4. Scrolled up on the admin side: a new message shows the pill instead of moving the view
  await admin.getByTestId('thread-scroll').evaluate((el) => (el.scrollTop = 0))
  await expect(admin.getByRole('button', { name: 'Load earlier' })).toBeVisible()
  await fay.getByLabel('Message', { exact: true }).fill('One more thing')
  await fay.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(admin.getByRole('button', { name: 'New messages ↓' })).toBeVisible()
  await admin.getByRole('button', { name: 'New messages ↓' }).click()
  await expect(admin.getByRole('listitem').filter({ hasText: 'One more thing' })).toBeVisible()
  await expect(admin.getByRole('button', { name: 'New messages ↓' })).toHaveCount(0)

  // 5. Keyboard only: reach the composer with Tab, type, Enter
  await fay.getByRole('link', { name: MESSAGES_TAB }).focus()
  for (let i = 0; i < 30; i++) {
    if (await fay.getByLabel('Message', { exact: true }).evaluate((el) => el === document.activeElement)) break
    await fay.keyboard.press('Tab')
  }
  await fay.keyboard.type('Sent from the keyboard')
  await fay.keyboard.press('Enter')
  await expect(admin.getByRole('listitem').filter({ hasText: 'Sent from the keyboard' })).toBeVisible()
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the thread does not scroll sideways', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
    await signInAs(page, FAY, FAY_PW)
    await page.getByRole('link', { name: MESSAGES_TAB }).click()
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible()
    await page.getByLabel('Message', { exact: true }).fill('x'.repeat(300))
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('listitem').filter({ hasText: 'xxxxxxxx' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
