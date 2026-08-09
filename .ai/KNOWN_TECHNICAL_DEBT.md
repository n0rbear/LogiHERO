# Known technical debt

Severity reflects current repository evidence as of 2026-08-09.

## Critical

### TD-001 - Incomplete mobile/public API authorization

Current evidence: `POST /api/sync-tours/:driverName` and `GET /api/get-tours/:driverName` now require `requireDeviceAuth` and reject a path `driverName` that differs from the authenticated driver's server-derived name. `GET /api/sync` and `POST /api/sync` also require device authentication, scope reads/writes to the authenticated driver/company, reject cross-driver/cross-company payload tampering, and rollback generic sync batches on scope denial. Focused regression tests prove missing/invalid credentials, unknown/revoked device handling, cross-driver path changes, generic sync read/write/create/delete denial, relation tampering denial, and no partial unauthorized generic sync batch writes.

Remaining evidence: Several other legacy mobile routes still expose broad data or accept caller-controlled driver identity. The reference ZIP documents stronger fixes, but most of those backend changes are not present in current branch.

Risk: cross-driver data disclosure or mutation.

Next evidence needed: endpoint matrix, authenticated owner checks, response minimization, and negative tests for every remaining sensitive legacy route outside legacy tour sync, generic sync, and photo uploads.

### TD-002 - Remaining public upload and file lifecycle audit

Current evidence: `POST /api/upload-photo` and `POST /api/upload-stop-photo` now require `requireDeviceAuth`. Driver profile photo uploads only update the authenticated driver's row. Stop photo uploads resolve the stop and tour server-side, enforce authenticated driver and company ownership, and reject caller-controlled identity mismatches before file writes. Focused tests prove missing/invalid credentials, Driver A versus Driver B tampering, and denied requests with no file persistence or row update.

Remaining evidence: Other public/mobile routes still need a full endpoint-by-endpoint authorization audit, and the broader public file retention/cleanup policy is not yet documented as a complete lifecycle model.

Risk: residual caller-selected identity writes on other endpoints and orphaned public files outside the newly protected denied-upload paths.

Next evidence needed: endpoint matrix for remaining public/mobile routes and a file lifecycle policy for public uploads.

### TD-003 - Mistral provider access is server-side; production smoke/rate limiting remains

Current evidence: Android no longer defines `BuildConfig.MISTRAL_API_KEY`, no longer contains `AiAuth`, no longer provides a direct Mistral Retrofit client, and no longer calls `api.mistral.ai` from production app source. Android AI call sites use authenticated `BackendApi.chatWithAi`. Backend `POST /api/ai/chat` requires `requireDeviceAuth`, uses server-side `MISTRAL_API_KEY`, rejects missing credentials safely, bounds upstream calls with a timeout, and returns only app-level content. Focused Node and Android JVM tests cover this boundary.

Remaining evidence: No real Mistral provider smoke was run in this checkpoint, and there is not yet a dedicated per-driver/company AI usage rate limit or billing guard beyond existing device authentication.

Risk: provider availability/configuration drift and authenticated abuse volume.

Next evidence needed: production provider smoke with a non-sensitive prompt and a small authenticated rate-limit/usage policy for `/api/ai/chat`.

## High

### TD-004 - Remaining domain-specific sync invariant audit

Current evidence: Generic `/api/sync` now enforces authenticated driver/company scope, validates owned relations, rolls back scope-denied batches, and strips server-only activation/admin approval fields.

Remaining evidence: Generic writes still upsert allowed owner-scoped entities directly rather than routing every mutation through each domain route's full validation/audit workflow. Additional domain-by-domain review is still needed for non-ownership invariants such as cargo transitions, hotel lifecycle, and work-time approval semantics.

### TD-005 - Startup schema mutation remains primary schema owner

`src/database/init.js` still creates/alters/backfills schema. Treat it as migration-risk code.

### TD-006 - NDP commit correlation is incomplete

Recent production verification showed `/version` had the deployed commit, while NDP runtime metadata still lacked commit SHA.

### TD-007 - Production DB/restore evidence can be incomplete

Some integration checks may skip when local PostgreSQL is unavailable. Never count those skips as database PASS.

## Medium

### TD-008 - Historical documentation conflicts with current code

Several older docs and ZIP handover claims describe work not present in current `main`. Keep provenance, but do not use those claims as implementation evidence.
