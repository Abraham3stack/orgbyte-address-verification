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

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  const desktopLayoutEvidence = await page.evaluate(() => {
    const leftRect = document.querySelector('[aria-label="Start Verification"]')?.getBoundingClientRect()
    const rightRect = document.querySelector('[aria-label="Verification Result"]')?.getBoundingClientRect()
    if (!leftRect || !rightRect) {
      return { twoColumn: false }
    }
    return { twoColumn: Math.abs(leftRect.top - rightRect.top) < 40 && rightRect.left > leftRect.left }
  })
  expect(desktopLayoutEvidence.twoColumn).toBe(true)

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
  await page.getByRole('button', { name: 'Start New Verification' }).first().click()

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

  await page.getByRole('button', { name: 'Start New Verification' }).first().click()
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

  await page.getByRole('button', { name: 'Start New Verification' }).first().click()
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
  await expect(page.getByRole('button', { name: /Show API Inspector|Hide API Inspector/ })).toBeVisible()

  const layoutEvidence = await page.evaluate(() => {
    const progressRect = document.querySelector('[aria-label="Verification Progress"]')?.getBoundingClientRect()
    const resultRect = document.querySelector('[aria-label="Verification Result"]')?.getBoundingClientRect()
    if (!progressRect || !resultRect) {
      return { mobileStacked: false }
    }
    return { mobileStacked: resultRect.top > progressRect.top }
  })

  expect(layoutEvidence.mobileStacked).toBe(true)

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
