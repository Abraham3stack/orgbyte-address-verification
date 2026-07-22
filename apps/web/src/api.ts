import type {
  AddressInput,
  ApiEnvelope,
  ApiErrorPayload,
  InitiateResponseData,
  InspectorCall,
  ResultResponseData,
  StatusResponseData,
} from './types'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

export class ApiRequestError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = payload.code
    this.details = payload.details
  }
}

type TraceInput = {
  endpoint: string
  method: 'POST' | 'GET'
  requestBody?: unknown
}

type TraceOutput = {
  status: number
  durationMs: number
  responseBody: unknown
}

export type ApiTraceLogger = (input: TraceInput, output: TraceOutput) => void

const parseJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  return response.json()
}

const request = async <T>(
  path: string,
  init: RequestInit,
  traceLogger: ApiTraceLogger,
): Promise<ApiEnvelope<T>> => {
  const start = performance.now()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const durationMs = Math.round(performance.now() - start)
  const payload = (await parseJson(response)) as ApiEnvelope<T> | null

  traceLogger(
    {
      endpoint: path,
      method: (init.method as 'POST' | 'GET') ?? 'GET',
      requestBody: init.body ? JSON.parse(String(init.body)) : undefined,
    },
    {
      status: response.status,
      durationMs,
      responseBody: payload,
    },
  )

  if (!response.ok || !payload || !payload.success || !payload.data) {
    const errorPayload: ApiErrorPayload = payload?.error ?? {
      code: 'REQUEST_FAILED',
      message: `Request failed with status ${response.status}`,
    }
    throw new ApiRequestError(response.status, errorPayload)
  }

  return payload
}

export const createApiClient = (traceLogger: ApiTraceLogger) => ({
  initiate: (input: AddressInput, signal?: AbortSignal) =>
    request<InitiateResponseData>(
      '/verify/initiate',
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      },
      traceLogger,
    ),
  status: (sessionId: string, signal?: AbortSignal) =>
    request<StatusResponseData>(
      `/verify/status/${sessionId}`,
      {
        method: 'GET',
        signal,
      },
      traceLogger,
    ),
  result: (sessionId: string, signal?: AbortSignal) =>
    request<ResultResponseData>(
      `/verify/result/${sessionId}`,
      {
        method: 'GET',
        signal,
      },
      traceLogger,
    ),
})

export const toInspectorCall = (
  input: TraceInput,
  output: TraceOutput,
): InspectorCall => {
  const timeIso = new Date().toISOString()
  return {
    id: `${timeIso}-${Math.random().toString(16).slice(2)}`,
    timeIso,
    endpoint: input.endpoint,
    method: input.method,
    status: output.status,
    durationMs: output.durationMs,
    request: {
      url: `${API_BASE_URL}${input.endpoint}`,
      method: input.method,
      ...(input.requestBody === undefined ? {} : { body: input.requestBody }),
    },
    response: output.responseBody,
  }
}
