# Security baseline

Current source must be inspected before relying on any claim below.

## Verified or integrated on this branch

- Driver PWA passwords are Argon2id hashes in a driver-specific account table; temporary plaintext passwords are returned only at creation/reset and never persisted.
- Driver PWA sessions use HttpOnly cookies with only opaque token hashes stored in PostgreSQL, expire after 12 hours, are checked against account password version and driver/account active state, and support immediate server-side revocation.
- Driver PWA state-changing requests require a per-session CSRF token; login POST requires a same-host Origin/Referer and is process-locally rate limited with generic credential failures.
- Driver PWA identity is derived by joining the authenticated session to `driver_accounts` and `drivers`; browser-supplied driver/company identifiers cannot select ownership.
- Admin driver credential operations require FULL_ADMIN write authorization. Password reset, web-login disablement, password change, explicit revoke, and logout invalidate appropriate sessions.
- Android backend device credentials are now isolated to the configured backend origin through `BackendCredentialInterceptor`.
- The shared Mistral/OSRM OkHttp client should remain credential-free.
- Backend credential redirects are disabled for the derived backend client.
- `POST /api/sync-tours/:driverName` and `GET /api/get-tours/:driverName` require device authentication and reject path-driver mismatches.
- `POST /api/upload-photo` and `POST /api/upload-stop-photo` require device authentication and enforce authenticated driver/company ownership before unauthorized file persistence.
- Generic `GET /api/sync` and `POST /api/sync` require device authentication, scope reads/writes to the authenticated driver/company, reject relation tampering, strip server-only fields, and rollback scope-denied batches.
- Android no longer carries a privileged Mistral client, `AiAuth`, or `BuildConfig.MISTRAL_API_KEY` path in production source.
- `POST /api/ai/chat` is backend-only, requires `requireDeviceAuth`, uses server-side `MISTRAL_API_KEY`, and applies authenticated process-local AI rate limits before provider calls.
- Legacy mobile/public chat, current-tour, live-update, cost, work-time, profile/unlink, hotel, cargo, and Tour Core endpoints now require device authentication for mobile access and enforce server-derived authenticated driver/company ownership. Admin UI reads that depend on Tour/Hotel/Cargo APIs continue through admin-session compatibility.
- Mobile cost sync no longer accepts dispatcher-owned approval/payment status from the client.
- Mobile profile reads are response-minimized and no longer return activation/internal device credential fields.
- `/driver/:name` is an authenticated admin/internal dashboard, not a public share URL.
- `/api/live-status/:name`, `/api/get-history/:driverName/:date`, and `/api/stats/:driverName` allow admin/session access or authenticated device access only for the server-derived owning driver.
- `/api/fleet-status` and `/api/all-drivers` are admin-only; ordinary driver devices cannot read fleet-wide or driver-selector data.
- Every unsafe route authenticated with `requireAdmin` also requires `requireAdminWrite`, except session logout. This includes legacy cost/tour writes and development seed/reset routes, so READ_ONLY bearer credentials are rejected before database or import handlers run.
- Generic sync can no longer set `costs.status` (bypassing the admin-only payment/approval workflow), cannot create or mutate `cargo` rows at all (cargo has no mobile creation endpoint and its lifecycle is admin/dedicated-transition-only), cannot set `hotels.status`/`deleted_at` (bypassing terminal-state protection and audit logging), cannot mutate a `work_days` row or its `work_time_entries` once an admin has approved it (the entry guard resolves the entry's **stored** `work_day_uuid`, so it cannot be evaded by omitting that field or by pointing the record at a different open day, and reparenting an existing entry is refused), and cannot set `tours.tour_status`/`is_closed` or `stops.stop_status`/`is_completed` (bypassing the cargo/hotel completion-blocking checks in `PATCH /api/tours/:id` and the dedicated stop-complete endpoint). A full trace of Android source confirmed the app never pushes any of these entities through generic sync in the first place (only `work_times` is), so none of this removes legitimate mobile capability. TD-004 is closed for the generic `/api/sync` route.
- Legacy mobile bulk sync (`POST /api/sync-tours/:driverName` → `ImportEngine.processTour`) enforces the cargo-blocking rule before a stop may be completed, and treats the server as authoritative over cargo: only live cargo already on the synced tour is addressable, only its status is client-writable, and only along a transition the dedicated driver endpoints allow. Merged as `e7fe81b` (PR #5). See TD-009.
- That same route now resolves the tour under server-derived ownership, so a client-supplied tour UUID belonging to another driver is unreachable rather than trusted, its stops and cargo cannot be read or mutated, and a stop UUID from another tour cannot be advanced through an owned tour. Mobile-created tours are stamped with the authenticated driver/company. See TD-010.

## Known high-risk gaps from current source

- AI usage limiting is process-local and resets on backend restart; use a shared/durable limiter if deployment scales beyond one backend instance.
- Driver web login and admin credential-operation rate limits are process-local and reset on restart; use a shared limiter before scaling the backend horizontally.
- NDP runtime events may miss commit SHA correlation.

## Agent rules

- Do not weaken auth, CSRF, device auth, read-only authorization, or secret scanning to satisfy tests.
- Do not expose tokens, cookies, raw API keys, device tokens, or production credentials.
- Treat Android/client secrets as exposed once shipped.
