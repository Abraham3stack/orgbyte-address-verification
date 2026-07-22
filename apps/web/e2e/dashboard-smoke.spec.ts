import { expect, test } from '@playwright/test'

test('dashboard smoke: lifecycle, inspector, copy, and responsive layouts', async ({ page }) => {
  const unexpectedApiStatuses: Array<{ url: string; status: number }> = []
  const consoleErrors: string[] = []

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

  await fillAddress({
    addressLine1: '12 Marina Road',
    city: 'Lagos',
    countryCode: 'ng',
  })
  await startVerification()
  await expect(page.getByText('Session ID')).toBeVisible()
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible()

  const sessionLine = await page.locator('text=Session ID').first().locator('xpath=..').innerText()
  const sessionIdMatch = sessionLine.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  const sessionId = sessionIdMatch ? sessionIdMatch[0] : ''
  expect(sessionId).not.toBe('')

  const processingProbe = await page.evaluate(async (activeSessionId) => {
    await new Promise((resolve) => setTimeout(resolve, 2800))
    const response = await fetch(`/verify/status/${activeSessionId}`)
    const payload = await response.json()
    return {
      httpStatus: response.status,
      state: payload?.data?.status,
      progressPercent: payload?.data?.progressPercent,
    }
  }, sessionId)

  expect(processingProbe.httpStatus).toBe(200)
  expect(processingProbe.state).toBe('PROCESSING')
  expect(processingProbe.progressPercent).toBe(65)

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

  expect(unexpectedApiStatuses).toEqual([])
  const nonExpectedConsoleErrors = consoleErrors.filter(
    (entry) => !entry.includes('status of 409') && !entry.includes('Conflict'),
  )
  expect(nonExpectedConsoleErrors).toEqual([])
})
