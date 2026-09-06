# Known technical debt

Severity reflects current repository evidence as of 2026-09-06.

The 2026-09-06 admin write authorization audit found and closed the remaining READ_ONLY bearer gaps on legacy cost/tour and development seed/reset routes. All unsafe `requireAdmin` route declarations now also require `requireAdminWrite`, with session logout as the sole intentional non-business-data exception.

A follow-up 2026-09-06 domain invariant audit of generic `/api/sync` found and closed seven confirmed non-ownership bypasses (cost approval/payment status, unauthorized cargo creation and status/deletion, hotel status/deletion, writes to admin-approved work days/entries, tour/stop completion-state forgery, and — found by pre-merge review of the audit's own first fix — two variants of the approved-work-day entry lock being bypassable via the incoming `work_day_uuid`). TD-004 is now closed for generic `/api/sync`. That same audit traced actual Android source and found the real production tour/stop completion path is a *different*, pre-existing route (`POST /api/sync-tours/:driverName`) which has its own narrower, separate gap — see TD-009.

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

### TD-004 - Generic sync domain invariant audit — CLOSED for `/api/sync`

Current evidence: Generic `/api/sync` now enforces authenticated driver/company scope, validates owned relations, rolls back scope-denied batches, and strips server-only activation/admin approval fields. The 2026-09-06 domain invariant audit confirmed and closed six bypasses: `costs.status` was writable via generic sync, bypassing the admin-only `/admin/update-cost-status` allow-list (now stripped); generic sync could create or mutate `cargo` rows with no admin-only creation gate and no `ADMIN_STATUS_TRANSITIONS`/terminal-state/duplicate-serial/audit-trail enforcement (now rejected entirely — `CARGO_SYNC_WRITE_NOT_SUPPORTED`); `hotels.status`/`deleted_at` were writable, bypassing `HotelEngine`'s terminal-state protection and `hotel_events` audit log (now stripped); `work_days`/`work_time_entries` could be mutated after admin approval, bypassing `APPROVED_RECORD_LOCKED`/`ADMIN_CORRECTED_RECORD_LOCKED` (now rejected as `WORK_DAY_LOCKED`); and `tours.tour_status`/`is_closed` and `stops.stop_status`/`is_completed` were writable, bypassing the cargo/hotel completion-blocking checks in `PATCH /api/tours/:id` and the dedicated stop-complete endpoint (now stripped). A full trace of Android source (every `DeltaSyncEngine`/generic-sync call site) confirmed the app never pushes `tours`, `stops`, `hotels`, `cargo`, `costs`, `drivers`, `devices`, `work_days`, or `work_time_entries` through generic sync at all — only `work_times` — so none of these guards remove any legitimate mobile capability.

A pre-merge review then found the audit's own first `work_time_entries` guard was itself bypassable, and both variants were reproduced against branch head `05f356a` before being fixed: the lock check read the **incoming** `work_day_uuid`, so (1) omitting it entirely skipped the check and let an entry under an APPROVED day be written, and (2) supplying a different open day's UUID validated that day instead, letting the entry escape its locked parent. The fix makes the **stored** parent authoritative for existing entries (`assertExistingEntryUnlocked()` resolves `existing.work_day_uuid` via `loadOwnedWorkDay()`), matching `correctEntry()` in `work-time.routes.js`, which guards on `entry.work_day_uuid`. Reparenting an existing entry is now rejected outright (`WORK_DAY_REPARENT_NOT_SUPPORTED`): no dedicated route updates an entry's `work_day_uuid`, entries are only created server-side with a server-resolved parent, and Android never pushes this entity through generic sync.

Focused regression tests in `tests/sync-domain-invariant.test.js` (12 tests) cover all of the above, each negative test confirmed to fail pre-fix, plus a positive test proving an entry under an open work day can still be updated.

Remaining evidence: none known for the generic `/api/sync` route itself. Re-open this section if a new entity or field is added to `SYNC_TABLES` without the same comparison against its dedicated route.

Risk: low — closed with evidence, not inference. Note the lesson from the `work_time_entries` variants: a lock check that reads a client-supplied relation is not a lock. For an existing row, resolve its stored relationship first.

Next evidence needed: none for this route; keep the same generic-vs-dedicated comparison habit for any future `SYNC_TABLES` addition. See TD-009 for the separate, currently-reachable gap this audit surfaced in the *actual* tour/stop sync path Android uses.

### TD-005 - Startup schema mutation remains primary schema owner

`src/database/init.js` still creates/alters/backfills schema. Treat it as migration-risk code.

### TD-006 - NDP commit correlation is incomplete

Recent production verification showed `/version` had the deployed commit, while NDP runtime metadata still lacked commit SHA.

### TD-007 - Production DB/restore evidence can be incomplete

Some integration checks may skip when local PostgreSQL is unavailable. Never count those skips as database PASS.

## Medium

### TD-008 - Historical documentation conflicts with current code

Several older docs and ZIP handover claims describe work not present in current `main`. Keep provenance, but do not use those claims as implementation evidence.

### TD-009 - Legacy tour/stop bulk sync does not re-verify cargo blocking server-side

Discovered while tracing Android source for the TD-004 follow-up (2026-09-06). Android's actual tour/stop lifecycle sync (`ToursViewModel.syncToursWithBackend()`, `DashboardViewModel.syncTours()`/`completeStop()`, `markStopArrived`/`markStopCompleted`) always goes through `POST /api/sync-tours/:driverName` → `ImportEngine.processTour`, never through generic `/api/sync`. For mobile pushes (`isMobileSync`), `ImportEngine` already applies a monotonic merge for stops (`is_completed` only `false→true`; `stop_status` locked once `COMPLETED`/`SKIPPED`) and skips the tour-level UPDATE entirely, so it is not unguarded — but it does **not** re-run the pending-cargo-pickup/delivery check (`checkCargoBlocking`, enforced server-side in the dedicated `/api/tours/:id/stops/:stopId/complete` endpoint) before accepting a client-supplied `stop_status = COMPLETED`. Today the only enforcement of "no pending cargo at this stop" is client-side, in `ToursViewModel.markStopCompleted()`/`DashboardViewModel.completeStop()`.

Risk: a modified client, a client bug, or a direct authenticated API call (bypassing the official app) could mark a stop completed via `/api/sync-tours/:driverName` while cargo pickup/delivery is still pending at that stop, with no server-side check catching it — unlike generic `/api/sync`, this route has real Android traffic today.

Next evidence needed: add a focused regression test proving the bypass on `POST /api/sync-tours/:driverName`, then add the narrowest server-side guard (reusing `checkCargoBlocking` the same way the dedicated stop-complete endpoint does) in its own follow-up change — do not combine with TD-004 work, since it is a different route.
