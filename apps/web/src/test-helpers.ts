import type { ApiEnvelope } from './types'

export const toJsonResponse = <T>(status: number, payload: ApiEnvelope<T>): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })

export const successEnvelope = <T>(data: T): ApiEnvelope<T> => ({
  success: true,
  data,
  error: null,
  meta: {
    requestId: 'req_test',
    timestamp: new Date().toISOString(),
  },
})

export const errorEnvelope = (code: string, message: string): ApiEnvelope<null> => ({
  success: false,
  data: null,
  error: {
    code,
    message,
  },
  meta: {
    requestId: 'req_test',
    timestamp: new Date().toISOString(),
  },
})
