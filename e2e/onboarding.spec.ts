import { expect, test, type Page } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'

const CARA_EMAIL = 'cara@client-c.test'
const CARA_PASSWORD = 'cara-new-pw-1'
const BAD_LINK = 'This setup link has expired or was already used. Ask CJ for a new link.'

async function removeCara() {
  const service = adminServiceClient()
  await service.from('redeem_attempts').delete().gte('at', '1970-01-01') // all local runs share one IP; keep the rate limit out of the way
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === CARA_EMAIL)) await service.auth.admin.deleteUser(u.id)
}

async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.beforeAll(removeCara)
test.afterAll(removeCara)

test('admin onboards a client who sets a password, then deactivates them', async ({ browser }) => {
  // 1. Admin signs in and opens /clients
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInAs(admin, 'admin@mileplan.test', 'mileplan-dev-pw')
  await admin.getByRole('link', { name: 'Clients' }).click()
  await expect(admin.getByRole('heading', { name: 'Clients' })).toBeVisible()
  await expect(admin.getByRole('row', { name: /ana@client-a\.test/ })).toBeVisible() // seed clients exist, so the list (not the empty state) renders

  // 2. Admin creates Cara and reads the setup link
  await admin.getByRole('button', { name: 'Add client' }).click()
  await admin.getByLabel('Full name').fill('Cara Cruz')
  await admin.getByLabel('Email').fill(CARA_EMAIL)
  await admin.getByRole('button', { name: 'Create client' }).click()
  await expect(admin.getByText('Client created')).toBeVisible()
  const firstUrl = await admin.getByLabel('Setup link', { exact: true }).inputValue()
  expect(firstUrl).toMatch(/\/setup#token=[A-Za-z0-9_-]{43}$/)
  await admin.getByRole('button', { name: 'Done' }).click()

  // 3 + 6. Client redeems the link with the keyboard only (no mouse)
  const clientContext = await browser.newContext()
  const cara = await clientContext.newPage()
  await cara.goto(firstUrl)
  await expect(cara.getByLabel('Password')).toBeVisible() // lazy page has rendered
  await cara.keyboard.press('Tab') // skip link
  await cara.keyboard.press('Tab') // password field
  await expect(cara.getByLabel('Password')).toBeFocused()
  await cara.keyboard.type(CARA_PASSWORD)
  await cara.keyboard.press('Enter')
  await expect(cara.getByRole('heading', { name: 'My projects' })).toBeVisible()
  await expect(cara.getByText(/No projects yet/)).toBeVisible()
  expect(cara.url()).not.toContain('token')

  // 4. Admin regenerates the link and deactivates Cara; Cara reloads and sees the deactivated screen
  const row = admin.getByRole('row', { name: /Cara Cruz/ })
  await row.getByRole('button', { name: /Regenerate link/ }).click()
  await expect(admin.getByLabel('Setup link', { exact: true })).toHaveValue(/\/setup#token=/)
  await admin.getByRole('button', { name: 'Done' }).click()
  await row.getByRole('button', { name: /Deactivate/ }).click()
  await admin.getByRole('button', { name: 'Confirm deactivate' }).click()
  await expect(admin.getByText('Cara Cruz deactivated')).toBeVisible()
  await cara.reload()
  await expect(cara.getByRole('heading', { name: 'Account deactivated' })).toBeVisible()

  // 5. The first link no longer works
  const stranger = await (await browser.newContext()).newPage()
  await stranger.goto(firstUrl)
  await stranger.getByLabel('Password').fill('another-pw-123')
  await stranger.getByRole('button', { name: 'Set password' }).click()
  await expect(stranger.getByRole('alert')).toHaveText(BAD_LINK)
})

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('admin clients page and client home do not scroll sideways', async ({ browser }) => {
    const admin = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
    await signInAs(admin, 'admin@mileplan.test', 'mileplan-dev-pw')
    await admin.goto('/clients')
    await expect(admin.getByRole('row', { name: /ana@client-a\.test/ })).toBeVisible()
    await expectNoHorizontalScroll(admin)

    const ana = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
    await signInAs(ana, 'ana@client-a.test', 'mileplan-dev-pw')
    await expect(ana.getByRole('heading', { name: 'My projects' })).toBeVisible()
    await expectNoHorizontalScroll(ana)
  })
})
