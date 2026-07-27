# Production Rollback

## Fast rollback

1. Identify the last known good commit.
2. Redeploy that commit on Render.
3. Verify `/version` reports the rollback commit.
4. Verify `/health`, `/ready`, `/admin/login`, `/admin/work-time`, `/admin/work-time/weekly`, and `/api/sync/version`.
5. Run authenticated production smoke with the read-only token.

## Database rollback

Only restore from a verified custom-format backup and only after confirming the target database. Prefer restoring into a temporary database first and comparing record counts before touching production.

## Decision rule

Rollback when production has a critical auth, sync, data integrity or availability regression that cannot be safely fixed forward within the release window.
