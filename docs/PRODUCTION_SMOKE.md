# Production Smoke

Run:

```bash
npm run smoke:production
```

Environment:

- `SMOKE_BASE_URL`: defaults to `https://logihero-backend.onrender.com`.
- `SMOKE_EXPECTED_COMMIT`: optional expected `/version` commit.
- `PRODUCTION_SMOKE_ADMIN_TOKEN`: read-only admin token for authenticated production validation.

Authenticated smoke also checks `/ready`, verifies admin pages with a bearer read-only token, confirms unsafe actions are blocked, and compares a no-write business snapshot before and after the run.

The smoke script checks `/health`, `/version`, protected admin redirects, `/admin/work-time/weekly`, and `/api/sync/version`. With a read-only token it also checks dashboard, drivers, hotels, tours, daily Work Time, weekly Work Time, no active read-only write buttons, and verifies a direct write probe is rejected with `403`.

Smoke statuses:

- `FULL_PASS`: authenticated read-only smoke passed.
- `PARTIAL_PUBLIC_ONLY`: public/protected redirect checks passed with explicit `SMOKE_ALLOW_PARTIAL=true`.
- `BLOCKED_MISSING_CREDENTIAL`: authenticated token is missing.
- `FAILED`: a check failed.

If the token is missing, the script exits with code `2` unless `SMOKE_ALLOW_PARTIAL=true` is set. That result is partial, not a full production authentication pass.

The write probe stops at authorization middleware and does not create, modify, export sensitive data, deactivate devices, start workdays, or write production records.
