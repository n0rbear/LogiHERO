# Production Smoke

Run:

```bash
npm run smoke:production
```

Environment:

- `SMOKE_BASE_URL`: defaults to `https://logihero-backend.onrender.com`.
- `SMOKE_EXPECTED_COMMIT`: optional expected `/version` commit.
- `PRODUCTION_SMOKE_ADMIN_TOKEN`: read-only admin token for authenticated production validation.

The smoke script checks `/health`, `/version`, protected admin redirects, `/admin/work-time/weekly`, and `/api/sync/version`. With a read-only token it also checks dashboard, drivers, hotels, tours, daily Work Time, weekly Work Time, no active read-only write buttons, and verifies a direct write probe is rejected with `403`.

If the token is missing, the script exits with code `2` unless `SMOKE_ALLOW_PARTIAL=true` is set. That result is partial, not a full production authentication pass.

The write probe stops at authorization middleware and does not create, modify, export sensitive data, deactivate devices, start workdays, or write production records.
