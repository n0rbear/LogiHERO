# Driver PWA architecture

## Product direction

LogiHERO is PWA-first. The primary driver client is the Driver PWA, intended for current Android and iPhone browsers, tablets, and ordinary desktop browsers where useful. The existing Android application remains frozen reference code. A later Android or iOS native companion may be added only for operating-system capabilities a PWA cannot provide reliably, primarily continuous background location.

Proof of Delivery remains a core future PWA feature. A recipient is expected to review cargo and sign on the driver's phone, followed by driver confirmation over a server-built immutable, versioned snapshot. POD, tours, stops, cargo, maps, camera, costs, hotels, work time, chat, and offline synchronization are not implemented in this authentication checkpoint.

AI is parked and is not part of current LogiHERO release scope. No Driver PWA AI UI is planned. The existing modular `/api/ai/chat` backend remains isolated behind device authentication and a server-side `MISTRAL_API_KEY`; when that variable is absent, the provider operation is unavailable. No risky refactor was made solely to add another feature flag.

## Existing authentication inventory

- `drivers` is the operational driver record. Its UUID and company UUID remain authoritative; the mutable display name is not an authorization identity.
- `web_users` has no password, driver relationship, or durable session model. It was not reused for driver login.
- The legacy activation flow accepts an activation code and caller-generated device ID at `POST /api/activate-driver`, creates a random opaque device token, and stores only its SHA-256 hash in `driver_devices`.
- `requireDeviceAuth` validates `x-device-id`, `x-device-token`, and the claimed driver UUID, then replaces client identity with the database-derived `driverUuid`, `driverName`, and `companyUuid`. Existing AI, cargo, chat, cost, current-tour, history, hotel, live-update, statistics, tour, upload, work-time, legacy tour-sync, and generic-sync routes depend on this context.
- Driver devices can unlink themselves; full admins can unlink all devices or rotate a specific token. Disabled drivers/devices and rotated tokens are rejected.
- Admin browser sessions are opaque HttpOnly cookies held in process memory, with an eight-hour lifetime and per-session CSRF token. Admin bearer/header credentials also exist, including a read-only role. This model was retained for admin compatibility but not reused for drivers because it is not durable across restarts or multiple instances.
- Existing rate limiting is process-local. It is reused for login and admin credential operations with the scaling limitation recorded as technical debt.

The Android activation/device path is unchanged. It remains compatible with the frozen Android client and is a useful candidate for a later native location companion: authenticate once, receive a server-generated opaque credential, store no plaintext password, and use the existing hashed, scoped, revocable, rotatable device-token semantics for subsequent location updates.

## Driver account and session model

Migration `007_driver_pwa_auth_foundation` adds:

- `driver_accounts`: one web account per driver, a normalized globally unique username, Argon2id password hash, active flag, forced-password-change flag, and monotonic password version.
- `driver_web_sessions`: random session and CSRF token hashes, account relationship, password version, expiry, last-seen time, and revocation time/reason.

The browser receives a random `driver_session` cookie with `HttpOnly`, `SameSite=Lax`, path `/`, a 12-hour expiry, and `Secure` in deployed environments. Only its SHA-256 hash is stored. A separate non-HttpOnly `driver_csrf` cookie supplies the random CSRF value rendered into protected forms; only its hash is stored in the database. Every authenticated state-changing PWA route validates this value. Login POST additionally requires a same-host Origin or Referer. Logout revokes the database session before clearing both cookies.

Every session lookup joins account and driver records. It rejects expired/revoked sessions, password-version mismatches, disabled accounts, and inactive drivers, then derives `driver_uuid`, `company_uuid`, and display name from PostgreSQL. Request bodies, URLs, usernames, and browser-supplied UUIDs never choose ownership.

Passwords use the supported `argon2` package in Argon2id mode (19 MiB memory, two iterations, one lane). Temporary passwords are generated from cryptographic randomness, returned once on provision/reset, and never stored. Unknown user, wrong password, disabled account, and inactive driver all take a password-verification path and return the same login failure. Login is limited to eight attempts per minute per source IP.

Provisioning or resetting a password increments the password version, requires a change on next login, and revokes all current sessions. A successful first-login password change also increments the version, revokes every old session, and creates a fresh session in one transaction. Disabling web login revokes current sessions. Admin mutation routes require both admin authentication and full write authorization; read-only admins cannot use them.

## Routes and PWA shell

- `GET/POST /app/login` — login page and credential validation.
- `GET/POST /app/change-password` — mandatory temporary-password replacement.
- `GET /app` — protected mobile-first placeholder showing only the driver display name and session state.
- `POST /app/logout` — CSRF-protected durable session revocation.
- `GET /app/manifest.webmanifest` — standalone PWA metadata.
- Admin driver-detail controls — create/update username with a new temporary password, reset password, enable/disable login, and revoke sessions.

All `/app` responses receive `Cache-Control: no-store`. There is deliberately no service worker yet: aggressive offline caching before logistics conflict and privacy rules are designed could retain authenticated pages or stale operational data. No icon was invented because no reviewed suitable PWA icon asset exists in the current repository.

Optional trusted-browser registration is deferred. If added, it must use server-generated opaque identifiers without IMEI, advertising IDs, or invasive fingerprinting, and must allow multiple devices plus admin revocation.

## Migration compatibility

Migration 007 is forward-only and explicit; normal startup only verifies it. Historical migrations 001–006 and `schema-contract.js` were not edited, preserving their applied checksums. Migration 007 has its own schema checks and also re-runs the canonical schema validator so startup still detects drift in the pre-existing schema. Local backup/restore scope includes both new tables.
