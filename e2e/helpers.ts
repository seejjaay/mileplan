import { expect, type Page } from '@playwright/test'

export async function signInAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

/** A toast with this text is on screen (the newest one if several share the text). */
export async function expectToast(page: Page, text: string) {
  await expect(page.getByText(text, { exact: true }).last()).toBeVisible()
}
