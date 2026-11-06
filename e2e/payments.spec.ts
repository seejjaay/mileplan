import { expect, test, type Page } from '@playwright/test'
import { adminServiceClient } from '../tests/integration/env'
import { expectNoHorizontalScroll, expectToast, signInAs } from './helpers'

const TITLE = 'Payments E2E'
const EVE = 'eve.pay@client-e.test'
const EVE_PW = 'eve-pay-e2e-pw-1'
const ADMIN = ['admin@mileplan.test', 'mileplan-dev-pw'] as const
const LOCK_COPY = 'This project is closed. Reopen it to make changes.'

// A real 1x1 PNG: the upload rules check both the extension and the reported type.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const proof = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

const service = adminServiceClient()

/** A project tab link; a changed tab reads "Name (updated)" for screen readers, so accept both. */
const tab = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(String.raw`^${name}( \(updated\))?$`) })
/** One scheduled payment's card (the request-level list item, not a payment line inside it). */
const card = (page: Page, title: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, level: 3 }) })
/** An Overview totals tile, found by its label. */
const tile = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('xpath=..')
/** Local YYYY-MM-DD, `days` from today: the same clock the app uses to decide what is overdue. */
const day = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

async function cleanup() {
  const { data: projects } = await service.from('projects').select('id').eq('title', TITLE)
  for (const p of projects ?? []) {
    const { data: files } = await service.storage.from('payment-proofs').list(p.id)
    if (files?.length) await service.storage.from('payment-proofs').remove(files.map((f) => `${p.id}/${f.name}`))
  }
  await service.from('projects').delete().eq('title', TITLE)
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  for (const u of data.users.filter((x) => x.email === EVE)) await service.auth.admin.deleteUser(u.id)
}

/** A client with a password, and an active project with two milestones. */
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

async function addRequest(admin: Page, fields: { title: string; amount: string; due: string; milestone?: string }) {
  await admin.getByRole('button', { name: 'Add scheduled payment' }).click()
  const dialog = admin.getByRole('dialog')
  await dialog.getByLabel('Title').fill(fields.title)
  await dialog.getByLabel('Amount').fill(fields.amount)
  await dialog.getByLabel('Due date').fill(fields.due)
  if (fields.milestone) await dialog.getByLabel('Milestone (optional)').selectOption({ label: fields.milestone })
  await dialog.getByRole('button', { name: 'Add scheduled payment' }).click()
  await expectToast(admin, 'Scheduled payment added')
}

async function uploadProof(client: Page, title: string, file: string) {
  await card(client, title).getByRole('button', { name: 'Upload proof' }).click()
  const dialog = client.getByRole('dialog')
  await dialog.getByLabel('Proof file').setInputFiles(proof(file))
  await dialog.getByRole('button', { name: 'Upload proof' }).click()
  await expectToast(client, 'Proof uploaded')
}

test('two live browsers: schedule, proof, confirm, reject, record, close, stale tab, reopen, phone', async ({ browser }) => {
  test.setTimeout(180_000) // one long story across two live browsers
  const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const client = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()

  await signInAs(admin, ...ADMIN)
  await signInAs(client, EVE, EVE_PW)
  await admin.getByRole('link', { name: new RegExp(TITLE) }).click()
  await expect(admin.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible()
  await expect(client.getByRole('heading', { name: TITLE, level: 1 })).toBeVisible() // single project: straight in
  await client.waitForTimeout(2500) // let the live channel subscribe and the first visit be recorded

  // 1. The admin schedules the deposit. The client sees the plan change and the request live, and acknowledges.
  await tab(admin, 'Payments').click()
  await expect(admin.getByText('No payments scheduled yet.')).toBeVisible()
  await addRequest(admin, { title: '50% deposit', amount: '1000', due: day(1), milestone: 'Discovery' })

  const banner = client.getByRole('region', { name: 'The plan changed' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('50% deposit')
  await client.getByRole('button', { name: 'Acknowledge' }).click()
  await expectToast(client, 'Changes acknowledged')
  await expect(banner).toHaveCount(0)
  await tab(client, 'Payments').click()
  await expect(card(client, '50% deposit').getByText('Due', { exact: true })).toBeVisible()
  await expect(card(client, '50% deposit')).toContainText('Discovery')

  // 2. The client uploads proof. The admin sees it live, views it, confirms it. The client sees Paid live.
  await uploadProof(client, '50% deposit', 'deposit.png')
  await expect(card(admin, '50% deposit').getByText('Proof sent', { exact: true })).toBeVisible()
  const [download] = await Promise.all([
    admin.waitForEvent('download'),
    card(admin, '50% deposit').getByRole('button', { name: 'View proof' }).click(),
  ])
  expect((await admin.request.get(download.url())).status()).toBe(200)
  await card(admin, '50% deposit').getByRole('button', { name: 'Confirm payment' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Confirm payment' }).click()
  await expectToast(admin, 'Payment confirmed')
  await expect(card(client, '50% deposit').getByText('Paid', { exact: true })).toBeVisible()
  await tab(admin, 'Overview').click()
  await expect(tile(admin, 'Paid')).toContainText('₱1,000.00')
  await expect(tile(admin, 'Outstanding')).toContainText('₱0.00')

  // 3. A balance that is already late. Both sides see Overdue, and the dashboard counts it.
  await tab(admin, 'Payments').click()
  await addRequest(admin, { title: 'Balance', amount: '2000', due: day(-1), milestone: 'Build' })
  await expect(card(admin, 'Balance').getByText('Overdue', { exact: true })).toBeVisible()
  await expect(card(client, 'Balance').getByText('Overdue', { exact: true })).toBeVisible()
  await admin.goto('/')
  await expect(admin.getByRole('link', { name: new RegExp(TITLE) })).toContainText('1 overdue')
  await admin.getByRole('link', { name: new RegExp(TITLE) }).click()
  await tab(admin, 'Payments').click()

  // 4. The client sends the wrong proof. The admin rejects it with a note; the request is Overdue again.
  await uploadProof(client, 'Balance', 'wrong.png')
  await expect(card(admin, 'Balance').getByText('Proof sent', { exact: true })).toBeVisible()
  await card(admin, 'Balance').getByRole('button', { name: 'Reject proof' }).click()
  const reject = admin.getByRole('dialog')
  await reject.getByLabel('Reason for rejecting').fill('Wrong account')
  await reject.getByRole('button', { name: 'Reject proof' }).click()
  await expectToast(admin, 'Proof rejected')
  await expect(card(client, 'Balance')).toContainText('Wrong account')
  await expect(card(client, 'Balance').getByText('Overdue', { exact: true })).toBeVisible()

  // 5. The admin records the cash payment. Outstanding is zero.
  await card(admin, 'Balance').getByRole('button', { name: 'Record payment' }).click()
  const record = admin.getByRole('dialog')
  await expect(record.getByLabel('Amount')).toHaveValue('2000')
  await record.getByLabel('Method').fill('cash')
  await record.getByRole('button', { name: 'Record payment' }).click()
  await expectToast(admin, 'Payment recorded')
  await expect(card(client, 'Balance').getByText('Paid', { exact: true })).toBeVisible()
  await tab(admin, 'Overview').click()
  await expect(tile(admin, 'Outstanding')).toContainText('₱0.00')
  await expect(tile(admin, 'Paid')).toContainText('₱3,000.00')

  // 6. Before closing: something left to pay, and a milestone waiting for the client's review.
  await tab(admin, 'Payments').click()
  await addRequest(admin, { title: 'Final', amount: '500', due: day(30) })
  await tab(admin, 'Milestones').click()
  const build = admin.getByRole('group', { name: 'Build', exact: true })
  await build.getByLabel('Status').selectOption({ label: 'In review' })
  await build.getByRole('button', { name: 'Save changes' }).click()
  // One run in five saw update_milestone take 6.6s on the local stack while every other call took <1s.
  await expectToast(admin, 'Milestone saved', 15_000)
  await tab(client, 'Milestones').click()
  await expect(client.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()

  // The client opens an upload dialog and attaches a file, then leaves it sitting there: a stale tab.
  await tab(client, 'Payments').click()
  await card(client, 'Final').getByRole('button', { name: 'Upload proof' }).click()
  const stale = client.getByRole('dialog')
  await stale.getByLabel('Proof file').setInputFiles(proof('late.png'))

  const { data: projects } = await service.from('projects').select('id').eq('title', TITLE)
  const projectId = projects![0].id
  const before = (await service.storage.from('payment-proofs').list(projectId)).data!.length

  // The admin closes the project as Completed. The client sees the banner live.
  await tab(admin, 'Overview').click()
  await admin.getByRole('button', { name: 'Close project' }).click()
  const closeDialog = admin.getByRole('dialog')
  await closeDialog.getByRole('radio', { name: 'Completed' }).check()
  await closeDialog.getByRole('button', { name: 'Close project' }).click()
  await expectToast(admin, 'Project closed')
  const closed = client.getByText(/This project was completed on .+ and is read-only\./)
  await expect(closed).toBeVisible()

  // The stale tab gets the lock copy, and no file is left behind.
  await stale.getByRole('button', { name: 'Upload proof' }).click()
  await expectToast(client, LOCK_COPY)
  expect((await service.storage.from('payment-proofs').list(projectId)).data!.length).toBe(before)
  await stale.getByRole('button', { name: 'Cancel' }).click()

  // Everything is read-only for the client, and for the admin too.
  await expect(client.getByRole('button', { name: 'Upload proof' })).toHaveCount(0)
  await tab(client, 'Milestones').click()
  await expect(client.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await expect(admin.getByRole('button', { name: 'Close project' })).toHaveCount(0)
  await expect(admin.getByRole('button', { name: 'Reopen project' })).toBeVisible()
  await tab(admin, 'Payments').click()
  await expect(admin.getByRole('button', { name: 'Add scheduled payment' })).toHaveCount(0)
  await expect(card(admin, 'Final').getByRole('button', { name: 'Record payment' })).toHaveCount(0)

  // 7. The admin reopens the project, and the controls come back.
  await tab(admin, 'Overview').click()
  await admin.getByRole('button', { name: 'Reopen project' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Reopen project' }).click()
  await expectToast(admin, 'Project reopened')
  await expect(closed).toHaveCount(0)
  await expect(client.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  await tab(client, 'Payments').click()
  await expect(card(client, 'Final').getByRole('button', { name: 'Upload proof' })).toBeVisible()

  // 8. Phone: no sideways scroll on the Payments tab.
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage()
  await signInAs(phone, EVE, EVE_PW)
  await tab(phone, 'Payments').click()
  await expect(phone.getByRole('heading', { name: 'Payments', level: 2 })).toBeVisible()
  await expect(card(phone, 'Final')).toBeVisible()
  await expectNoHorizontalScroll(phone)
})
