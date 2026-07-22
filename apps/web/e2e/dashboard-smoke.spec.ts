import { expect, test } from '@playwright/test'

test.setTimeout(90_000)

test('dashboard smoke: lifecycle, inspector, copy, and responsive layouts', async ({ page }) => {
  const unexpectedApiStatuses: Array<{ url: string; status: number }> = []
  const consoleErrors: string[] = []
  const networkFailures: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })

  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/verify/')) {
      const status = response.status()
      if (![200, 202, 400, 404, 409].includes(status)) {
        unexpectedApiStatuses.push({ url, status })
      }
    }
  })

  page.on('requestfailed', (request) => {
    networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`)
  })

  await page.addInitScript(() => {
    const clipboardWrites: string[] = []
    ;(window as Window & { __clipboardWrites?: string[] }).__clipboardWrites = clipboardWrites
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          clipboardWrites.push(text)
        },
      },
    })
  })

  const fillAddress = async (address: {
    addressLine1: string
    city: string
    countryCode: string
    addressLine2?: string
    state?: string
    postalCode?: string
  }) => {
    await page.getByLabel('Address Line 1').fill(address.addressLine1)
    await page.getByLabel('Address Line 2 (optional)').fill(address.addressLine2 ?? '')
    await page.getByLabel('City').fill(address.city)
    await page.getByLabel('State/Region (optional)').fill(address.state ?? '')
    await page.getByLabel('Postal Code (optional)').fill(address.postalCode ?? '')
    await page.getByLabel('Country Code').fill(address.countryCode)
  }

  const startVerification = async () => {
    await page.getByRole('button', { name: 'Initiate Verification' }).click()
  }

  const startNewFromForm = async () => {
    const formRegion = page.getByRole('region', { name: 'Start Verification' })
    await expect(formRegion.getByRole('button', { name: 'Start New Verification' })).toBeVisible()
    await formRegion.getByRole('button', { name: 'Start New Verification' }).click()
    await expect(formRegion.getByRole('button', { name: 'Initiate Verification' })).toBeVisible()
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  const desktopLayoutEvidence = await page.evaluate(() => {
    const leftRect = document.querySelector('[aria-label="Start Verification"]')?.getBoundingClientRect()
    const rightRect = document.querySelector('[aria-label="Verification Result"]')?.getBoundingClientRect()
    const apiBadgeRect = Array.from(document.querySelectorAll('span'))
      .find((element) => element.textContent?.trim().startsWith('API:'))
      ?.getBoundingClientRect()
    const envBadgeRect = Array.from(document.querySelectorAll('span'))
      .find((element) => element.textContent?.trim() === 'Environment: Local Mock')
      ?.getBoundingClientRect()

    if (!leftRect || !rightRect || !apiBadgeRect || !envBadgeRect) {
      return { twoColumn: false, desktopBadgesInline: false }
    }

    return {
      twoColumn: Math.abs(leftRect.top - rightRect.top) < 40 && rightRect.left > leftRect.left,
      desktopBadgesInline: Math.abs(apiBadgeRect.top - envBadgeRect.top) < 4,
    }
  })
  expect(desktopLayoutEvidence.twoColumn).toBe(true)
  expect(desktopLayoutEvidence.desktopBadgesInline).toBe(true)

  await expect(page.getByText('Start a verification request to track progress.').first()).toBeVisible()
  await expect(page.getByText('Final result will appear when verification completes.')).toBeVisible()

  await startVerification()
  await expect(page.getByText('Address Line 1 is required')).toBeVisible()
  await expect(page.getByText('City is required')).toBeVisible()
  await expect(page.getByText('Country Code is required')).toBeVisible()

  let injectedStatusFailure = false
  await page.route('**/verify/status/**', async (route) => {
    if (injectedStatusFailure) {
      await route.continue()
      return
    }

    injectedStatusFailure = true
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
        meta: {
          requestId: 'req_smoke',
          timestamp: '2026-07-22T00:00:00.000Z',
        },
      }),
    })
  })

  await fillAddress({
    addressLine1: '500 Retry Road',
    city: 'Lagos',
    countryCode: 'ng',
  })
  await startVerification()
  await expect(page.getByText('Request Failed')).toBeVisible({ timeout: 12_000 })
  await page.unroute('**/verify/status/**')

  await page.getByRole('button', { name: 'Retry Request' }).click()
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByText('Request Failed')).not.toBeVisible()
  await expect(
    page
      .locator('span')
      .filter({ hasText: /^(COMPLETED|FAILED)$/ })
      .first(),
  ).toBeVisible({ timeout: 12_000 })
  await startNewFromForm()

  await fillAddress({
    addressLine1: '12 Marina Road',
    city: 'Lagos',
    countryCode: 'ng',
  })
  await startVerification()
  await expect(page.getByText('Session ID')).toBeVisible()
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible()
  await expect(page.getByText('PROCESSING', { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByText('65%')).toBeVisible({ timeout: 12_000 })

  await expect(page.locator('span').filter({ hasText: 'COMPLETED' }).first()).toBeVisible({
    timeout: 12_000,
  })
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByLabel('Address Line 1')).toHaveAttribute('readonly', '')

  await page.getByRole('tab', { name: 'Timeline' }).click()
  await expect(async () => {
    const rowCount = await page.locator('tbody tr').count()
    expect(rowCount).toBeGreaterThanOrEqual(4)
  }).toPass()

  await page.getByRole('button', { name: 'Copy JSON' }).click()
  await expect(page.getByText('Copied JSON')).toBeVisible()
  const clipboardWrites = await page.evaluate(() => {
    return (window as Window & { __clipboardWrites?: string[] }).__clipboardWrites ?? []
  })
  expect(clipboardWrites.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Clear Inspector' }).click()
  await expect(page.getByText('No API calls recorded yet.')).toBeVisible()

  await startNewFromForm()
  await expect(page.getByLabel('Address Line 1')).toHaveValue('')
  await expect(page.getByLabel('Address Line 1')).not.toHaveAttribute('readonly', '')

  await fillAddress({
    addressLine1: '1 Mock Failure Way',
    city: 'Austin',
    state: 'TX',
    postalCode: '73301',
    countryCode: 'us',
  })
  await startVerification()
  await expect(page.getByText('UNVERIFIED', { exact: true })).toBeVisible({ timeout: 12_000 })

  await startNewFromForm()
  await fillAddress({
    addressLine1: '410 Test Lane',
    city: 'Sydney',
    state: 'NSW',
    postalCode: '2000',
    countryCode: 'au',
  })
  await startVerification()
  await expect(page.getByText('Processing Failed', { exact: true })).toBeVisible({ timeout: 12_000 })

  const resultNotReadyProbe = await page.evaluate(async () => {
    const initiateResponse = await fetch('/verify/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        addressLine1: '12 Marina Road',
        city: 'Lagos',
        countryCode: 'NG',
      }),
    })
    const initiatedPayload = await initiateResponse.json()
    const probeSessionId = initiatedPayload?.data?.sessionId
    const resultResponse = await fetch(`/verify/result/${probeSessionId}`)
    const resultPayload = await resultResponse.json()
    return {
      initiateStatus: initiateResponse.status,
      resultStatus: resultResponse.status,
      resultCode: resultPayload?.error?.code,
    }
  })

  expect(resultNotReadyProbe.initiateStatus).toBe(202)
  expect(resultNotReadyProbe.resultStatus).toBe(409)
  expect(resultNotReadyProbe.resultCode).toBe('RESULT_NOT_READY')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  await expect(page.getByRole('heading', { name: 'Address Verification Operations' })).toBeVisible()
  await expect(page.getByText('Mock Verification Workflow')).toBeVisible()
  await expect(page.getByText(/^API:/)).toBeVisible()
  await expect(page.getByText('Environment: Local Mock')).toBeVisible()
  await expect(page.getByRole('button', { name: /Show API Inspector|Hide API Inspector/ })).toBeVisible()

  const layoutEvidence = await page.evaluate(() => {
    const getByText = (text: string): Element | undefined =>
      Array.from(document.querySelectorAll('*')).find((element) => element.textContent?.trim() === text)
    const getByStartsWith = (prefix: string): Element | undefined =>
      Array.from(document.querySelectorAll('*')).find((element) =>
        element.textContent?.trim().startsWith(prefix),
      )

    const titleRect = getByText('Address Verification Operations')?.getBoundingClientRect()
    const subtitleRect = getByText('Mock Verification Workflow')?.getBoundingClientRect()
    const apiBadgeRect = getByStartsWith('API:')?.getBoundingClientRect()
    const envBadgeRect = getByText('Environment: Local Mock')?.getBoundingClientRect()
    const headerRect = document.querySelector('header')?.getBoundingClientRect()
    const firstCardRect = document.querySelector('[aria-label="Start Verification"]')?.getBoundingClientRect()
    const progressRect = document.querySelector('[aria-label="Verification Progress"]')?.getBoundingClientRect()
    const resultRect = document.querySelector('[aria-label="Verification Result"]')?.getBoundingClientRect()
    if (
      !progressRect ||
      !resultRect ||
      !titleRect ||
      !subtitleRect ||
      !apiBadgeRect ||
      !envBadgeRect ||
      !headerRect ||
      !firstCardRect
    ) {
      return {
        mobileStacked: false,
        titleFullyVisible: false,
        subtitleFullyVisible: false,
        apiBadgeVisible: false,
        envBadgeVisible: false,
        badgesBelowTitle: false,
        headerToCardSpacingPx: 0,
        noHorizontalOverflow: false,
      }
    }
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    return {
      mobileStacked: resultRect.top > progressRect.top,
      titleFullyVisible:
        titleRect.top >= 0 &&
        titleRect.left >= 0 &&
        titleRect.right <= viewportWidth &&
        titleRect.bottom <= viewportHeight,
      subtitleFullyVisible:
        subtitleRect.top >= 0 &&
        subtitleRect.left >= 0 &&
        subtitleRect.right <= viewportWidth &&
        subtitleRect.bottom <= viewportHeight,
      apiBadgeVisible:
        apiBadgeRect.top >= 0 &&
        apiBadgeRect.left >= 0 &&
        apiBadgeRect.right <= viewportWidth &&
        apiBadgeRect.bottom <= viewportHeight,
      envBadgeVisible:
        envBadgeRect.top >= 0 &&
        envBadgeRect.left >= 0 &&
        envBadgeRect.right <= viewportWidth &&
        envBadgeRect.bottom <= viewportHeight,
      badgesBelowTitle: apiBadgeRect.top >= titleRect.bottom && envBadgeRect.top >= titleRect.bottom,
      headerToCardSpacingPx: firstCardRect.top - headerRect.bottom,
      noHorizontalOverflow: document.documentElement.scrollWidth <= viewportWidth,
    }
  })

  expect(layoutEvidence.mobileStacked).toBe(true)
  expect(layoutEvidence.titleFullyVisible).toBe(true)
  expect(layoutEvidence.subtitleFullyVisible).toBe(true)
  expect(layoutEvidence.apiBadgeVisible).toBe(true)
  expect(layoutEvidence.envBadgeVisible).toBe(true)
  expect(layoutEvidence.badgesBelowTitle).toBe(true)
  expect(layoutEvidence.headerToCardSpacingPx).toBeGreaterThanOrEqual(12)
  expect(layoutEvidence.noHorizontalOverflow).toBe(true)

  expect(injectedStatusFailure).toBe(true)
  const unexpectedStatusesExcludingInjectedFailure = unexpectedApiStatuses.filter(
    (entry) => !(entry.status === 500 && entry.url.includes('/verify/status/')),
  )
  expect(unexpectedStatusesExcludingInjectedFailure).toEqual([])
  const nonExpectedConsoleErrors = consoleErrors.filter(
    (entry) =>
      !entry.includes('status of 409') &&
      !entry.includes('Conflict') &&
      !entry.includes('status of 500') &&
      !entry.includes('Internal Server Error'),
  )
  expect(nonExpectedConsoleErrors).toEqual([])
  expect(networkFailures).toEqual([])
})
