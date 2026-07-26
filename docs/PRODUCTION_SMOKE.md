# Production Smoke

Run:

```bash
npm run smoke:production
```

Environment:

- `SMOKE_BASE_URL`: defaults to `https://logihero-backend.onrender.com`.
- `SMOKE_EXPECTED_COMMIT`: optional expected `/version` commit.
- `PRODUCTION_SMOKE_ADMIN_TOKEN`: optional read-only admin token.

The smoke script checks `/health`, `/version`, protected admin redirects, `/admin/work-time/weekly`, and `/api/sync/version`. With a read-only token it also checks read-only admin pages and verifies a write attempt is rejected with `403`.

The script does not create, modify, export sensitive data, deactivate devices, start workdays, or write production records.
