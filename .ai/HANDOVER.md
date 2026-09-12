# Handover

## Current checkpoint

- Date: 2026-09-07.
- Branch: `claude/versioned-migration-runtime` (branched from merged main `dd22107`).
- Objective: recover the preserved TD-005 migration-runtime WIP, rebuild it on current main, and prove it against real PostgreSQL.

## What changed in this checkpoint

- The TD-005 work existed only as ~30 uncommitted entries in a local checkout based on `7c8f67e`, which predates PRs #4, #5 and #6. It was preserved before anything else: a binary-safe patch of the 19 modified tracked files plus the `init.js` deletion, and byte-exact raw copies of all 19 modified and 10 untracked files, under `LogiHERO-td005-wip-backup-20260907/`. Both were verified by reconstructing the tree in a scratch worktree and byte-comparing; the patch reproduces every file's content (differing only in line endings, which git rewrites on checkout), and the raw copies are byte-identical. The original checkout was never modified.
- The WIP applied onto current main almost cleanly, because `src/database/init.js` is byte-identical between `7c8f67e` and `dd22107` and PRs #4/#5/#6 introduced no schema changes. Only `package.json` needed a hand-merge (the WIP's migration scripts alongside main's three-file `test:integration`). The WIP's `.ai` edits were discarded rather than replayed, since main's docs have moved on considerably.
- The WIP was **not** working. Four genuine defects were found by running it, all of which would have made it unusable:
  - `array_agg(attname)` returns `name[]`, which node-postgres has no parser for, so it arrived as the string `"{uuid}"` instead of an array. Every unique-constraint comparison therefore failed, in both the validator and migration 005. Fixed by casting to `text`.
  - `normalizeDefault` did not strip a schema qualifier, so the contract's `gen_random_uuid()` never matched PostgreSQL's reported `public.gen_random_uuid()` and every uuid default looked mismatched.
  - The contract disagreed with the schema `init.js` actually creates: `live_updates.speed`, `next_stop_dist` and `tour_remaining_dist` are `FLOAT` (double precision) and `tours.date` is `BIGINT`. The contract claimed `REAL` and `TEXT`. A contract that disagrees with real column types blocks every existing database from upgrading, which is exactly what happened.
  - The WIP's own tests encoded the same wrong `tours.date` belief — the legacy fixture created it as `TEXT` and used `BIGINT` as its drift case. Both were corrected to match `init.js`, and a unit test now pins the real types.
- Proven against real PostgreSQL, not described: clean database bootstraps to head; a legacy production-shaped database upgrades forward; **the real development database created by `init.js` over the project's history (149 drivers of accumulated data) migrated cleanly to `006_validate_schema`**; a repeat run applies nothing; a failing migration rolls back and is not recorded; concurrent runners serialize on the advisory lock; checksum drift, unknown ledger rows, gaps and schema drift all fail closed.
- That real-database upgrade also surfaced the intended operator-decision case: migration 003 refused to backfill ownership because the database had one driver with no company and two companies to choose from. It aborted rather than guessing, which is the designed behavior.
- E2E now runs through the new path (`db:init` runs migrations, `db:seed`, then a server that verifies on boot) and passes 4/4 in real Chromium.

## What TD-005 changes

- `src/database/init.js` is deleted. Startup no longer creates, alters, backfills or seeds anything; `server.js` calls `verifyMigrations` and refuses to start on a stale or invalid database, and `/ready` reports the same verification.
- Schema evolution lives in `src/database/migrations/`: `001` is the immutable baseline marker already on main, `002`-`006` create the canonical schema, backfill legacy rows behind preconditions, reconcile types and defaults, add constraints and indexes, and validate the contract.
- Migration is explicit (`npm run db:migrate`), never automatic on boot, so multiple instances cannot race a schema change during deploy.

## Previous TD-010 checkpoint (merged as main `dd22107`, PR #6)

- Date: 2026-09-06.
- Branch: `claude/legacy-tour-sync-owner-scope` (branched from merged main `e7fe81b`).
- Objective: close TD-010 — the legacy mobile tour sync resolving a client-supplied tour UUID without owner scope.

## What changed in this checkpoint

- Re-reproduced TD-010 independently against merged main `e7fe81b` before changing anything, driving the real route with real device authentication against real PostgreSQL. Confirmed: foreign-tour cargo mutation, foreign-stop mutation, and foreign-stop *creation* — the last needing only the tour UUID, no child identifier.
- Found a sibling variant the original note had not identified: on a tour genuinely owned by the caller, a stop UUID belonging to another tour could still be advanced, because the stop upsert conflicted on `uuid` globally without checking `tour_id`. Same root cause — a child trusted once its parent was authorized.
- Ownership model established from source rather than copied: `req.deviceAuth` carries a server-derived `driverUuid`, `driverName` and `companyUuid`; `drivers.name` is UNIQUE but mutable, so `driver_uuid` is canonical. `ImportEngine` writes tours with `driver_name` only, so legacy rows have a NULL `driver_uuid` and must keep working — which is exactly why `ensureTourOwned`'s "UUID, else name for NULL-uuid rows, plus company" shape is the right rule to mirror.
- Fix: the route derives an `owner` from `req.deviceAuth` alone and hands it to `processTour`, which refuses any existing tour that fails `isTourOwnedBy`. The stop upsert gained `stops.tour_id = EXCLUDED.tour_id`. The sibling delete path was aligned to the same rule rather than matching on `driver_name` alone. New mobile tours are stamped with the authenticated `driver_uuid`/`company_uuid`.
- Android still creates tours locally (`ToursViewModel.addTour`, AI import), so unknown UUIDs are still created — but ownership comes from the device, and a payload claiming a different `driver_name` is ignored.
- Foreign tours are skipped silently with a 200, so the route gives no existence oracle; the refusal is logged server-side with the tour id only.
- The admin/import caller passes no `owner` and is unchanged.
- Two test-harness gaps were fixed along the way: the mocked cargo suites matched the tour lookup by its old literal SQL and their fake tour rows carried no ownership columns, so they broke once the query changed shape. Both now model rows that genuinely belong to the authenticated driver.
- Final pre-merge review added two things. The stop-revert inside the cargo-blocking guard updated a stop by uuid alone — not reachable with a foreign uuid, since the uuid can only come from the tour's own stop map, but now scoped by `tour_id` too so the write does not rely on that upstream invariant. And the delete path gained coverage, including the case that actually separates the new rule from the old: `tours.driver_name` is a denormalized copy, so a tour reassigned to B while its `driver_name` still reads A used to be deletable by A, and is now refused.
- Worth knowing for future reviews: three of the delete-path cases pass against pre-fix code as well, because the old name-only match already blocked them. They are regression guards, not proof of a fix; only the stale-`driver_name` case demonstrates the delete change.

## Previous TD-009 checkpoint (merged as main `e7fe81b`, PR #5)

- Date: 2026-09-06.
- Branch: `claude/legacy-tour-sync-cargo-blocking` (branched from merged main `6a32d07`).
- Objective: reproduce and close TD-009 — the legacy mobile bulk tour sync accepting a stop completion without re-checking pending cargo.

## What changed in this checkpoint

- Reproduced the bypass against merged main `6a32d07` before writing any fix, for both variants: a pending pickup (`READY_FOR_PICKUP`) and a pending delivery (`IN_TRANSIT`) at the stop. In both, `POST /api/sync-tours/:driverName` committed with the stop completed.
- Confirmed the cargo-blocking rule from source: cargo blocks a stop when it is that stop's pickup and is `PLANNED`/`READY_FOR_PICKUP`, or that stop's delivery and is `PICKED_UP`/`IN_TRANSIT`. `DELIVERED`/`CANCELLED`/`REJECTED`/`DAMAGED`/`MISSING` do not block per-stop completion; soft-deleted cargo never blocks.
- Extracted `checkCargoBlocking` verbatim from `tour-core.routes.js` into `src/engines/cargo-blocking.js`, now required by both the dedicated stop-complete endpoint and `ImportEngine`, so the two cannot drift into subtly different rules.
- `ImportEngine.processTour` refuses cargo-blocked completions on mobile syncs. Two ordering facts shaped this:
  - Cargo updates land *after* the stop upsert in the same transaction, so the check runs last and reads the post-sync state. A driver who picked cargo up and closed the stop offline still syncs both together.
  - Android re-sends every tour each cycle, so only stops this payload actually transitions to completed are checked; an already-completed stop is left alone and cannot start failing later if cargo returns to a pending state.
- A refused completion reverts just that stop inside the same transaction and lets the rest of the sync commit — the same philosophy as the route's existing monotonic merge — instead of failing the driver's whole tour sync. Logged and reported to NDP as `stop_completion_blocked_by_cargo`.
- Added `tests/legacy-tour-sync-cargo-blocking.test.js` (6 tests): both bypass variants (each confirmed to fail against `6a32d07`), satisfied cargo, terminal cargo, the legitimate offline pickup+complete batch, and the already-completed re-send case.
- Adversarial follow-up in the same branch: the "mobile payload can set cargo status directly" note above turned out to defeat the fix itself, because the blocking check reads cargo state *after* the payload's cargo rows are applied. Reproduced against branch head `d484501` — 7 of 11 adversarial cases failed, and the flagship case also failed against real PostgreSQL:
  - forged `READY_FOR_PICKUP` → `DELIVERED` unlocked a pickup stop; forged `CANCELLED` unlocked a delivery stop;
  - soft-deleting the blocking cargo, or re-pointing it at another stop, unlocked the stop;
  - cargo could be created outright, and a cargo UUID belonging to **another tour** could be named in the payload and reassigned into the synced tour (`tour_id` was written from the payload with no ownership check);
  - illegal lifecycle leaps were accepted even with no stop completion involved.
- Android's real cargo authority, from source: `CargoViewModel` writes the new status to Room, then calls the dedicated endpoint inside a `try/catch` that only logs on failure, with no retry queue. Android never calls `addCargo`/`updateCargo`/`deleteCargo`. So bulk sync is the only path an offline pickup/delivery ever reaches the server, and status is the only field it legitimately carries — classification C for status, A for everything else.
- Fix: mobile cargo items are no longer upserted. Only cargo already on the synced tour is addressable (`loadTourCargo`), only its status is client-writable, and only along a transition the dedicated driver endpoints allow (`isLegalDriverTransition` / `DRIVER_TRANSITIONS` in `src/engines/cargo-lifecycle.js`, which `cargo.routes.js` now uses too so there is one definition). Accepted transitions write a `cargo_events` audit row; refused ones are logged and sent to NDP as `cargo_transition_refused`. Ordering is unchanged and is what preserves the distinction: legal transitions land first, so a genuine offline pickup still unblocks its stop, while a forged one never changes stored state and the stop stays blocked.
- `src/engines/cargo-blocking.js` was renamed to `src/engines/cargo-lifecycle.js` now that it owns both the blocking rule and the driver transition table.
- Final independent review before merge found three remaining divergences from the dedicated route and corrected them: a soft-deleted cargo row could still be transitioned, the condition fields could ride along on the wrong transition, and the audit row used the bare status rather than `DAMAGED_REPORTED`/`MISSING_REPORTED`. Coverage was extended to multi-cargo blocking, idempotent replay, condition-field authority and audit-event shape, and the deleted-row invariant was given real-PostgreSQL evidence rather than mock-only.
- That review also caught a vacuous test of its own making: the mock had enforced the `deleted_at` filter itself, so the test passed with or without the production fix. The mock now applies that filter only when the statement actually contains it, and the test was re-confirmed to fail before the fix.
- Partial-acceptance semantics were reviewed and kept: a refused stop completion reverts only that stop inside the transaction while the rest of the sync commits. Android ignores the response body and pulls server state on the same cycle (`syncTours` pushes then calls `getTours` → `syncRemoteTours`), so divergence self-heals deterministically. A hard failure would instead block the driver's entire tour sync on one bad stop. The trade-off is that the response does not name which record was refused; the refusal is visible in logs and NDP only.
- Open and deliberately not fixed here: `processTour` resolves the tour by client-supplied UUID without owner scope (TD-010) — pre-existing, reproduced against real PostgreSQL, narrowed by this work but not closed.

## Previous TD-004 checkpoint (merged as main `6a32d07`, PR #4)

- Date: 2026-09-06.
- Branch: `claude/sync-domain-invariant-audit`.
- Objective: verify a pre-merge review finding that the `work_time_entries` approved-work-day guard added earlier in this branch was itself bypassable, and close it before TD-004 may be claimed complete.

## What changed in this checkpoint

- **Both reported bypasses reproduced against the then-current branch head `05f356a`** with regression tests written first. In both cases the push completed with `result=ok` and the row was written, with nothing in `rejected`:
  - **Case 1 (omitted parent):** the lock check lived only in `assertOwnedRelations`, gated on `if (workDayUuid && …)` reading the *incoming* record. A client updating an existing entry that belongs to an APPROVED day simply omitted `work_day_uuid`, the gate never fired, and the remaining fields were written through the `ON CONFLICT` update.
  - **Case 2 (parent substitution):** supplying a *different, open* day's UUID made the check validate that open day instead of the entry's real parent, so the entry escaped its locked day and was reparented.
  - Root cause for both: the guard trusted a client-supplied relation to decide whether an existing row was editable, and never consulted `existing.work_day_uuid`.
- Checked the dedicated route before choosing the fix: `correctEntry()` in `src/routes/work-time.routes.js` guards with `assertAndroidMayWriteWorkDay(client, req, entry.work_day_uuid, …)` — the **stored** parent — and scopes its overlap check, audit and recalc to `entry.work_day_uuid` as well. Its UPDATE never touches `work_day_uuid`, and entries are only ever created server-side (`start-day`, `change-status`) with a server-resolved parent. So no dedicated contract permits reparenting an existing entry.
- Fix in `src/routes/sync.routes.js`, narrow and mirroring that contract:
  - Extracted `loadOwnedWorkDay()` (single owner-scoped work-day lookup, reused by both call sites).
  - Added `assertExistingEntryUnlocked()`: for an existing `work_time_entries` row it resolves `existing.work_day_uuid`, rejects `WORK_DAY_LOCKED` if that stored parent is approved/admin-corrected, and rejects `WORK_DAY_REPARENT_NOT_SUPPORTED` if the incoming record points at a different parent. The stored relationship is now authoritative; the incoming relation is still validated separately in `assertOwnedRelations` (which is what covers newly created entries).
- Added 4 focused regression tests (12 total in `tests/sync-domain-invariant.test.js`): omitted-parent, reparent-out-of-locked-day, reparent-between-two-open-days (isolating the new error code), and a positive test proving a legitimate entry under an open work day can still be updated. The three negative tests were each confirmed to fail against `05f356a` and pass after the fix.
- TD-004 was **not** fully closed at `05f356a`; it is claimed closed only as of this checkpoint, now that the regression is covered.

## Previous tours/stops checkpoint

- Date: 2026-09-06.
- Branch: `claude/sync-domain-invariant-audit`.
- Objective: resolve the two TD-004 items left open by the previous checkpoint (`tours.tour_status`/`is_closed`, `stops.stop_status`/`is_completed`) by tracing actual current Android source, not by inferring compatibility risk from documentation.

## What changed in this checkpoint

- Traced every Android call site that can write `tour_status`/`is_closed`/`stop_status`/`is_completed` and every call site of `DeltaSyncEngine` (the client for generic `/api/sync`):
  - `DeltaSyncEngine.sync()` is called from exactly one place, `DashboardViewModel.syncWithBackend()`, and only ever with `work_times` as the payload key. No Kotlin source anywhere constructs a `pendingChanges` map containing `tours`, `stops`, `hotels`, `cargo`, `costs`, `drivers`, `devices`, `work_days`, or `work_time_entries`.
  - Tour/stop lifecycle sync (`ToursViewModel.syncToursWithBackend()`, `DashboardViewModel.syncTours()`, `markStopArrived`/`markStopCompleted`/`arriveStop`/`completeStop`) exclusively calls `backendApi.syncTours(driverName, toursWithStops)` — the separate legacy `POST /api/sync-tours/:driverName` route (`ImportEngine.processTour`) — never the generic sync engine.
  - `ImportEngine.processTour`'s mobile-sync branch (`isMobileSync`) already skips the `tours` UPDATE entirely for existing tours (so mobile can't overwrite `is_closed`/`tour_status` on an existing tour through that route either) and applies a monotonic merge for stops (`is_completed` only `false→true`; `stop_status` locked once `COMPLETED`/`SKIPPED`). It does **not**, however, re-check cargo-pickup/delivery blocking server-side before accepting a client-supplied `stop_status = COMPLETED` — the client-side check in `ToursViewModel.markStopCompleted()`/`DashboardViewModel.completeStop()` is the only enforcement. This is a real gap, but it is in `sync-tour.routes.js`/`ImportEngine`, not in the generic `/api/sync` route this task (TD-004) covers — flagged below as a new out-of-scope follow-up, not fixed here.
  - `tours.tour_status` has no write path at all in `ImportEngine` (its INSERT/UPDATE statements never reference that column); it can currently only change through the admin `PATCH /api/tours/:id` (cargo/hotel-completion-blocking enforced) or the backend's own `refreshProgress` logic.
- **Classification: A (safe to block now) for both remaining items**, with respect to generic `/api/sync` specifically — no current Android behavior, offline or online, depends on pushing these fields through it.
- Extended `ENTITY_LOCKED_FIELDS` in `src/routes/sync.routes.js` with `tours: ['tour_status', 'is_closed']` and `stops: ['stop_status', 'is_completed']` (same field-stripping pattern already used for `costs`/`hotels`).
- Added 2 focused regression tests to `tests/sync-domain-invariant.test.js` (8 total in that file now), each confirmed to fail against the pre-fix code and pass after the fix via a temporary revert-and-rerun.
- New follow-up identified (not fixed here, out of TD-004's generic-sync scope): `POST /api/sync-tours/:driverName` → `ImportEngine.processTour` does not re-verify cargo pickup/delivery blocking server-side before accepting `stop_status = COMPLETED` from a mobile payload; only the Android client checks this today. This is the actual production-reachable version of the "stop completion bypasses cargo blocking" risk, since this is the route the app really uses.

## Previous generic sync domain invariant audit checkpoint

- Date: 2026-09-06.
- Branch: `claude/sync-domain-invariant-audit`.
- Objective: audit whether authenticated, owner-scoped generic `/api/sync` writes can bypass a dedicated domain route's business rules (TD-004), and close any confirmed bypass with the narrowest safe guard.

## What changed in this checkpoint

- Built a full inventory of every entity generic `/api/sync` can create/update/delete (`drivers`, `tours`, `stops`, `hotels`, `cargo`, `devices`, `work_times`, `work_days`, `work_time_entries`, `costs`) and compared each against its dedicated route(s) and business-rule engine. Ownership scoping was already closed by the prior generic sync checkpoint; this audit targeted non-ownership invariants (status/lifecycle fields, admin-only creation gates, audit trails, approval locks).
- Confirmed bypasses, all reachable by a device-authenticated driver acting only within their own owner scope:
  - `costs.status` — generic sync could set a cost's approval/payment status directly, bypassing the admin-only `/admin/update-cost-status` allow-list. The legacy mobile cost-sync endpoint already blocks this same write; the generic path did not.
  - `cargo` (all writes) — cargo has no mobile creation endpoint at all (creation is `requireAdmin`-only), yet generic sync let a driver create arbitrary cargo rows in their own tour. Existing cargo could also have `status`/`deleted_at` set directly, bypassing `ADMIN_STATUS_TRANSITIONS`, the terminal-state override requirement, the "cannot delete cargo already in transit" rule, the duplicate-serial check, and the entire `cargo_events` audit trail.
  - `hotels.status` / `hotels.deleted_at` — generic sync could set hotel status directly, bypassing `HotelEngine.transitionHotelStatus`'s terminal-state protection (`CHECKED_OUT`/`CANCELLED` require an override reason) and `hotel_events` audit logging, and could soft-delete a hotel even though mobile has no dedicated hotel-delete endpoint.
  - `work_days` / `work_time_entries` — generic sync could still upsert a work day the admin already approved (or an entry under one), bypassing the `APPROVED_RECORD_LOCKED` / `ADMIN_CORRECTED_RECORD_LOCKED` guard the dedicated correction endpoint enforces.
- Fixes applied in `src/routes/sync.routes.js`, all narrow field/entity guards (no rewrite of the generic sync engine, no duplicated state-machine logic):
  - `ENTITY_LOCKED_FIELDS`, parallel to the existing `SERVER_ONLY_FIELDS` pattern, strips `costs.status` and `hotels.status`/`hotels.deleted_at` from client-writable fields.
  - Every `cargo` push is now rejected with `CARGO_SYNC_WRITE_NOT_SUPPORTED`; cargo lifecycle must go through the dedicated admin CRUD and driver transition endpoints. `GET /api/sync` reads are unaffected.
  - `isWorkDayLocked()` gates writes to a `work_days` row that is `APPROVED` or admin-corrected, and to any `work_time_entries` row whose parent work day is locked (extends the existing work-day-ownership relation query rather than adding a new one), both rejected as `WORK_DAY_LOCKED`.
- Left open, documented but not implemented (see TD-004): `tours.tour_status`/`is_closed` can still bypass the cargo/hotel completion-blocking check in `PATCH /api/tours/:id`, and `stops.stop_status`/`is_completed` can still bypass the cargo-blocking check in the dedicated stop-complete endpoint. Both were left unfixed because blocking either field risks breaking a legitimate offline-first mobile completion flow that could not be confirmed or ruled out from backend source alone.
- Added `tests/sync-domain-invariant.test.js` (6 tests). Each was confirmed to fail against the pre-fix code and pass after the fix via a temporary revert-and-rerun, not just written and assumed to be correct.

## Previous admin write authorization checkpoint

- Date: 2026-09-06.
- Branch: `codex/admin-write-authorization-closure`.
- Objective: close every remaining READ_ONLY authorization gap on unsafe routes authenticated with `requireAdmin`.

## What changed in this checkpoint

- Added `requireAdminWrite` to legacy admin cost creation/status writes and tour save/delete/transfer writes.
- Added `requireAdminWrite` to development seed/reset writes in addition to their existing deployed-environment block.
- Session logout remains the only intentional unsafe `requireAdmin` route without `requireAdminWrite`; it destroys only the caller's own admin session.
- Added focused route-level coverage proving all nine corrected routes accept a FULL_ADMIN cookie session with valid CSRF, reject READ_ONLY bearer credentials with `403` before database/import handlers, and reject cookie sessions without CSRF before mutation.
- Added a source inventory regression that fails if a future POST/PUT/PATCH/DELETE route uses `requireAdmin` without `requireAdminWrite`, except logout.

## Previous dashboard telemetry checkpoint

## What changed in this checkpoint

- The remaining dashboard telemetry routes were classified as private/internal operational dashboard surfaces, not public share links. No current source or docs showed a share-token product model.
- `/driver/:name` now requires existing admin authentication. It is treated as an internal web dashboard, not a public driver-name URL.
- `/api/live-status/:name`, `/api/get-history/:driverName/:date`, and `/api/stats/:driverName` now allow admin/session access or authenticated device access only for the server-derived owning driver.
- `/api/fleet-status` is admin-only. An ordinary authenticated driver device cannot read fleet-wide status.
- `/api/all-drivers`, used by the dashboard driver selector, is admin-only and response-minimized to driver selector fields.
- Live-status SQL no longer selects raw `live_updates.*`; it returns only the dashboard fields needed by the current UI.
- Added focused dashboard/telemetry regression coverage for unauthenticated rejection, cross-driver denial, ordinary-device fleet denial, admin access, and payload minimization.
- This closes the remaining CRITICAL legacy mobile/public authorization item in the current endpoint inventory. Remaining high risks are non-ownership follow-ups: domain invariant review, durable rate limiting, NDP commit correlation, startup schema mutation, production DB evidence, and public upload file lifecycle.

## Previous mobile/public endpoint checkpoint

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
