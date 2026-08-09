# Known technical debt

Severity reflects current repository evidence as of 2026-08-09.

## Critical

### TD-001 - Incomplete mobile/public API authorization

Current evidence: `POST /api/sync-tours/:driverName` and `GET /api/get-tours/:driverName` now require `requireDeviceAuth` and reject a path `driverName` that differs from the authenticated driver's server-derived name. Focused regression tests prove missing/invalid credentials and cross-driver path changes fail before data access or transaction start.

Remaining evidence: `src/routes/sync.routes.js` and several other legacy mobile routes still expose broad data or accept caller-controlled driver identity. The reference ZIP documents stronger fixes, but most of those backend changes are not present in current branch.

Risk: cross-driver data disclosure or mutation.

Next evidence needed: endpoint matrix, authenticated owner checks, response minimization, and negative tests for every remaining sensitive legacy route.

### TD-002 - Driver and stop photo upload authorization is still incomplete

Current evidence: `src/routes/upload.routes.js` still trusts body `uuid`, `driverName`, and `stopUuid` before strong authenticated ownership checks. The reference ZIP contains claimed fixes and tests, but current code does not match those claims.

Risk: caller-selected identity writes and public file lifecycle ambiguity.

### TD-003 - Privileged Mistral key is still embedded into Android BuildConfig

Current evidence: `app/build.gradle.kts` writes `MISTRAL_API_KEY` into `BuildConfig`; `app/src/main/java/com/example/driverassistant/util/AiAuth.kt` turns it into a bearer header.

Risk: distributed APK extraction, abuse, cost exposure, and uncontrolled AI data boundary.

## High

### TD-004 - Generic delta sync can bypass domain invariants

Even when ownership is improved, generic writes can bypass route-specific business rules, audit events, transitions, and approval workflows unless each entity has an approved sync contract.

### TD-005 - Startup schema mutation remains primary schema owner

`src/database/init.js` still creates/alters/backfills schema. Treat it as migration-risk code.

### TD-006 - NDP commit correlation is incomplete

Recent production verification showed `/version` had the deployed commit, while NDP runtime metadata still lacked commit SHA.

### TD-007 - Production DB/restore evidence can be incomplete

Some integration checks may skip when local PostgreSQL is unavailable. Never count those skips as database PASS.

## Medium

### TD-008 - Historical documentation conflicts with current code

Several older docs and ZIP handover claims describe work not present in current `main`. Keep provenance, but do not use those claims as implementation evidence.
