export type SessionState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export type VerificationVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED'

export type Severity = 'warning' | 'error'

export type ApiEnvelope<T> = {
  success: boolean
  data: T | null
  error: ApiErrorPayload | null
  meta: {
    requestId: string
    timestamp: string
  }
}

export type ApiErrorPayload = {
  code: string
  message: string
  details?: unknown
}

export type AddressInput = {
  addressLine1: string
  addressLine2?: string
  city: string
  state?: string
  postalCode?: string
  countryCode: string
}

export type InitiateResponseData = {
  sessionId: string
  status: Extract<SessionState, 'PENDING'>
  createdAt: string
  pollAfterMs: number
}

export type StatusResponseData = {
  sessionId: string
  status: SessionState
  createdAt: string
  updatedAt: string
  isTerminal: boolean
  progressPercent: number
  nextPollAfterMs: number | null
}

export type VerificationChecks = {
  addressLine1Valid: boolean
  postalCodeValid: boolean
  cityStateMatch: boolean
  countrySupported: boolean
}

export type VerificationIssue = {
  code: string
  message: string
  severity: Severity
}

export type ResultResponseData = {
  sessionId: string
  status: Extract<SessionState, 'COMPLETED'>
  verdict: VerificationVerdict
  completedAt: string
  normalizedAddress: {
    addressLine1: string
    addressLine2?: string
    city: string
    state?: string
    postalCode?: string
    countryCode: string
    formattedAddress: string
  }
  confidenceScore: number
  checks: VerificationChecks
  issues: VerificationIssue[]
}

export type InspectorCall = {
  id: string
  timeIso: string
  endpoint: string
  method: 'POST' | 'GET'
  status: number
  durationMs: number
  request: {
    url: string
    method: 'POST' | 'GET'
    body?: unknown
  }
  response: unknown
}
