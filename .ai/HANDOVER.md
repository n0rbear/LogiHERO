# Handover

## Current checkpoint

- Date: 2026-08-09.
- Branch: `codex/mobile-public-auth-audit`.
- Objective: complete the mobile/public endpoint authorization inventory and secure confirmed remaining legacy mobile/public ownership gaps.

## What changed in this checkpoint

- Added a shared mobile scope helper for authenticated-driver name, UUID, company, tour, hotel, and cargo ownership checks.
- Legacy chat endpoints now require device authentication, reject path/body driver-name spoofing, and write chat messages using the server-derived driver name.
- Legacy current-tour and live-update writes now require device authentication, reject cross-driver identity spoofing, and avoid returning raw backend error messages.
- Legacy cost read/sync/status endpoints now require device authentication, scope queries to authenticated driver/company, minimize returned cost fields, prevent cross-driver UUID upserts, and prevent mobile clients from setting dispatcher-owned cost approval/payment status.
- Legacy work-time read/sync endpoints now require device authentication and reject driver-name spoofing before reading or mutating records.
- Mobile profile read/sync/unlink endpoints now require device authentication, restrict operations to the enrolled device/driver, remove the mobile path that could create arbitrary drivers, and minimize profile responses so activation/internal device fields are not returned.
- Hotel read, sync, and driver status-transition endpoints now preserve admin-session reads while requiring device authentication and owner scope for mobile calls.
- Cargo read and driver transition endpoints now preserve admin-session reads while requiring device authentication and tour/cargo/stop ownership for mobile calls.
- Tour Core public read and driver-action endpoints now preserve admin-session reads while requiring device authentication and owner scope for mobile calls.
- Added focused backend regression coverage for chat, cost, profile, hotel, and cargo mobile/public authorization boundaries.

## Previous AI rate-limit checkpoint

- `POST /api/ai/chat` now checks an authenticated AI usage policy after `requireDeviceAuth` and before any outbound Mistral call.
- The limiter uses server-derived identity only: device ID plus driver UUID for burst, driver UUID for driver quota, and company UUID for company quota.
- Default limits are 6 requests per minute per authenticated device/driver, 30 requests per hour per driver, and 120 requests per hour per company.
- Limits are configurable with `AI_RATE_LIMIT_BURST_WINDOW_MS`, `AI_RATE_LIMIT_BURST_MAX`, `AI_RATE_LIMIT_DRIVER_WINDOW_MS`, `AI_RATE_LIMIT_DRIVER_MAX`, `AI_RATE_LIMIT_COMPANY_WINDOW_MS`, and `AI_RATE_LIMIT_COMPANY_MAX`.
- Malformed limit config falls back to safe bounded defaults rather than unlimited behavior.
- Rate-limited requests return `429` with `AI_RATE_LIMITED` and `Retry-After`, and they do not call Mistral.
- The limiter is process-local memory with expired-bucket pruning. It is suitable for the current single-service process but is not distributed across multiple instances and resets on restart.
- Added deterministic backend tests for normal usage, missing/invalid auth, limit exhaustion, provider-call prevention, Driver A/B isolation, body-spoofing resistance, window reset, and malformed/provider-failing accounting.

## Previous Mistral backend migration checkpoint

- Android no longer defines `BuildConfig.MISTRAL_API_KEY` or reads a privileged Mistral key from the app build.
- Android no longer has a direct Mistral Retrofit client or `AiAuth` bearer-header helper.
- Android AI call sites now use the existing authenticated `BackendApi` client and call `POST /api/ai/chat`.
- The backend added `POST /api/ai/chat`, protected by `requireDeviceAuth`.
- Backend Mistral access uses only server-side `MISTRAL_API_KEY` from environment/config and a bounded upstream timeout.
- The AI endpoint accepts only the app-level chat operation, ignores client-supplied provider credentials, returns only `{ content }`, and redacts provider failures behind safe error codes.
- Added focused backend tests for auth, missing server secret, server-side provider authorization, timeout/error safety, and response minimization.
- Added Android JVM regression coverage preventing privileged Mistral config or direct Mistral host access from returning to production Android source.

## Previous generic sync checkpoint

- `GET /api/sync` now requires device authentication and returns only records scoped to the authenticated driver/company.
- `POST /api/sync` now requires device authentication, overwrites server-owned scope fields from `req.deviceAuth`, and rejects cross-driver/cross-company payload tampering.
- Existing records are ownership-checked before revision conflict handling or upsert.
- Related tour, stop, and work-day identifiers are validated server-side before generic sync writes.
- Batch writes rollback and return `403 SYNC_SCOPE_DENIED` when any record is outside the authenticated scope, preventing partial unauthorized mutation.
- Server-only fields such as activation codes, active flags, and admin approval/correction fields are removed from generic sync responses and writes.
- Added focused Node regression coverage for authenticated own-scope sync, missing/invalid/unknown/revoked credentials, cross-driver read/write/create/delete attempts, relation tampering, cross-company tampering, and batch rollback.

## Previous mobile photo-upload checkpoint

- `POST /api/upload-photo` now requires device authentication and only updates the authenticated driver's own profile photo.
- `POST /api/upload-stop-photo` now requires device authentication, resolves stop and tour ownership server-side, and only updates stops owned by the authenticated driver.
- Upload file writes now happen only after authentication and ownership checks pass.
- Upload filenames are server-generated opaque names and are written with no-overwrite semantics.
- Added focused Node regression coverage for owner uploads, missing/invalid credentials, cross-driver body tampering, cross-driver stop tampering, and denial paths that must not persist files or update rows.

## Previous legacy tour sync checkpoint

- `POST /api/sync-tours/:driverName` now requires device authentication and rejects path-driver mismatches before opening a database transaction.
- `GET /api/get-tours/:driverName` now requires device authentication and rejects path-driver mismatches before reading tour data.
- `requireDeviceAuth` now exposes the authenticated driver's server-derived name and company UUID on `req.deviceAuth`.
- Added focused Node regression coverage for owner GET/POST, unauthenticated rejection, invalid credential rejection, and Driver A versus Driver B path tampering.

## Previous reconciliation checkpoint

- Added root `AGENTS.md`.
- Added current `.ai` baseline files.
- Integrated one targeted Android security fix from the ZIP: backend device credentials are isolated to a backend-only client.
- Added Android JVM tests for backend credential isolation.
- Added `.tmp/` to `.gitignore` so extracted snapshots are not accidentally committed.

## What was deliberately not integrated

- Broad backend sync authorization rewrite from the ZIP.
- Driver enrollment/activation rewrite from the ZIP.
- Legacy tour sync rewrite from the ZIP.
- Device unlink result refactor from the ZIP.

Reason: those changes are broader than this baseline checkpoint and would overwrite/refactor newer current work without enough focused validation in one safe unit.

## Required next validation

- Focused backend AI route test.
- Full Node test suite.
- Integration test.
- Typecheck.
- Secret scan.
- Android JVM tests.
- Android build verification.
