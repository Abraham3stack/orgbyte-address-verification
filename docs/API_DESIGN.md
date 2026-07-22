# API_DESIGN

## 1) Purpose and Scope

This document defines the behavior contract for the mock Address Verification API.

Scope in this phase:
- Behavioral design only
- Exactly three endpoints:
  - `POST /verify/initiate`
  - `GET /verify/status/{sessionId}`
  - `GET /verify/result/{sessionId}`

Out of scope:
- OpenAPI authoring (Phase 3)
- API implementation (Phase 4)
- Frontend implementation details
- Database, auth, external providers, queues, WebSockets

## 2) Core Concepts

### Session
A verification session represents one submitted address undergoing asynchronous verification.

### Session ID Format
- Type: UUID v4 string
- Example: `7f9e8cbe-7b5f-4f5d-9db6-9e4865f8a4c1`
- Validation: must match UUID v4 format exactly

### Lifecycle States
- `PENDING`
- `PROCESSING`
- `COMPLETED`
- `FAILED`

Terminal states:
- `COMPLETED`
- `FAILED`

## 3) Address Input Model

`POST /verify/initiate` accepts one JSON body object:

- `addressLine1` (string, required, 1..120 chars)
- `addressLine2` (string, optional, 1..120 chars when present)
- `city` (string, required, 1..80 chars)
- `state` (string, required, 2..80 chars)
- `postalCode` (string, required, 3..20 chars)
- `countryCode` (string, required, exactly 2 uppercase letters, ISO-3166 alpha-2)

Input normalization rules at acceptance time:
- Leading/trailing whitespace is trimmed for all string fields.
- Internal repeated whitespace is collapsed to a single space.
- `countryCode` is uppercased.

Malformed request behavior:
- Missing required fields, wrong types, empty post-trim values, or invalid formats return `400 Bad Request`.

## 4) Time Model and Deterministic State Progression

### Time Anchors
Each session records:
- `createdAt` (UTC ISO timestamp)
- `elapsedMs = now - createdAt`

### Deterministic State by Elapsed Time
For non-failing sessions:
- `0ms <= elapsedMs < 2000ms` => `PENDING`
- `2000ms <= elapsedMs < 7000ms` => `PROCESSING`
- `elapsedMs >= 7000ms` => `COMPLETED`

For failing sessions:
- `0ms <= elapsedMs < 2000ms` => `PENDING`
- `2000ms <= elapsedMs < 6000ms` => `PROCESSING`
- `elapsedMs >= 6000ms` => `FAILED`

State transition constraints:
- Allowed transitions only:
  - `PENDING -> PROCESSING`
  - `PROCESSING -> COMPLETED`
  - `PROCESSING -> FAILED`
- No backward transitions.
- Terminal states are immutable.

## 5) Deterministic Mock Outcome Rules

A session is deterministically marked as a "failing session" at initiation using only normalized input.

Rule:
- Build a seed string:
  - `seed = addressLine1|addressLine2|city|state|postalCode|countryCode`
  - Use empty string for missing `addressLine2`.
- Compute `asciiSum = sum(charCode for each character in seed)`.
- Compute `outcomeKey = asciiSum % 10`.
- Outcome:
  - `outcomeKey` in `{0,1}` => session is failing (eventual `FAILED`)
  - otherwise => session is successful (eventual `COMPLETED`)

Implications:
- Same normalized input always yields same outcome.
- Failure rate is deterministic at ~20%.

## 6) Endpoint Behavior

## 6.1 POST /verify/initiate

Purpose:
- Create a verification session and return accepted processing response.

Success semantics:
- HTTP status: `202 Accepted`
- Creates a new session with:
  - generated UUID v4 `sessionId`
  - `createdAt`
  - initial state `PENDING`
  - deterministic outcome classification (failing or successful)

Success response envelope:
- `success: true`
- `data`:
  - `sessionId` (UUID v4)
  - `status` (`PENDING`)
  - `createdAt` (ISO timestamp)
  - `pollAfterMs` (integer, recommended 1500)
- `error: null`
- `meta`:
  - `requestId` (string)
  - `timestamp` (ISO timestamp)

Error semantics:
- `400 Bad Request` for malformed input
- `500 Internal Server Error` for unexpected mock server faults

## 6.2 GET /verify/status/{sessionId}

Purpose:
- Return current deterministic status of a session.

Path validation:
- Invalid UUID format => `400 Bad Request`
- Valid UUID but unknown session => `404 Not Found`

Success semantics:
- HTTP status: `200 OK`
- Recompute state using elapsed-time and deterministic outcome class.

Success response envelope:
- `success: true`
- `data`:
  - `sessionId`
  - `status` (`PENDING|PROCESSING|COMPLETED|FAILED`)
  - `createdAt`
  - `updatedAt` (current timestamp)
  - `isTerminal` (boolean)
  - `progressPercent` (integer)
  - `nextPollAfterMs` (integer or null)
- `error: null`
- `meta` with request metadata

Progress semantics (deterministic):
- `PENDING` => `25`
- `PROCESSING` => `65`
- `COMPLETED` => `100`
- `FAILED` => `100`

Polling guidance:
- Non-terminal states return `nextPollAfterMs = 1500`
- Terminal states return `nextPollAfterMs = null`

## 6.3 GET /verify/result/{sessionId}

Purpose:
- Return final verification result for completed sessions.

Path validation:
- Invalid UUID format => `400 Bad Request`
- Valid UUID but unknown session => `404 Not Found`

Result availability rules:
- If status is `PENDING` or `PROCESSING`:
  - HTTP `409 Conflict`
  - semantic code `RESULT_NOT_READY`
- If status is `FAILED`:
  - HTTP `422 Unprocessable Entity`
  - semantic code `VERIFICATION_FAILED`
- If status is `COMPLETED`:
  - HTTP `200 OK` with result payload

Successful result payload (`data`):
- `sessionId`
- `status` (`COMPLETED`)
- `completedAt` (ISO timestamp)
- `normalizedAddress`:
  - `addressLine1`
  - `addressLine2` (optional)
  - `city`
  - `state`
  - `postalCode`
  - `countryCode`
  - `formattedAddress` (single-line formatted string)
- `confidenceScore` (number, 0..1, deterministic to 2 decimals)
- `checks`:
  - `addressLine1Valid` (boolean)
  - `postalCodeValid` (boolean)
  - `cityStateMatch` (boolean)
  - `countrySupported` (boolean)
- `issues`:
  - array of issue objects: `{ code, message, severity }`
  - empty array allowed

Deterministic result field rules:
- `normalizedAddress` is the normalized input plus formatted string.
- `confidenceScore`:
  - `confidenceScore = 0.7 + ((asciiSum % 31) / 100)`
  - clamp to max `0.99`
  - round to 2 decimals
- `checks`:
  - `addressLine1Valid = true`
  - `postalCodeValid = postalCode length >= 3`
  - `cityStateMatch = true` (mock simplification)
  - `countrySupported = countryCode in {US,CA,GB,AU,NG}`
- `issues`:
  - add `{ code: "COUNTRY_UNSUPPORTED", message: "Country is accepted but not fully supported in mock checks", severity: "warning" }` when `countrySupported = false`

## 7) Response Envelope Standard

All responses use:
- `success` (boolean)
- `data` (object or null)
- `error` (object or null)
- `meta` (object)

Error object:
- `code` (machine-readable string)
- `message` (human-readable string)
- `details` (optional object/array)

Envelope rules:
- On success: `success=true`, `error=null`
- On error: `success=false`, `data=null`

## 8) HTTP Status Semantics

- `202 Accepted`: session creation accepted and async processing started
- `200 OK`: successful status or final result retrieval
- `400 Bad Request`: malformed request/path parameter
- `404 Not Found`: unknown `sessionId`
- `409 Conflict`: result requested before completion
- `422 Unprocessable Entity`: verification reached deterministic failure
- `500 Internal Server Error`: unexpected server exception

## 9) Behavior Matrix

- Malformed initiate body => `400` `INVALID_REQUEST`
- Initiate accepted => `202` with `sessionId` and `PENDING`
- Unknown session on status => `404` `SESSION_NOT_FOUND`
- Unknown session on result => `404` `SESSION_NOT_FOUND`
- Status during pending window => `200` + `PENDING`
- Status during processing window => `200` + `PROCESSING`
- Status terminal success => `200` + `COMPLETED`
- Status terminal failure => `200` + `FAILED`
- Result while pending/processing => `409` `RESULT_NOT_READY`
- Result after failed => `422` `VERIFICATION_FAILED`
- Result after completed => `200` with final result payload

## 10) Polling, Retry, Backoff, and Timeout Expectations

Client polling expectations:
- Start polling after successful initiate response.
- Poll interval baseline: 1500ms.
- Respect `nextPollAfterMs` when provided.
- Stop polling when terminal state is reached.

Retry expectations:
- Retry only transient request failures (`5xx` or network errors).
- Do not retry `4xx` validation/not-found/conflict/failed-result responses.

Backoff expectations for transient failures:
- Attempt 1 retry delay: 1000ms
- Attempt 2 retry delay: 2000ms
- Attempt 3 retry delay: 4000ms
- Max transient retries: 3

Timeout expectations:
- Client per-request timeout: 5000ms
- Overall status polling timeout budget: 30000ms from `createdAt`
- On timeout budget exceeded before terminal state, client should surface timeout error and allow manual retry.

## 11) Assumptions and Trade-offs

Assumptions:
- Single-tenant mock environment.
- In-memory sessions are acceptable and ephemeral.
- System clocks are sufficiently stable for elapsed-time simulation.

Trade-offs:
- Deterministic formulas prioritize testability over realism.
- Fixed progress percentages keep UI behavior predictable.
- `422` for failed verification cleanly distinguishes terminal business failure from transport errors.

## 12) Privacy and Data Handling Considerations

Current mock expectations:
- Address data is handled only for mock verification behavior.
- No persistent storage design is defined in this phase.
- Logs should avoid full-address plaintext in production systems.

Not implemented in assessment scope:
- Encryption at rest, retention controls, PII redaction pipeline.

## 13) Production-Only Improvements (Not for Assessment Implementation)

- Durable session persistence and idempotency keys.
- AuthN/AuthZ and tenant scoping.
- Rate limiting and abuse controls.
- Audit logging and tracing.
- Real provider abstraction and fallback routing.
- Regional data governance controls.
- SLOs and observability dashboards.
