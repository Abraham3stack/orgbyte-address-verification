import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { API_BASE_URL, ApiRequestError, createApiClient, toInspectorCall } from './api'
import type {
  AddressInput,
  InspectorCall,
  ResultResponseData,
  SessionState,
  VerificationVerdict,
} from './types'

type InspectorTab = 'request' | 'response' | 'timeline'

const POLL_FALLBACK_MS = 1500
const SUCCESS_STATES: SessionState[] = ['COMPLETED', 'FAILED']
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

const fieldSchema = z.object({
  addressLine1: z.string().trim().min(1, 'Address Line 1 is required').max(120),
  addressLine2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z
    .string()
    .trim()
    .min(1, 'Country Code is required')
    .regex(/^[A-Za-z]{2}$/, 'Country Code must be a 2-letter ISO code'),
})

const formSchema = fieldSchema.transform((value) => ({
  ...value,
  countryCode: value.countryCode.toUpperCase(),
  addressLine2: value.addressLine2 || undefined,
  state: value.state || undefined,
  postalCode: value.postalCode || undefined,
}))

type FormValues = z.input<typeof fieldSchema>
type NormalizedValues = z.output<typeof formSchema>

const toStateSummary = (state: SessionState): string => {
  if (state === 'PENDING') {
    return 'Session accepted. Verification is queued.'
  }
  if (state === 'PROCESSING') {
    return 'Verification checks are in progress.'
  }
  if (state === 'COMPLETED') {
    return 'Verification workflow completed.'
  }

  return 'Processing failed before verification could complete.'
}

const toTerminalMessage = (state: SessionState): string | null => {
  if (state === 'COMPLETED') {
    return 'Verification complete'
  }
  if (state === 'FAILED') {
    return 'Processing failed'
  }
  return null
}

const toVerdictCopy = (verdict: VerificationVerdict): string => {
  if (verdict === 'VERIFIED') {
    return 'Address verification completed with strong confidence.'
  }
  if (verdict === 'PARTIALLY_VERIFIED') {
    return 'Address verification completed with partial confidence.'
  }
  return 'Address verification completed but unresolved verification signals remain.'
}

const jsonText = (value: unknown): string => JSON.stringify(value, null, 2)

function Dashboard() {
  const rqClient = useQueryClient()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeCreatedAt, setActiveCreatedAt] = useState<string | null>(null)
  const [cycleId, setCycleId] = useState(0)
  const [workflowError, setWorkflowError] = useState<ApiRequestError | null>(null)
  const [inspectorCalls, setInspectorCalls] = useState<InspectorCall[]>([])
  const [lastRequest, setLastRequest] = useState<unknown>(null)
  const [lastResponse, setLastResponse] = useState<unknown>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('request')
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const addressLine1InputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth)
      setViewportHeight(window.innerHeight)
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const onTrace = (input: Parameters<typeof toInspectorCall>[0], output: Parameters<typeof toInspectorCall>[1]) => {
    const call = toInspectorCall(input, output)
    setInspectorCalls((prev) => [...prev, call])
    setLastRequest(call.request)
    setLastResponse(call.response)
  }

  const api = useMemo(() => createApiClient(onTrace), [])

  useEffect(() => {
    return () => {
      void rqClient.cancelQueries({ queryKey: ['status'] })
      void rqClient.cancelQueries({ queryKey: ['result'] })
    }
  }, [rqClient])

  const form = useForm<FormValues>({
    resolver: zodResolver(fieldSchema),
    defaultValues: {
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      countryCode: '',
    },
  })

  const addressLine1Registration = form.register('addressLine1')

  const parseFormValues = (): NormalizedValues | null => {
    const result = formSchema.safeParse(form.getValues())
    if (!result.success) {
      return null
    }
    return result.data
  }

  const clearWorkflow = (clearForm: boolean, focusAddressInput: boolean) => {
    void rqClient.cancelQueries({ queryKey: ['status'] })
    void rqClient.cancelQueries({ queryKey: ['result'] })
    setCycleId((prev) => prev + 1)
    setActiveSessionId(null)
    setActiveCreatedAt(null)
    setWorkflowError(null)
    if (clearForm) {
      form.reset({
        addressLine1: '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: '',
        countryCode: '',
      })
    }
    form.clearErrors()
    if (focusAddressInput) {
      addressLine1InputRef.current?.focus()
    }
  }

  const initiateMutation = useMutation({
    mutationFn: async ({ payload }: { payload: AddressInput; requestCycleId: number }) =>
      api.initiate(payload),
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setWorkflowError(error)
      }
    },
  })

  const statusQuery = useQuery({
    queryKey: ['status', activeSessionId, cycleId],
    queryFn: async ({ signal }) => {
      if (!activeSessionId) {
        throw new Error('No active session')
      }
      return api.status(activeSessionId, signal)
    },
    enabled: Boolean(activeSessionId),
    refetchInterval: (query) => {
      const statusData = query.state.data?.data
      if (!statusData) {
        return POLL_FALLBACK_MS
      }
      if (statusData.isTerminal) {
        return false
      }
      return statusData.nextPollAfterMs ?? POLL_FALLBACK_MS
    },
  })

  const statusData = statusQuery.data?.data
  const isTerminal = Boolean(statusData && SUCCESS_STATES.includes(statusData.status))

  const resultQuery = useQuery({
    queryKey: ['result', activeSessionId, cycleId],
    queryFn: async ({ signal }) => {
      if (!activeSessionId) {
        throw new Error('No active session')
      }
      return api.result(activeSessionId, signal)
    },
    enabled: Boolean(activeSessionId && statusData?.status === 'COMPLETED'),
  })

  const onSubmit = form.handleSubmit(async () => {
    if (activeSessionId) {
      return
    }
    const normalized = parseFormValues()
    if (!normalized) {
      return
    }

    setWorkflowError(null)
    const nextCycle = cycleId + 1
    setCycleId(nextCycle)

    try {
      const response = await initiateMutation.mutateAsync({
        payload: normalized,
        requestCycleId: nextCycle,
      })

      if (!response.data) {
        return
      }

      setActiveSessionId(response.data.sessionId)
      setActiveCreatedAt(response.data.createdAt)
    } catch {
      // Error state is handled in mutation callbacks.
    }
  })

  const statusError = statusQuery.error instanceof ApiRequestError ? statusQuery.error : null
  const resultError = resultQuery.error instanceof ApiRequestError ? resultQuery.error : null
  const pollActive = Boolean(activeSessionId && statusData && !statusData.isTerminal)
  const hasActiveSession = Boolean(activeSessionId)
  const formReadOnly = initiateMutation.isPending || pollActive || isTerminal
  const resetDisabled = initiateMutation.isPending || pollActive || isTerminal
  const stickyEnabled =
    hasActiveSession && viewportWidth >= 1024 && viewportHeight >= 720 && statusData?.status !== 'FAILED'

  const displayProgress = statusData?.progressPercent ?? 0
  const statusSummary = statusData ? toStateSummary(statusData.status) : 'Start a verification request to track progress.'
  const statusTerminalCopy = statusData ? toTerminalMessage(statusData.status) : null

  const retryLatestRequest = async () => {
    if (statusError && activeSessionId) {
      await statusQuery.refetch()
      return
    }
    if (resultError && activeSessionId && statusData?.status === 'COMPLETED') {
      await resultQuery.refetch()
      return
    }
    if (workflowError) {
      setWorkflowError(null)
    }
  }

  const copyInspectorJson = async () => {
    const emptyInspectorMessage = {
      message: 'API request and response payloads will appear here.',
    }
    const copySource =
      inspectorTab === 'request'
        ? (lastRequest ?? emptyInspectorMessage)
        : inspectorTab === 'response'
          ? (lastResponse ?? emptyInspectorMessage)
          : inspectorCalls
    const copyValue = jsonText(copySource)

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyValue)
      }
      setCopyMessage('Copied JSON')
    } catch {
      setCopyMessage('Copy failed')
    }
  }

  const clearInspector = () => {
    setInspectorCalls([])
    setLastRequest(null)
    setLastResponse(null)
    setCopyMessage(null)
  }

  const renderResultContent = () => {
    if (!activeSessionId) {
      return <p className="text-sm text-slate-500">Final result will appear when verification completes.</p>
    }

    if (statusError || workflowError) {
      return (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="text-base font-semibold text-rose-900">Request Failed</h3>
          <p className="text-sm text-rose-800">An unexpected error occurred. Try again.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={retryLatestRequest} className="button-secondary">
              Retry Request
            </button>
            <button
              type="button"
              onClick={() => clearWorkflow(true, true)}
              className="button-primary"
            >
              Start New Verification
            </button>
          </div>
        </div>
      )
    }

    if (statusData?.status === 'PENDING' || statusData?.status === 'PROCESSING') {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-base font-semibold text-amber-900">Result Not Ready</h3>
          <p className="text-sm text-amber-800">Verification is still in progress.</p>
        </div>
      )
    }

    if (statusData?.status === 'FAILED' || resultError?.code === 'PROCESSING_FAILED') {
      return (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="text-base font-semibold text-rose-900">Processing Failed</h3>
          <p className="text-sm text-rose-800">
            Verification processing failed and no final result is available.
          </p>
          <button
            type="button"
            onClick={() => clearWorkflow(true, true)}
            className="button-primary"
          >
            Start New Verification
          </button>
        </div>
      )
    }

    if (statusData?.status === 'COMPLETED' && resultError?.code === 'RESULT_NOT_READY') {
      return (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-base font-semibold text-amber-900">Result Not Ready</h3>
          <p className="text-sm text-amber-800">Verification is still in progress.</p>
          <button type="button" onClick={retryLatestRequest} className="button-secondary">
            Retry Request
          </button>
        </div>
      )
    }

    if (resultQuery.isLoading || resultQuery.isFetching) {
      return (
        <div className="space-y-3" aria-label="Result loading">
          <div className="h-8 animate-pulse rounded-lg bg-slate-200"></div>
          <div className="h-18 animate-pulse rounded-lg bg-slate-200"></div>
          <div className="h-18 animate-pulse rounded-lg bg-slate-200"></div>
        </div>
      )
    }

    if (!resultQuery.data?.data) {
      return <p className="text-sm text-slate-500">Final result will appear when verification completes.</p>
    }

    const result: ResultResponseData = resultQuery.data.data

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-600">{result.verdict}</span>
            <span className="text-sm font-semibold text-slate-700">
              Confidence Score: {result.confidenceScore.toFixed(2)}
            </span>
          </div>
          <p className="text-sm text-slate-700">{toVerdictCopy(result.verdict)}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Normalized Address</h3>
          <p className="text-sm text-slate-700">{result.normalizedAddress.formattedAddress}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Checks</h3>
          <dl className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Address Line 1 Valid</dt>
              <dd>{String(result.checks.addressLine1Valid)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Postal Code Valid</dt>
              <dd>{String(result.checks.postalCodeValid)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">City/State Match</dt>
              <dd>{String(result.checks.cityStateMatch)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Country Supported</dt>
              <dd>{String(result.checks.countrySupported)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Issues</h3>
          {result.issues.length === 0 ? (
            <p className="text-sm text-slate-600">No issues detected.</p>
          ) : (
            <ul className="space-y-2">
              {result.issues.map((issue) => (
                <li
                  key={`${issue.code}-${issue.message}`}
                  className={
                    issue.severity === 'warning'
                      ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'
                      : 'rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900'
                  }
                >
                  <p className="font-semibold">{issue.code}</p>
                  <p>{issue.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border-default)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-3 px-4 md:px-6 lg:px-8">
          <div>
            <h1 className="text-xl font-bold leading-tight md:text-2xl">Address Verification Operations</h1>
            <p className="text-sm text-slate-600">Mock Verification Workflow</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs md:text-sm">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium">
              API: {API_BASE_URL}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium">
              Environment: Local Mock
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-4 pb-8 pt-6 md:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 min-[896px]:max-[1023px]:grid-cols-8 lg:grid-cols-12">
          <div className="space-y-4 min-[896px]:max-[1023px]:col-span-5 lg:col-span-7">
            <section className="panel" aria-label="Start Verification">
              <h2 className="panel-title">Start Verification</h2>
              <p className="mb-4 text-sm text-slate-600">
                Enter an address to initiate a verification session.
              </p>

              {workflowError?.code === 'INVALID_REQUEST' ? (
                <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Invalid Input: Request validation failed.
                </p>
              ) : null}

              <form onSubmit={onSubmit} className="space-y-3" noValidate>
                <div>
                  <label htmlFor="addressLine1" className="field-label">
                    Address Line 1
                  </label>
                  <input
                    id="addressLine1"
                    {...addressLine1Registration}
                    ref={(element) => {
                      addressLine1Registration.ref(element)
                      addressLine1InputRef.current = element
                    }}
                    className="input"
                    readOnly={formReadOnly}
                    aria-invalid={Boolean(form.formState.errors.addressLine1)}
                  />
                  {form.formState.errors.addressLine1 ? (
                    <p className="field-error">{form.formState.errors.addressLine1.message}</p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="addressLine2" className="field-label">
                    Address Line 2 (optional)
                  </label>
                  <input id="addressLine2" {...form.register('addressLine2')} className="input" readOnly={formReadOnly} />
                </div>

                <div>
                  <label htmlFor="city" className="field-label">
                    City
                  </label>
                  <input
                    id="city"
                    {...form.register('city')}
                    className="input"
                    readOnly={formReadOnly}
                    aria-invalid={Boolean(form.formState.errors.city)}
                  />
                  {form.formState.errors.city ? <p className="field-error">{form.formState.errors.city.message}</p> : null}
                </div>

                <div>
                  <label htmlFor="state" className="field-label">
                    State/Region (optional)
                  </label>
                  <input id="state" {...form.register('state')} className="input" readOnly={formReadOnly} />
                </div>

                <div>
                  <label htmlFor="postalCode" className="field-label">
                    Postal Code (optional)
                  </label>
                  <input id="postalCode" {...form.register('postalCode')} className="input" readOnly={formReadOnly} />
                </div>

                <div>
                  <label htmlFor="countryCode" className="field-label">
                    Country Code
                  </label>
                  <input
                    id="countryCode"
                    {...form.register('countryCode')}
                    className="input"
                    placeholder="e.g. US, NG, GB"
                    readOnly={formReadOnly}
                    aria-invalid={Boolean(form.formState.errors.countryCode)}
                  />
                  {form.formState.errors.countryCode ? (
                    <p className="field-error">{form.formState.errors.countryCode.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {isTerminal ? (
                    <button
                      type="button"
                      onClick={() => clearWorkflow(true, true)}
                      className="button-primary"
                    >
                      Start New Verification
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="button-primary"
                      disabled={initiateMutation.isPending || hasActiveSession}
                    >
                      {initiateMutation.isPending ? 'Initiating...' : 'Initiate Verification'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => clearWorkflow(true, false)}
                    className="button-secondary"
                    disabled={resetDisabled}
                  >
                    Reset Form
                  </button>
                </div>
              </form>

              {activeSessionId && activeCreatedAt ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold">Session ID</span>: {activeSessionId}
                  </p>
                  <p>
                    <span className="font-semibold">Initiated At</span>: {new Date(activeCreatedAt).toLocaleString()}
                  </p>
                </div>
              ) : null}
            </section>

            <section className="panel" aria-label="Verification Progress">
              <h2 className="panel-title">Verification Progress</h2>
              <div className="mb-3" aria-live="polite">
                <p className="text-sm text-slate-700">{statusSummary}</p>
                {statusTerminalCopy ? (
                  <p className="mt-1 text-sm font-semibold text-slate-900">{statusTerminalCopy}</p>
                ) : null}
              </div>

              {statusData ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold tracking-wide text-slate-700">
                      {statusData.status}
                    </span>
                    {statusData.isTerminal ? null : <span className="text-sm text-slate-500">Polling every 1.5s</span>}
                  </div>

                  <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-[var(--color-brand-primary)] transition-[width] duration-300"
                      style={{ width: `${displayProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-right text-sm text-slate-600">{displayProgress}%</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Start a verification request to track progress.</p>
              )}
            </section>
          </div>

          <div
            className={`space-y-4 min-[896px]:max-[1023px]:col-span-3 lg:col-span-5 ${
              stickyEnabled ? 'lg:sticky lg:top-[88px] lg:self-start' : ''
            }`}
          >
            <section className="panel" aria-label="Verification Result">
              <h2 className="panel-title">Verification Result</h2>
              {renderResultContent()}
            </section>

            <section className="panel" aria-label="API Inspector">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="panel-title !mb-0">API Inspector</h2>
                <button
                  type="button"
                  className="button-secondary md:hidden"
                  onClick={() => setMobileInspectorOpen((prev) => !prev)}
                >
                  {mobileInspectorOpen ? 'Hide API Inspector' : 'Show API Inspector'}
                </button>
              </div>

              <div className={`${mobileInspectorOpen ? 'block' : 'hidden'} md:block`}>
                <div role="tablist" aria-label="API inspector tabs" className="mb-3 flex gap-2">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === 'request'}
                    className={inspectorTab === 'request' ? 'tab-active' : 'tab-inactive'}
                    onClick={() => setInspectorTab('request')}
                  >
                    Last Request
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === 'response'}
                    className={inspectorTab === 'response' ? 'tab-active' : 'tab-inactive'}
                    onClick={() => setInspectorTab('response')}
                  >
                    Last Response
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === 'timeline'}
                    className={inspectorTab === 'timeline' ? 'tab-active' : 'tab-inactive'}
                    onClick={() => setInspectorTab('timeline')}
                  >
                    Timeline
                  </button>
                </div>

                {inspectorTab === 'timeline' ? (
                  inspectorCalls.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      No API calls recorded yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[420px] text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 font-medium">Time</th>
                            <th className="px-3 py-2 font-medium">Endpoint</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectorCalls.map((call) => (
                            <tr key={call.id} className="border-t border-slate-200">
                              <td className="px-3 py-2">{new Date(call.timeIso).toLocaleTimeString()}</td>
                              <td className="px-3 py-2">{call.endpoint}</td>
                              <td className="px-3 py-2">{call.status}</td>
                              <td className="px-3 py-2">{call.durationMs}ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                    {inspectorTab === 'request'
                      ? jsonText(lastRequest ?? { message: 'API request and response payloads will appear here.' })
                      : jsonText(lastResponse ?? { message: 'API request and response payloads will appear here.' })}
                  </pre>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="button-secondary" onClick={copyInspectorJson}>
                    Copy JSON
                  </button>
                  <button type="button" className="button-secondary" onClick={clearInspector}>
                    Clear Inspector
                  </button>
                  {copyMessage ? <span className="text-sm text-slate-500">{copyMessage}</span> : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}

export default App
