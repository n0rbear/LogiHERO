# LogiHERO AI agent rules

This repository has historical agent artifacts. Treat them as evidence to verify, not as truth.

Before architectural or security changes:

1. Read the relevant files under `.ai/`.
2. Inspect current source code, tests, scripts, and recent commits before trusting documentation.
3. Never claim a feature or fix exists only because a previous agent documented it.
4. Clearly distinguish historical snapshot claims from current implementation.
5. Keep focused tasks small; avoid unrelated refactors.
6. Run relevant checks after changes and report exact commands and exit results.
7. Separate mocked tests, real PostgreSQL tests, Android JVM/build tests, emulator/device tests, Playwright tests, production smoke, and production verification.
8. Never report a skipped, blocked, mocked, or unavailable check as PASS.
9. Never weaken authentication, authorization, CSRF, device ownership, or secret scanning merely to make tests pass.
10. Never expose privileged API keys or secrets in Android/client code.
11. Preserve PostgreSQL production data by default; no destructive schema/data action without explicit instruction.
12. Keep `HANDOVER.md`, `PROJECT_MEMORY.md`, and technical debt notes synchronized with actual implementation.

Useful commands vary by task. Prefer focused checks first, then broader suites such as:

- `npm test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run typecheck`
- Android JVM/build commands when Android code changes and the environment supports them.

Production and NDP observations are diagnostic evidence only. Absence of an event is not proof of absence of a bug.
