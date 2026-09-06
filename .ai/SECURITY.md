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

## Known high-risk gaps from current source

- Generic sync still needs a domain-invariant audit beyond ownership, because owner-scoped writes do not always pass through each domain route's lifecycle validation.
- AI usage limiting is process-local and resets on backend restart; use a shared/durable limiter if deployment scales beyond one backend instance.
- NDP runtime events may miss commit SHA correlation.

## Agent rules

- Do not weaken auth, CSRF, device auth, read-only authorization, or secret scanning to satisfy tests.
- Do not expose tokens, cookies, raw API keys, device tokens, or production credentials.
- Treat Android/client secrets as exposed once shipped.
