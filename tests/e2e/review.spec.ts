import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = resolve(__dirname, '..', '..', 'docs', 'reports', 'issue-19')

/**
 * Helper: navigate fresh to a URL, force a known theme, and clear any
 * persisted theme preference from previous runs.
 */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('agent-task-board:theme', t)
    } catch {
      /* ignore */
    }
  }, theme)
}

/**
 * Force the data-theme attribute on <html> so the e2e screenshots don't
 * depend on the host OS prefers-color-scheme setting.
 */
async function forceTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t)
  }, theme)
}

test.describe('Issue #19 — contact form page', () => {
  test('home page renders hero + counter + contact link', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/')

    await expect(page.locator('h1')).toContainText('Get started')
    await expect(page.getByRole('button', { name: /Count is/ })).toBeVisible()

    const contactLink = page.getByRole('link', { name: 'Contact' })
    await expect(contactLink).toBeVisible()
    await expect(contactLink).toHaveAttribute('href', '/contact')

    // Counter works
    await page.getByRole('button', { name: /Count is/ }).click()
    await expect(page.getByRole('button', { name: /Count is/ })).toContainText(
      'Count is 1',
    )
  })

  test('home page screenshot — light mode (full page)', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/')
    await forceTheme(page, 'light')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/home-light.png`,
      fullPage: true,
    })
  })

  test('home page screenshot — dark mode (full page)', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto('/')
    await forceTheme(page, 'dark')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/home-dark.png`,
      fullPage: true,
    })
  })

  test('contact page renders all three fields + submit', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')

    await expect(page.getByRole('heading', { name: 'Contact', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Message')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  })

  test('contact link in header navigates to /contact', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/')
    await page.getByRole('link', { name: 'Contact' }).click()
    await expect(page).toHaveURL(/\/contact$/)
    await expect(page.getByRole('heading', { name: 'Contact', level: 1 })).toBeVisible()
    // NavLink applies aria-current="page" automatically
    await expect(page.getByRole('link', { name: 'Contact' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('contact page screenshot — light mode (full page)', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')
    await forceTheme(page, 'light')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-light.png`,
      fullPage: true,
    })
  })

  test('contact page screenshot — dark mode (full page)', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto('/contact')
    await forceTheme(page, 'dark')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-dark.png`,
      fullPage: true,
    })
  })

  test('empty submit blocks and shows per-field errors', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')

    await page.getByRole('button', { name: 'Send' }).click()

    // URL did not change (we stayed on /contact)
    await expect(page).toHaveURL(/\/contact$/)

    // Per-field error spans visible
    await expect(page.locator('#contact-name-error')).toContainText(
      'Name is required.',
    )
    await expect(page.locator('#contact-email-error')).toContainText(
      'Email is required.',
    )
    await expect(page.locator('#contact-message-error')).toContainText(
      'Message is required.',
    )

    // aria-invalid wired up
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Message')).toHaveAttribute('aria-invalid', 'true')

    // Focus moved to the first invalid field
    const focusedId = await page.evaluate(() => document.activeElement?.id)
    expect(focusedId).toBe('contact-name')
  })

  test('invalid email shows the email error only', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')

    await page.getByLabel('Name').fill('Ada')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Message').fill('Hi there.')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('#contact-email-error')).toContainText(
      'Enter a valid email address.',
    )
    await expect(page.locator('#contact-name-error')).toHaveCount(0)
    await expect(page.locator('#contact-message-error')).toHaveCount(0)
  })

  test('valid submit clears fields and shows success toast', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')

    await page.getByLabel('Name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Message').fill('Hello, world!')

    await page.getByRole('button', { name: 'Send' }).click()

    // Toast appears with role=status
    const toast = page.locator('.toast', { hasText: 'Thanks — message sent.' })
    await expect(toast).toBeVisible()
    await expect(toast).toHaveAttribute('role', 'status')
    await expect(toast).toHaveAttribute('aria-live', 'polite')

    // Fields cleared
    await expect(page.getByLabel('Name')).toHaveValue('')
    await expect(page.getByLabel('Email')).toHaveValue('')
    await expect(page.getByLabel('Message')).toHaveValue('')

    // Toast auto-dismisses within ~3.5s (timer is 3000ms)
    await page.waitForTimeout(3500)
    await expect(toast).toHaveCount(0)
  })

  test('contact toast screenshot (light)', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')
    await forceTheme(page, 'light')

    await page.getByLabel('Name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Message').fill('Hello, world!')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('.toast')).toBeVisible()
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-toast-light.png`,
      fullPage: true,
    })
  })

  test('contact toast screenshot (dark)', async ({ page }) => {
    await setTheme(page, 'dark')
    await page.goto('/contact')
    await forceTheme(page, 'dark')

    await page.getByLabel('Name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Message').fill('Hello, world!')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('.toast')).toBeVisible()
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-toast-dark.png`,
      fullPage: true,
    })
  })

  test('contact errors screenshot (light)', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')
    await forceTheme(page, 'light')

    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('#contact-name-error')).toBeVisible()
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/contact-errors-light.png`,
      fullPage: true,
    })
  })

  test('dark mode toggle re-themes the contact page', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/contact')

    // Light to start
    await forceTheme(page, 'light')
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    )

    // Toggle to dark via the header button
    await page
      .getByRole('button', { name: /Switch to dark mode/ })
      .click()
    await page.waitForFunction(() =>
      document.documentElement.getAttribute('data-theme') === 'dark',
    )
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    )

    expect(lightBg).not.toBe(darkBg)
    expect(darkBg).toBe('#16171d')
  })

  test('unknown route redirects to /', async ({ page }) => {
    await setTheme(page, 'light')
    await page.goto('/does-not-exist')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('h1')).toContainText('Get started')
  })
})