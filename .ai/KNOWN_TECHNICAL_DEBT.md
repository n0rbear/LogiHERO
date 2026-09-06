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

### TD-010 - Legacy tour sync resolved the tour by client-supplied UUID without owner scope — FIXED, pending merge

Found during the final pre-merge review of PR #5 (2026-09-06) and **reproduced against real PostgreSQL**. `ImportEngine.processTour` resolves the tour with `SELECT id, updated_at FROM tours WHERE uuid = $1` and no driver/company scope. The route only checks that the path `driverName` matches the authenticated driver; the tour named in the body is never checked against that driver. A driver who knows another driver's tour UUID can therefore have their payload applied against that tour: in the probe, Driver A transitioned Driver B's cargo from `READY_FOR_PICKUP` to `PICKED_UP`. Note the tour's own `driver_name` was not taken over, and the sibling delete path in `sync-tour.routes.js` does scope correctly with `AND driver_name = $3` — it is specifically the `processTour` lookup that is unscoped.

This is **pre-existing and not introduced by PR #5**: the lookup line is untouched by that PR, and before it the mobile path was a full cargo upsert, so PR #5 strictly narrows what a caller can do to a foreign tour (now only a legal driver transition, with creation/deletion/re-pointing refused). It is recorded separately rather than widened into PR #5's scope.

Exploitability: requires knowing a v4 tour UUID, which is not enumerable, so this is an IDOR-style gap rather than a broadly reachable one. Stops in the payload are also applied against the foreign tour.

Status (2026-09-06): **fixed on branch `claude/legacy-tour-sync-owner-scope`, not yet merged.** Re-reproduced independently against merged main `e7fe81b` before any change, driving the real route with real device authentication against real PostgreSQL. Three distinct attacks were confirmed, plus one sibling variant the earlier note had not identified:

- **Foreign tour cargo mutation** — knowing only the foreign tour UUID plus the cargo UUID, Driver A transitioned Driver B's cargo.
- **Foreign stop mutation** — with the foreign tour UUID plus the stop UUID, Driver A advanced Driver B's stop lifecycle.
- **Foreign stop creation** — the foreign tour UUID *alone* was enough to inject a brand-new stop into Driver B's tour; no child identifier was needed.
- **Child-boundary escape (new)** — even on a tour genuinely owned by the caller, a stop UUID belonging to another tour could be advanced, because the stop upsert conflicted on `uuid` globally without checking the row's `tour_id`. Same root cause: a resource named by identifier was trusted once its parent had been authorized.

Identifier sufficiency: the tour UUID alone grants injection; child UUIDs extend it to mutating existing children. Same-company and different-company callers were both confirmed refused after the fix.

Fix: the mobile route now derives an `owner` from `req.deviceAuth` alone and passes it to `processTour`, which resolves the tour and then refuses it unless `isTourOwnedBy` holds — driver UUID canonical, driver name honoured only for legacy rows with a NULL `driver_uuid`, company scope applied when both sides know their company, mirroring `ensureTourOwned`. The stop upsert gained `stops.tour_id = EXCLUDED.tour_id` so a child cannot escape its authorized parent. The sibling delete path was aligned to the same rule instead of matching on `driver_name` alone. Newly created mobile tours are stamped with the authenticated `driver_uuid`/`company_uuid`, so they are correctly scoped from the start rather than relying on the legacy name fallback.

Android compatibility: Android does legitimately create tours (`ToursViewModel.addTour`, the AI import path), so unknown UUIDs are still created rather than rejected; a payload claiming a different `driver_name` is ignored in favour of the authenticated identity. Legacy tours with a NULL `driver_uuid` remain syncable by the named owner, verified against real PostgreSQL.

Error semantics: a foreign tour is skipped silently and the sync still returns 200, so a foreign UUID is indistinguishable from an unknown one and the route gives no existence oracle. The refusal is recorded server-side with the tour id only — no driver, name or company information is returned to the client.

Remaining evidence: `tests/legacy-tour-sync-owner-scope.integration.test.js` (10 cases, real PostgreSQL) covers all four attacks, same-company and cross-company refusal, the child-boundary escape, own-tour sync, mobile tour creation with server-derived ownership, and the legacy NULL-`driver_uuid` tour. Every negative was confirmed to fail against `e7fe81b` first. **No production smoke was performed and none of this is verified against production data.**

## Medium

### TD-008 - Historical documentation conflicts with current code

Several older docs and ZIP handover claims describe work not present in current `main`. Keep provenance, but do not use those claims as implementation evidence.

### TD-009 - Legacy tour/stop bulk sync does not re-verify cargo blocking server-side

Discovered while tracing Android source for the TD-004 follow-up (2026-09-06). Android's actual tour/stop lifecycle sync (`ToursViewModel.syncToursWithBackend()`, `DashboardViewModel.syncTours()`/`completeStop()`, `markStopArrived`/`markStopCompleted`) always goes through `POST /api/sync-tours/:driverName` → `ImportEngine.processTour`, never through generic `/api/sync`. For mobile pushes (`isMobileSync`), `ImportEngine` already applies a monotonic merge for stops (`is_completed` only `false→true`; `stop_status` locked once `COMPLETED`/`SKIPPED`) and skips the tour-level UPDATE entirely, so it is not unguarded — but it does **not** re-run the pending-cargo-pickup/delivery check (`checkCargoBlocking`, enforced server-side in the dedicated `/api/tours/:id/stops/:stopId/complete` endpoint) before accepting a client-supplied `stop_status = COMPLETED`. Today the only enforcement of "no pending cargo at this stop" is client-side, in `ToursViewModel.markStopCompleted()`/`DashboardViewModel.completeStop()`.

Risk: a modified client, a client bug, or a direct authenticated API call (bypassing the official app) could mark a stop completed via `/api/sync-tours/:driverName` while cargo pickup/delivery is still pending at that stop, with no server-side check catching it — unlike generic `/api/sync`, this route has real Android traffic today.

Status (2026-09-06): **CLOSED — merged to `main` as `e7fe81b` (PR #5).** The bypass was reproduced against merged main `6a32d07` for both variants (a pending pickup and a pending delivery at the stop): the sync committed with the stop completed. `checkCargoBlocking` was extracted verbatim into `src/engines/cargo-lifecycle.js` so the dedicated stop-complete endpoint and the legacy bulk sync share one rule instead of two that can drift, and `ImportEngine.processTour` now refuses a cargo-blocked completion for mobile syncs.

Cargo-blocking semantics confirmed from source: for a given stop, cargo blocks when it is that stop's pickup and its status is `PLANNED`/`READY_FOR_PICKUP`, or when it is that stop's delivery and its status is `PICKED_UP`/`IN_TRANSIT`. `DELIVERED`, `CANCELLED`, `REJECTED`, `DAMAGED` and `MISSING` do not block per-stop completion (`DAMAGED`/`MISSING` block whole-tour completion only). Soft-deleted cargo never blocks.

Two ordering facts drove the design: cargo updates arrive *later* in the same `processTour` transaction than the stop upsert, so the check runs after the cargo sync and reads the final state — otherwise a driver who picked cargo up and closed the stop offline would be rejected when syncing both together. And Android re-sends every tour on every sync cycle, so the check only applies to stops this payload actually transitions to completed; a stop already completed server-side is left alone, which prevents a permanently failing sync if cargo is later moved back to a pending state.

A refused completion reverts only that stop to its prior state inside the same transaction and lets the rest of the sync commit, matching how this route already refuses illegal transitions through its monotonic merge, rather than failing the driver's whole tour sync. The refusal is logged and reported to NDP as `stop_completion_blocked_by_cargo`.

Composition attack (found by adversarial review of the first TD-009 fix, 2026-09-06): because the blocking check reads cargo state *after* the payload's own cargo rows are applied, the first fix could be satisfied with attacker-controlled state. Reproduced against the TD-009 branch head `d484501` — 7 of 11 adversarial cases failed, and the flagship case was reproduced against real PostgreSQL as well. A mobile payload could forge a cargo status (`READY_FOR_PICKUP` → `DELIVERED`), soft-delete blocking cargo, re-point cargo at another stop, create cargo outright, and even name a cargo UUID belonging to **another tour** and have it reassigned into the synced tour, because the upsert wrote `tour_id` from the payload with no ownership check.

Fixed in the same branch by giving the server authority over cargo: mobile payload items are no longer upserted. Only cargo already on the synced tour is addressable (`loadTourCargo`), and the only client-writable change is the cargo's own status, accepted only along a transition the dedicated driver endpoints would also allow (`isLegalDriverTransition`, backed by `DRIVER_TRANSITIONS` in `src/engines/cargo-lifecycle.js`, which `cargo.routes.js` now also uses so there is one definition). Stop links, tour, identifiers, `deleted_at` and row creation are dispatcher-owned and ignored from mobile. Accepted offline transitions write a `cargo_events` audit row, so an offline action is no less traceable than the same action taken online. Refused transitions are logged and reported to NDP as `cargo_transition_refused`.

A final independent review before merge added three parity corrections where the sync path still differed from the authoritative dedicated route: a soft-deleted cargo row could receive a transition (the dedicated route resolves cargo with `deleted_at IS NULL`), the condition fields could ride along on the wrong transition, and the audit row used the bare status instead of the dedicated route's `DAMAGED_REPORTED`/`MISSING_REPORTED` vocabulary. Each was confirmed failing before the correction.

Remaining evidence: `tests/legacy-tour-sync-cargo-blocking.test.js` (6) covers the original bypass variants; `tests/legacy-tour-sync-cargo-authority.test.js` (16) covers attacks A–F, cross-tour hijack, creation, deleted-row transitions, condition-field authority, audit-event shape, multi-cargo blocking, idempotent replay, and the legitimate offline transitions; `tests/legacy-tour-sync-cargo.integration.test.js` (real PostgreSQL, 4) covers the composition attack, the legitimate offline pickup, the deleted-row refusal, and the audit row. Every negative case was confirmed to fail before its fix. **No production smoke was performed and none of this is verified against production data.**
