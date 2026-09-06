# Known technical debt

Severity reflects current repository evidence as of 2026-09-06.

The 2026-09-06 admin write authorization audit found and closed the remaining READ_ONLY bearer gaps on legacy cost/tour and development seed/reset routes. All unsafe `requireAdmin` route declarations now also require `requireAdminWrite`, with session logout as the sole intentional non-business-data exception.

## Critical

No current CRITICAL security debt remains from the legacy mobile/public endpoint authorization inventory after the dashboard telemetry checkpoint. Re-open this section if a new endpoint inventory proves another public/mobile route can disclose or mutate another driver's/company's data without admin/session/device ownership.

## High

### TD-001 - Legacy mobile/public API authorization follow-up

Current evidence: `POST /api/sync-tours/:driverName` and `GET /api/get-tours/:driverName` now require `requireDeviceAuth` and reject a path `driverName` that differs from the authenticated driver's server-derived name. `GET /api/sync` and `POST /api/sync` also require device authentication, scope reads/writes to the authenticated driver/company, reject cross-driver/cross-company payload tampering, and rollback generic sync batches on scope denial. The mobile/public auth audit also protected legacy chat, current-tour, live-update, cost, work-time, profile/unlink, hotel, cargo, and Tour Core mobile/public endpoints with device authentication and server-derived owner scope where applicable. The dashboard telemetry checkpoint classified `/driver/:name`, `/api/live-status/:name`, `/api/fleet-status`, `/api/get-history/:driverName/:date`, and `/api/stats/:driverName` as private/internal operational surfaces. `/driver/:name`, `/api/fleet-status`, and `/api/all-drivers` now require admin authentication; live-status/history/stats allow admin access or authenticated device access only for the owning driver. Focused regression tests prove missing/invalid credentials, unknown/revoked device handling, cross-driver path changes, generic sync read/write/create/delete denial, relation tampering denial, no partial unauthorized generic sync batch writes, legacy chat boundary, cost UUID/status boundary, profile response minimization, hotel/cargo owner-only driver actions, dashboard unauthenticated rejection, driver A/B telemetry denial, fleet denial to ordinary devices, and payload minimization.

Remaining evidence: No current route in the audited mobile/public inventory is known to allow cross-driver/company read or write purely by changing a caller-controlled name/ID. The reference ZIP should still be treated only as historical evidence.

Risk: future regressions or new public endpoints bypassing the established admin/session/device ownership model.

Next evidence needed: keep endpoint inventories current and add ownership tests when introducing any new public/mobile route.

### TD-002 - Remaining public upload and file lifecycle audit

Current evidence: `POST /api/upload-photo` and `POST /api/upload-stop-photo` now require `requireDeviceAuth`. Driver profile photo uploads only update the authenticated driver's row. Stop photo uploads resolve the stop and tour server-side, enforce authenticated driver and company ownership, and reject caller-controlled identity mismatches before file writes. Focused tests prove missing/invalid credentials, Driver A versus Driver B tampering, and denied requests with no file persistence or row update.

Remaining evidence: The broader public file retention/cleanup policy is not yet documented as a complete lifecycle model.

Risk: orphaned public files outside the newly protected denied-upload paths.

Next evidence needed: file lifecycle policy for public uploads.

### TD-003 - Mistral provider access is server-side; distributed limiting and production smoke remain

Current evidence: Android no longer defines `BuildConfig.MISTRAL_API_KEY`, no longer contains `AiAuth`, no longer provides a direct Mistral Retrofit client, and no longer calls `api.mistral.ai` from production app source. Android AI call sites use authenticated `BackendApi.chatWithAi`. Backend `POST /api/ai/chat` requires `requireDeviceAuth`, uses server-side `MISTRAL_API_KEY`, rejects missing credentials safely, bounds upstream calls with a timeout, and returns only app-level content. It now also applies a process-local authenticated usage policy before provider calls: 6/min per device-driver burst, 30/hour per driver, and 120/hour per company by default. Focused Node and Android JVM tests cover this boundary.

Remaining evidence: No real Mistral provider smoke was run in this checkpoint. The AI limiter is process-local memory, not a shared durable limiter across multiple backend instances, and resets on process restart.

Risk: provider availability/configuration drift and multi-instance/restart usage bursts.

Next evidence needed: production provider smoke with a non-sensitive prompt and a shared/durable AI usage limiter if deployment scales beyond one backend instance.

### TD-004 - Remaining domain-specific sync invariant audit

Current evidence: Generic `/api/sync` now enforces authenticated driver/company scope, validates owned relations, rolls back scope-denied batches, and strips server-only activation/admin approval fields.

Remaining evidence: Generic writes still upsert allowed owner-scoped entities directly rather than routing every mutation through each domain route's full validation/audit workflow. Additional domain-by-domain review is still needed for non-ownership invariants such as cargo transitions, hotel lifecycle, and work-time approval semantics.

### TD-005 - Startup schema mutation remains primary schema owner

`src/database/init.js` still creates/alters/backfills schema. Treat it as migration-risk code.

### TD-006 - NDP commit correlation is incomplete

Recent production verification showed `/version` had the deployed commit, while NDP runtime metadata still lacked commit SHA.

### TD-007 - Production DB/restore evidence can be incomplete

Some integration checks may skip when local PostgreSQL is unavailable. Never count those skips as database PASS.

## Medium

### TD-008 - Historical documentation conflicts with current code

Several older docs and ZIP handover claims describe work not present in current `main`. Keep provenance, but do not use those claims as implementation evidence.
