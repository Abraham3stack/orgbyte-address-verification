# UI_DESIGN

## 1) Purpose and Scope

This document defines the complete UI design system and screen specification for the Address Verification dashboard before implementation.

In scope:

- Single-page internal SaaS verification dashboard
- One primary workflow: submit address -> monitor verification -> inspect result
- Visual system tokens and component behavior for Phase 6 implementation

Out of scope:

- Frontend coding
- API or contract changes
- Additional pages, onboarding, or admin navigation

## 2) Product Direction

Design intent:

- Modern, polished, restrained internal operations dashboard
- Fast to scan, low visual noise, high information clarity
- Confidence-oriented interface where state, progress, and errors are immediately obvious

UX priorities:

- Accurate status communication
- Minimal friction for repeated address checks
- Strong traceability through request/response inspector

## 3) Page Structure and Information Hierarchy

Single page layout (top to bottom):

1. Header bar
2. Main content split into two columns on desktop
3. Left column:
   - Address submission panel
   - Verification progress panel
4. Right column:
   - Verification result panel
   - Developer request/response inspector panel

Priority order:

- Primary action and progress visibility first
- Final verification interpretation second
- Raw technical detail third

## 4) Responsive Layout Behavior

Breakpoints:

- Mobile: 320px to 767px
- Tablet: 768px to 1023px
- Desktop: 1024px and up

Deterministic tablet sub-breakpoints:

- Tablet narrow: 768px to 895px
- Tablet wide: 896px to 1023px

Grid behavior:

- Desktop: 12-column grid, content container max-width 1280px, side padding 32px
- Tablet: 8-column grid, side padding 24px
- Mobile: single column, side padding 16px

Panel stacking:

- Desktop: two-column layout
  - Left 7 columns
  - Right 5 columns
- Tablet narrow (768px to 895px): strict single-column stack order: address form -> progress -> result -> inspector
- Tablet wide (896px to 1023px): two-column layout
  - Left 5 columns (address + progress)
  - Right 3 columns (result + inspector)
- Mobile: strict single-column order:
  - header
  - address form
  - progress
  - result
  - inspector

Sticky behavior:

- Header remains sticky at top
- Result panel stickiness is enabled only on desktop (>=1024px)
- Result panel sticky top offset is 88px (64px header height + 24px content gap)
- Result panel stickiness activates only after a session has been initiated
- Result panel stickiness is disabled when:
  - viewport width is <=1023px
  - viewport height is <720px
  - active session state is FAILED and the user has not started a new session
- On tablet and mobile, no sticky side panels

## 5) Header and Navigation Treatment

Header purpose:

- Establish context and environment state
- Keep navigation minimal for single-flow scope

Header content:

- Left: product title
- Right: API base URL badge and environment badge

Exact labels:

- Title: Address Verification Operations
- Subtitle: Mock Verification Workflow
- API badge label format: API: <configured-base-url>
- Environment badge label: Environment: Local Mock

API base URL source rule:

- The API badge value must come from frontend environment configuration.
- Use `VITE_API_BASE_URL` as the primary source.
- If `VITE_API_BASE_URL` is undefined at runtime, fall back to `http://localhost:4000`.
- `http://localhost:4000` is a development fallback example only and must not be hardcoded as the default displayed value when `VITE_API_BASE_URL` is present.

Navigation constraints:

- No multi-page navigation
- No sidebar
- No tabs beyond internal panel tabs in inspector

## 6) Address Form Layout

Panel title:

- Start Verification

Panel helper text:

- Enter an address to initiate a verification session.

Field order and labels:

1. Address Line 1 (required)
2. Address Line 2 (optional)
3. City (required)
4. State/Region (optional)
5. Postal Code (optional)
6. Country Code (required)

Input hints:

- Country Code placeholder: e.g. US, NG, GB
- Country code accepts lowercase input but displays normalized uppercase in result

Validation messaging:

- Inline field-level messages below each invalid field
- Summary message at panel top for submit failures

Primary action:

- Button label (idle): Initiate Verification
- Button label (submitting): Initiating...

Secondary action:

- Button label: Reset Form

Post-initiation metadata row:

- Session ID label: Session ID
- Created label: Initiated At

## 7) Verification Progress States

Panel title:

- Verification Progress

State badges:

- PENDING
- PROCESSING
- COMPLETED
- FAILED

Progress UI elements:

- Status badge
- Progress bar
- Percent label
- Poll cadence hint

Progress percentage source and mapping rules:

- Progress bar and percent label must use `data.progressPercent` from `GET /verify/status/{sessionId}` as the single source of truth.
- Deterministic state mapping is:
  - PENDING -> 25
  - PROCESSING -> 65
  - COMPLETED -> 100
  - FAILED -> 100
- Before first status response, progress bar value is 0 and percent label is hidden.
- On PENDING and PROCESSING, animate width transitions between values.
- On COMPLETED and FAILED, freeze at 100 with no further animation.
- While polling is active, percent label must always match latest accepted status response for the active session.

Exact supporting labels:

- Poll hint: Polling every 1.5s
- Terminal success: Verification complete
- Terminal failure: Processing failed

State-specific copy:

- Initial (before submission): Start a verification request to track progress.
- PENDING: Session accepted. Verification is queued.
- PROCESSING: Verification checks are in progress.
- COMPLETED: Verification workflow completed.
- FAILED: Processing failed before verification could complete.

## 8) Completed Result Presentation

Panel title:

- Verification Result

Section order:

1. Verdict summary strip
2. Confidence metric
3. Normalized address block
4. Checks grid
5. Issues list

Verdict labels:

- VERIFIED
- PARTIALLY_VERIFIED
- UNVERIFIED

Verdict interpretation copy:

- VERIFIED: Address verification completed with strong confidence.
- PARTIALLY_VERIFIED: Address verification completed with partial confidence.
- UNVERIFIED: Address verification completed but unresolved verification signals remain.

Confidence display:

- Label: Confidence Score
- Value format: fixed two decimals (e.g. 0.90)

Checks labels:

- Address Line 1 Valid
- Postal Code Valid
- City/State Match
- Country Supported

Issues section labels:

- Header: Issues
- Empty state: No issues detected.

Severity styling:

- warning uses amber treatment
- error uses red treatment

## 9) Failed and Error States

Result-not-ready state:

- Trigger: 409 RESULT_NOT_READY
- Message title: Result Not Ready
- Message body: Verification is still in progress.

Processing-failed state:

- Trigger: 409 PROCESSING_FAILED
- Message title: Processing Failed
- Message body: Verification processing failed and no final result is available.
- Action label: Start New Verification

Unknown session:

- Trigger: 404 SESSION_NOT_FOUND
- Message title: Session Not Found
- Message body: No verification session exists for the provided session ID.

Invalid session ID:

- Trigger: 400 INVALID_SESSION_ID
- Message title: Invalid Session ID
- Message body: sessionId must be a valid UUID v4.

Invalid request:

- Trigger: 400 INVALID_REQUEST
- Message title: Invalid Input
- Message body: Request validation failed.

Unexpected error:

- Trigger: 500 INTERNAL_SERVER_ERROR or network failure
- Message title: Request Failed
- Message body: An unexpected error occurred. Try again.
- Action labels:
  - Retry Request
  - Start New Verification

## 10) Loading and Empty States

Empty states:

- Progress panel empty message: Start a verification request to track progress.
- Result panel empty message: Final result will appear when verification completes.
- Inspector empty message: API request and response payloads will appear here.

Loading states:

- Initiate loading: disable submit, show Initiating...
- Status loading: retain previous status and show subtle loading indicator in panel header
- Result loading: skeleton placeholders for verdict, confidence, checks, and issues

Form and action behavior during active requests:

- During initiation request (`POST /verify/initiate` in flight):
  - Disable all form inputs.
  - Disable `Reset Form`.
  - Disable `Initiate Verification` and show `Initiating...`.
- During active polling (non-terminal session):
  - Keep all form inputs disabled.
  - Disable `Reset Form`.
  - Disable `Initiate Verification`.
- After terminal state (COMPLETED or FAILED):
  - Re-enable all form inputs.
  - Re-enable `Reset Form`.
  - Hide `Initiate Verification` and show `Start New Verification` as the primary action.

Session overlap rule:

- Overlapping sessions are not allowed.
- A new session cannot be initiated while there is an active non-terminal session.
- Exactly one `activeSessionId` is allowed in UI state when a session is active.

Cancellation and stale-response invalidation rules:

- Each initiated session creates a new `requestCycleId`.
- Polling requests and result requests must be associated with the current `requestCycleId` and `activeSessionId`.
- On `Reset Form` or `Start New Verification`:
  - Immediately stop polling timers.
  - Cancel in-flight status/result requests where cancellation is supported.
  - Mark previous `requestCycleId` invalid.
- Any late response whose `sessionId` or `requestCycleId` does not match current active values must be ignored and must not update UI.

No-content jitter rule:

- Preserve panel heights during loading to avoid layout shifts

## 11) Developer Request/Response Inspector

Panel title:

- API Inspector

Purpose:

- Provide transparent contract-level observability for each API call

Structure:

- Tab 1: Last Request
- Tab 2: Last Response
- Tab 3: Timeline

Timeline columns:

- Time
- Endpoint
- Status
- Duration

Formatting rules:

- JSON pretty print with 2-space indentation
- Monospace font
- Line wrap enabled on mobile

Controls:

- Copy JSON button
- Clear Inspector button

Inspector history persistence rules:

- Inspector timeline history persists across `Reset Form`.
- Inspector timeline history persists across `Start New Verification`.
- `Last Request` and `Last Response` panels continue to show the most recent API pair until replaced by a newer call.
- Only `Clear Inspector` removes timeline rows and clears `Last Request`/`Last Response` content.

Exact labels:

- Tabs: Last Request, Last Response, Timeline
- Buttons: Copy JSON, Clear Inspector
- Empty timeline: No API calls recorded yet.

## 12) Typography Scale

Font families:

- Sans UI: "Manrope", "Segoe UI", sans-serif
- Mono: "IBM Plex Mono", "SFMono-Regular", monospace

Type scale:

- Display: 32/40, weight 700 (page title)
- H1 panel title: 22/30, weight 700
- H2 subsection title: 18/26, weight 600
- Body primary: 15/24, weight 500
- Body secondary: 14/22, weight 500
- Caption/meta: 12/18, weight 500
- Code: 12/18, weight 500

Text hierarchy usage:

- One display title only in header
- Panel headings use H1 panel style
- Section labels use H2 style

## 13) Spacing System

Base unit:

- 4px

Spacing scale:

- 4, 8, 12, 16, 20, 24, 32, 40, 48

Layout spacing rules:

- Page top spacing below header: 24
- Panel internal padding: 24 desktop, 20 tablet, 16 mobile
- Vertical gap between stacked panels: 16
- Gap between form fields: 12
- Gap between section blocks in result panel: 16

## 14) Color Tokens

Base tokens:

- color.bg.canvas: #F4F7FB
- color.bg.surface: #FFFFFF
- color.bg.surfaceMuted: #F8FAFC
- color.text.primary: #0F172A
- color.text.secondary: #334155
- color.text.muted: #64748B
- color.border.default: #DCE3EE
- color.border.strong: #CBD5E1

Brand/action:

- color.brand.primary: #0B6BFF
- color.brand.primaryHover: #0958D9
- color.brand.primaryActive: #0849B5

Status tokens:

- color.status.pending: #D97706
- color.status.processing: #1D4ED8
- color.status.completed: #15803D
- color.status.failed: #B91C1C

Verdict tokens:

- color.verdict.verified: #15803D
- color.verdict.partial: #B45309
- color.verdict.unverified: #B91C1C

Issue severity:

- color.issue.warning.bg: #FFF7ED
- color.issue.warning.text: #9A3412
- color.issue.error.bg: #FEF2F2
- color.issue.error.text: #991B1B

## 15) Borders, Radii, Shadows, Surfaces

Border widths:

- default: 1px
- focus ring: 2px

Radii:

- small: 8px
- medium: 12px
- large: 16px
- pill: 999px

Shadows:

- surface: 0 1px 2px rgba(16,24,40,0.06), 0 6px 18px rgba(16,24,40,0.06)
- raised: 0 8px 24px rgba(15,23,42,0.10)

Surface layers:

- base canvas
- primary panel surface
- muted nested surface for code blocks and metadata rows

## 16) Component States and Interactions

Buttons:

- states: default, hover, active, disabled, loading, focus-visible
- disabled opacity: 0.55

Inputs:

- states: default, hover, focus, invalid, disabled
- invalid style includes red border + inline message
- focus uses high-contrast ring and never color-only signal

Status badges:

- states map to session status tokens
- text always uppercase

Cards/panels:

- subtle elevation on hover for non-critical panels only
- no hover elevation on mobile

Inspector tabs:

- active tab underline + color shift
- keyboard arrow navigation between tabs

## 17) Accessibility Expectations

Baseline:

- WCAG 2.2 AA color contrast for text and interactive controls
- Full keyboard access for form, buttons, inspector tabs, and copy action
- Visible focus indicator on all interactive components
- Semantic heading order and landmark usage

Status announcements:

- Progress and terminal status changes announced via aria-live polite region
- Form validation summary announced on submit failure

Error clarity:

- Error messages include machine-readable code and plain-language explanation
- No color-only communication for status, verdict, or issues

Touch targets:

- Minimum target size 44x44 on mobile

## 18) Device-Specific Behavior

Mobile:

- Single-column stack
- Inspector defaults collapsed with toggle label: Show API Inspector
- JSON blocks horizontally scrollable when needed

Tablet:

- 768px to 895px uses strict single-column stack: address form -> progress -> result -> inspector
- 896px to 1023px uses two columns: left 5 columns, right 3 columns
- In both tablet ranges, result appears before inspector in reading order

Desktop:

- Two-column dashboard with always-visible inspector panel
- Sticky header and sticky result panel using desktop-only sticky rules from Section 4

## 19) Workflow Actions and Data Reset Rules

### Reset Form

Availability:

- Visible in form panel at all times.
- Disabled while initiation request is in flight.
- Disabled while polling is active for a non-terminal session.

Behavior on click:

- Clear all form field values to empty strings.
- Clear all form validation errors and submit-level errors.
- Clear current workflow state: `activeSessionId`, status badge, progress value, result panel content, and terminal banners.
- Stop polling and invalidate stale responses using Section 10 rules.
- Preserve inspector history and last request/response content.
- Preserve header badges, including API base URL and environment badge.

### Start New Verification

Availability:

- Primary action shown only when current session is terminal (`COMPLETED` or `FAILED`) or when a terminal error state is shown.

Behavior on click:

- Perform all `Reset Form` behavior.
- Set primary action back to `Initiate Verification` idle state.
- Focus `Address Line 1` input.

Data clear/preserve matrix:

- Clears: form values, validation messages, session metadata, progress panel state, result panel state, terminal/error banners, active polling handles.
- Preserves: inspector timeline, last request payload, last response payload, API base URL badge value, environment badge value, design tokens/theme.

## 20) Exact Content Hierarchy and Labels for Phase 6

Top-level hierarchy:

1. Address Verification Operations
2. Start Verification
3. Verification Progress
4. Verification Result
5. API Inspector

Required labels and copy keys:

- Address Verification Operations
- Mock Verification Workflow
- API: <configured-base-url>
- Start Verification
- Enter an address to initiate a verification session.
- Address Line 1
- Address Line 2 (optional)
- City
- State/Region (optional)
- Postal Code (optional)
- Country Code
- Initiate Verification
- Initiating...
- Reset Form
- Session ID
- Initiated At
- Verification Progress
- Polling every 1.5s
- Verification complete
- Processing failed
- Verification Result
- Confidence Score
- Checks
- Issues
- No issues detected.
- Result Not Ready
- Processing Failed
- Session Not Found
- Invalid Session ID
- Invalid Input
- Request Failed
- Retry Request
- Start New Verification
- API Inspector
- Last Request
- Last Response
- Timeline
- Copy JSON
- Clear Inspector
- No API calls recorded yet.

## 21) Implementation Readiness Checklist

Phase 6 can begin when this document is approved and all are true:

- Layout and hierarchy are unambiguous for all breakpoints
- Screen states are fully mapped to API behaviors
- Token set is sufficient to style all required components
- Accessibility requirements are testable and explicit
- Required labels are complete and implementation-ready
