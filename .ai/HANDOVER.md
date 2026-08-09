# Handover

## Current checkpoint

- Date: 2026-08-09.
- Branch: `codex/logihero-ai-baseline-reconcile`.
- Objective: secure only mobile driver-photo and stop-photo upload ownership after the legacy tour sync ownership checkpoint.

## What changed in this checkpoint

- `POST /api/upload-photo` now requires device authentication and only updates the authenticated driver's own profile photo.
- `POST /api/upload-stop-photo` now requires device authentication, resolves stop and tour ownership server-side, and only updates stops owned by the authenticated driver.
- Upload file writes now happen only after authentication and ownership checks pass.
- Upload filenames are server-generated opaque names and are written with no-overwrite semantics.
- Added focused Node regression coverage for owner uploads, missing/invalid credentials, cross-driver body tampering, cross-driver stop tampering, and denial paths that must not persist files or update rows.

## Previous legacy tour sync checkpoint

- `POST /api/sync-tours/:driverName` now requires device authentication and rejects path-driver mismatches before opening a database transaction.
- `GET /api/get-tours/:driverName` now requires device authentication and rejects path-driver mismatches before reading tour data.
- `requireDeviceAuth` now exposes the authenticated driver's server-derived name and company UUID on `req.deviceAuth`.
- Added focused Node regression coverage for owner GET/POST, unauthenticated rejection, invalid credential rejection, and Driver A versus Driver B path tampering.

## Previous reconciliation checkpoint

- Added root `AGENTS.md`.
- Added current `.ai` baseline files.
- Integrated one targeted Android security fix from the ZIP: backend device credentials are isolated to a backend-only client.
- Added Android JVM tests for backend credential isolation.
- Added `.tmp/` to `.gitignore` so extracted snapshots are not accidentally committed.

## What was deliberately not integrated

- Broad backend sync authorization rewrite from the ZIP.
- Driver enrollment/activation rewrite from the ZIP.
- Legacy tour sync rewrite from the ZIP.
- Device unlink result refactor from the ZIP.

Reason: those changes are broader than this baseline checkpoint and would overwrite/refactor newer current work without enough focused validation in one safe unit.

## Required next validation

- Focused upload auth test.
- Full Node test suite.
- Integration test.
- Typecheck.
- Secret scan.
- Android JVM tests are not required unless Android source changes in this checkpoint.
