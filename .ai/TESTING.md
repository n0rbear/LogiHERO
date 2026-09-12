# Testing baseline

Report exact commands and outcomes. Do not convert blocked checks into PASS.

## Categories

- Mocked Node tests: fast route/unit tests using fake pools or mocked dependencies.
- PostgreSQL integration tests: require a real reachable local/test PostgreSQL.
- Playwright tests: browser-level admin validation.
- Android JVM tests: Gradle unit tests for app flavors.
- Android connected tests: require emulator or physical device.
- Production smoke/verification: external deployed system checks.

## Common commands

- `npm test`
- `npm run test:integration` (covers `tests/hotel.test.js`, `tests/legacy-tour-sync-cargo.integration.test.js` and `tests/legacy-tour-sync-owner-scope.integration.test.js`; all self-skip without a reachable PostgreSQL, and a skip is never a PASS)
- `npm run test:migrations` (TD-005 migration runtime against real local PostgreSQL; creates and drops its own throwaway `logihero_migration_test_*` databases and never touches the shared dev database)
- `npm run db:migrate` / `db:migrate:status` / `db:migrate:verify`
- `npm run test:e2e` (runs `db:init`, which now applies migrations rather than the old startup initializer)
- `npm run typecheck`
- `node scripts/secret-scan.js`
- Android JVM/build commands with a process-local Java/Android environment when available.

If a command skips because PostgreSQL, emulator, SDK, credentials, or external services are unavailable, state that precisely.
