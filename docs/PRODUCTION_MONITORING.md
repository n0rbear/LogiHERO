# Production Monitoring

## Endpoints

- `/health`: liveness only, no database dependency.
- `/ready`: readiness, database connectivity, migration table, and required configuration.
- `/version`: deployed commit and build metadata.
- `/api/sync/version`: current sync revision observed by clients and admin.

## Alerts

Monitor these conditions:

- `/ready` non-200 for more than two consecutive checks.
- 5xx rate above normal baseline.
- Repeated `RATE_LIMITED` entries for admin login, activation or device auth.
- Sync conflict spikes.
- Backup job failure or missing daily checksum.
- Production `/version.commit` different from the expected release commit after deploy.

## Logs

Every request should carry or receive an `X-Request-Id`. Sync, smoke and rate-limit logs include enough context to trace entity, direction and result without printing tokens or raw secrets.
