# Handover

## Current checkpoint

- Date: 2026-08-09.
- Branch: `codex/logihero-ai-baseline-reconcile`.
- Objective: compare the reference ZIP against current LogiHERO, preserve useful AI operating guidance, and reconcile only safe high-value changes.

## What changed in this checkpoint

- Added root `AGENTS.md`.
- Added current `.ai` baseline files.
- Integrated one targeted Android security fix from the ZIP: backend device credentials are isolated to a backend-only client.
- Added Android JVM tests for backend credential isolation.
- Added `.tmp/` to `.gitignore` so extracted snapshots are not accidentally committed.

## What was deliberately not integrated

- Broad backend sync authorization rewrite from the ZIP.
- Driver enrollment/activation rewrite from the ZIP.
- Driver photo and stop photo upload rewrites from the ZIP.
- Legacy tour sync rewrite from the ZIP.
- Device unlink result refactor from the ZIP.

Reason: those changes are broader than this baseline checkpoint and would overwrite/refactor newer current work without enough focused validation in one safe unit.

## Required next validation

- Node tests for current backend behavior.
- Android JVM tests for the new credential boundary.
- Type/syntax checks where available.
- Secret scan.
- Android build if the local Android environment supports it.
