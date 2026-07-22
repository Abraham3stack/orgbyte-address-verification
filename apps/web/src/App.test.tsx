import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { errorEnvelope, successEnvelope, toJsonResponse } from './test-helpers'

const fillValidForm = () => {
  fireEvent.change(screen.getByLabelText('Address Line 1'), { target: { value: '12 Marina Road' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lagos' } })
  fireEvent.change(screen.getByLabelText('Country Code'), { target: { value: 'ng' } })
}

const clickInitiate = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Initiate Verification' }))
}

const openInspector = () => {
  const toggle = screen.queryByRole('button', { name: 'Show API Inspector' })
  if (toggle) {
    fireEvent.click(toggle)
  }
}

describe('Address verification dashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the empty initial screen', () => {
    render(<App />)
    openInspector()
    const timelineTab = screen.queryByRole('tab', { name: 'Timeline' })
    if (timelineTab) {
      fireEvent.click(timelineTab)
    }

    expect(screen.getByText('Address Verification Operations')).toBeInTheDocument()
    expect(screen.getAllByText('Start a verification request to track progress.').length).toBeGreaterThan(0)
    expect(screen.getByText('Final result will appear when verification completes.')).toBeInTheDocument()
    expect(screen.getByText('No API calls recorded yet.')).toBeInTheDocument()
  })

  it('shows field validation errors for invalid submission', async () => {
    render(<App />)

    clickInitiate()

    expect(await screen.findByText('Address Line 1 is required')).toBeInTheDocument()
    expect(screen.getByText('City is required')).toBeInTheDocument()
    expect(screen.getByText('Country Code is required')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('handles success polling to completed VERIFIED result and supports start new', async () => {
    let statusCalls = 0
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/verify/initiate') && init?.method === 'POST') {
        return Promise.resolve(
          toJsonResponse(
            202,
            successEnvelope({
              sessionId: '11111111-1111-4111-8111-111111111111',
              status: 'PENDING',
              createdAt: '2026-07-22T10:00:00.000Z',
              pollAfterMs: 1500,
            }),
          ),
        )
      }
      if (url.includes('/verify/status/')) {
        statusCalls += 1
        const status = statusCalls === 1 ? 'PENDING' : statusCalls === 2 ? 'PROCESSING' : 'COMPLETED'
        const progressPercent = status === 'PENDING' ? 25 : status === 'PROCESSING' ? 65 : 100
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '11111111-1111-4111-8111-111111111111',
              status,
              createdAt: '2026-07-22T10:00:00.000Z',
              updatedAt: '2026-07-22T10:00:01.000Z',
              isTerminal: status === 'COMPLETED',
              progressPercent,
              nextPollAfterMs: status === 'COMPLETED' ? null : 1500,
            }),
          ),
        )
      }
      if (url.includes('/verify/result/')) {
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '11111111-1111-4111-8111-111111111111',
              status: 'COMPLETED',
              verdict: 'VERIFIED',
              completedAt: '2026-07-22T10:00:08.000Z',
              normalizedAddress: {
                addressLine1: '12 Marina Road',
                city: 'Lagos',
                countryCode: 'NG',
                formattedAddress: '12 Marina Road, Lagos, NG',
              },
              confidenceScore: 0.9,
              checks: {
                addressLine1Valid: true,
                postalCodeValid: true,
                cityStateMatch: true,
                countrySupported: true,
              },
              issues: [],
            }),
          ),
        )
      }
      return Promise.resolve(toJsonResponse(500, errorEnvelope('INTERNAL_SERVER_ERROR', 'boom')))
    })

    render(<App />)

    fillValidForm()
    clickInitiate()

    expect(await screen.findByText('Session ID')).toBeInTheDocument()
    expect(screen.getByDisplayValue('12 Marina Road')).toHaveAttribute('readonly')

    await waitFor(() => {
      expect(screen.getByText('COMPLETED')).toBeInTheDocument()
      expect(screen.getByText('VERIFIED')).toBeInTheDocument()
      expect(screen.getByText('Confidence Score: 0.90')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start New Verification' })).toBeInTheDocument()
    }, { timeout: 7000 })

    fireEvent.click(screen.getByRole('button', { name: 'Start New Verification' }))

    await waitFor(() => {
      const addressLine1 = screen.getByLabelText('Address Line 1') as HTMLInputElement
      expect(addressLine1.value).toBe('')
      expect(addressLine1).not.toHaveAttribute('readonly')
      expect(addressLine1).toHaveFocus()
    })
  })

  it('keeps PROCESSING_FAILED distinct from completed negative verdicts', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/verify/initiate') && init?.method === 'POST') {
        return Promise.resolve(
          toJsonResponse(
            202,
            successEnvelope({
              sessionId: '22222222-2222-4222-8222-222222222222',
              status: 'PENDING',
              createdAt: '2026-07-22T10:00:00.000Z',
              pollAfterMs: 1500,
            }),
          ),
        )
      }
      if (url.includes('/verify/status/')) {
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '22222222-2222-4222-8222-222222222222',
              status: 'FAILED',
              createdAt: '2026-07-22T10:00:00.000Z',
              updatedAt: '2026-07-22T10:00:01.000Z',
              isTerminal: true,
              progressPercent: 100,
              nextPollAfterMs: null,
            }),
          ),
        )
      }
      return Promise.resolve(toJsonResponse(409, errorEnvelope('PROCESSING_FAILED', 'failed')))
    })

    render(<App />)
    fillValidForm()
    clickInitiate()

    await waitFor(() => {
      expect(screen.getByText('Processing Failed')).toBeInTheDocument()
      expect(screen.queryByText('UNVERIFIED')).not.toBeInTheDocument()
    })
  })

  it('renders a completed UNVERIFIED verdict result', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/verify/initiate') && init?.method === 'POST') {
        return Promise.resolve(
          toJsonResponse(
            202,
            successEnvelope({
              sessionId: '33333333-3333-4333-8333-333333333333',
              status: 'PENDING',
              createdAt: '2026-07-22T10:00:00.000Z',
              pollAfterMs: 1500,
            }),
          ),
        )
      }
      if (url.includes('/verify/status/')) {
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '33333333-3333-4333-8333-333333333333',
              status: 'COMPLETED',
              createdAt: '2026-07-22T10:00:00.000Z',
              updatedAt: '2026-07-22T10:00:08.000Z',
              isTerminal: true,
              progressPercent: 100,
              nextPollAfterMs: null,
            }),
          ),
        )
      }
      if (url.includes('/verify/result/')) {
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '33333333-3333-4333-8333-333333333333',
              status: 'COMPLETED',
              verdict: 'UNVERIFIED',
              completedAt: '2026-07-22T10:00:08.000Z',
              normalizedAddress: {
                addressLine1: '1 Mock Failure Way',
                city: 'Austin',
                state: 'TX',
                postalCode: '73301',
                countryCode: 'US',
                formattedAddress: '1 Mock Failure Way, Austin, TX, 73301, US',
              },
              confidenceScore: 0.88,
              checks: {
                addressLine1Valid: true,
                postalCodeValid: true,
                cityStateMatch: true,
                countrySupported: true,
              },
              issues: [],
            }),
          ),
        )
      }
      return Promise.resolve(toJsonResponse(500, errorEnvelope('INTERNAL_SERVER_ERROR', 'boom')))
    })

    render(<App />)
    fillValidForm()
    clickInitiate()

    await waitFor(() => {
      expect(screen.getByText('UNVERIFIED')).toBeInTheDocument()
      expect(
        screen.getByText('Address verification completed but unresolved verification signals remain.'),
      ).toBeInTheDocument()
    })
  })

  it('handles RESULT_NOT_READY and supports inspector copy and clear', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/verify/initiate') && init?.method === 'POST') {
        return Promise.resolve(
          toJsonResponse(
            202,
            successEnvelope({
              sessionId: '44444444-4444-4444-8444-444444444444',
              status: 'PENDING',
              createdAt: '2026-07-22T10:00:00.000Z',
              pollAfterMs: 1500,
            }),
          ),
        )
      }
      if (url.includes('/verify/status/')) {
        return Promise.resolve(
          toJsonResponse(
            200,
            successEnvelope({
              sessionId: '44444444-4444-4444-8444-444444444444',
              status: 'COMPLETED',
              createdAt: '2026-07-22T10:00:00.000Z',
              updatedAt: '2026-07-22T10:00:08.000Z',
              isTerminal: true,
              progressPercent: 100,
              nextPollAfterMs: null,
            }),
          ),
        )
      }
      if (url.includes('/verify/result/')) {
        return Promise.resolve(
          toJsonResponse(409, errorEnvelope('RESULT_NOT_READY', 'Verification is still in progress')),
        )
      }
      return Promise.resolve(toJsonResponse(500, errorEnvelope('INTERNAL_SERVER_ERROR', 'boom')))
    })

    render(<App />)
    fillValidForm()
    clickInitiate()

    await waitFor(() => {
      expect(screen.getByText('Result Not Ready')).toBeInTheDocument()
    })

    openInspector()
    await waitFor(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    })
    await waitFor(() => {
      expect(screen.getByText('/verify/initiate')).toBeInTheDocument()
      expect(screen.getByText('/verify/status/44444444-4444-4444-8444-444444444444')).toBeInTheDocument()
      expect(screen.getByText('/verify/result/44444444-4444-4444-8444-444444444444')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear Inspector' }))
    expect(screen.getByText('No API calls recorded yet.')).toBeInTheDocument()

    expect(fetch).toHaveBeenCalled()
  })
})
