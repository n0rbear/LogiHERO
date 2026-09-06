# Security baseline

Current source must be inspected before relying on any claim below.

## Verified or integrated on this branch

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

## Known high-risk gaps from current source

- `POST /api/sync-tours/:driverName` (`ImportEngine.processTour`) — the route Android's tour/stop lifecycle sync actually uses — does not re-verify pending cargo pickup/delivery blocking server-side before accepting a client-supplied `stop_status = COMPLETED`. Only the Android client (`ToursViewModel.markStopCompleted()`/`DashboardViewModel.completeStop()`) checks this today. See TD-009.
- AI usage limiting is process-local and resets on backend restart; use a shared/durable limiter if deployment scales beyond one backend instance.
- NDP runtime events may miss commit SHA correlation.

## Agent rules

- Do not weaken auth, CSRF, device auth, read-only authorization, or secret scanning to satisfy tests.
- Do not expose tokens, cookies, raw API keys, device tokens, or production credentials.
- Treat Android/client secrets as exposed once shipped.
