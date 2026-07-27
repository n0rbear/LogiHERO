# LogiHERO Release Readiness

## Security

- Admin writes require authenticated session, CSRF token, and non-read-only role.
- Device API calls require `x-driver-uuid`, `x-device-id`, and `x-device-token`.
- Device tokens are stored hashed in PostgreSQL and encrypted with Android Keystore on device.
- Token rotation invalidates the previous device token immediately and shows the replacement token once.
- Production smoke tokens must be configured as secrets and must not be printed in traces, screenshots, or reports.

## Authentication

- Admin auth supports `FULL_ADMIN` and `READ_ONLY` roles.
- Read-only admin can view Dashboard, Drivers, Hotels, Tours, Work Time, Weekly review, and exports are blocked where the backend marks the action unsafe.
- Android activation requires a backend activation code and a returned device token.
- Android refuses half-activation when the token is missing, storage fails, the backend times out, or the server response is invalid.

## Device Lifecycle

- New device activation creates or updates `driver_devices`.
- Device token rotation records `DEVICE_TOKEN_ROTATED` in audit history.
- Android marks `REACTIVATION_REQUIRED` on 401/403 sync failures and keeps Room data and pending Work Time changes.
- Re-activation stores the new token and resumes sync eligibility without clearing local records.

## Sync

- Delta sync continues to use UUID, revision, `sync_state`, and soft delete fields.
- `409 Conflict` is reserved for optimistic-locking conflicts.
- 401/403 credential failures stop sync and move the client to reactivation state.
- Partial success remains visible via rejected records in sync responses.

## Work Time

- Work Time conflict detail shows local value, server value, local revision, backend revision, approval status, admin correction, timestamps, and reason.
- Actions are `Accept Server`, `Reapply Local`, and `Defer`.
- Approved, corrected, soft-deleted, and overlap conflicts require manual review for local reapply.

## Admin

- Driver detail exposes token rotation only to writable admins.
- New token is displayed once in the current page session and disappears after refresh.
- Read-only direct POST attempts are expected to return 403.

## Production Smoke

- Public production smoke covers `/health`, `/version`, `/admin/login`, `/admin/work-time`, `/admin/work-time/weekly`, and `/api/sync/version`.
- Authenticated smoke requires `PRODUCTION_SMOKE_ADMIN_TOKEN`.

Sprint J release readiness additionally requires a verified backup/restore drill, migration drift validation, secret scan, security header regression checks and production `/version` confirmation.
- If the token is absent, report `BLOCKED_EXTERNAL_CONFIGURATION`, not success.

## Backup

- Back up PostgreSQL before deploys that include migrations.
- Keep `drivers`, `driver_devices`, `work_days`, `work_time_entries`, `work_time_conflicts`, and `work_time_audit` in the same backup set.

## Restore

- Restore database first, then restart backend with the matching commit.
- Verify `/version` commit after restore.
- Run public smoke and a read-only admin browser pass before enabling write operations.

## Monitoring

- Watch logs for `DEVICE_TOKEN_ROTATED`, `SYNC_CONFLICT_CREATED`, `SYNC_CONFLICT_RESOLVED`, `DEVICE_CREDENTIAL_INVALID`, and `REACTIVATION_REQUIRED`.
- Track 401/403 spikes after token rotations.
- Track Work Time conflict count and unresolved conflict age.

## Known Limitations

- Authenticated production smoke is blocked until `PRODUCTION_SMOKE_ADMIN_TOKEN` is configured in the execution environment.
- Android reactivation currently uses the same activation-code flow rather than a separate QR code flow.
- Performance notes include recommended `EXPLAIN ANALYZE` commands; exact production timings must be captured against production-sized data.
