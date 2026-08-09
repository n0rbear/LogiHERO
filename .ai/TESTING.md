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
- `npm run test:integration`
- `npm run test:e2e`
- `npm run typecheck`
- `node scripts/secret-scan.js`
- Android JVM/build commands with a process-local Java/Android environment when available.

If a command skips because PostgreSQL, emulator, SDK, credentials, or external services are unavailable, state that precisely.
