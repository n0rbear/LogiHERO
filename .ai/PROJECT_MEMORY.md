# Project memory

## Baseline

- Baseline date: 2026-08-09.
- Current verified commit at reconciliation start: `2e0854ddf91e87c30fcde2ca41dbbce5abff2658`.
- Repository: `n0rbear/LogiHERO`.
- Historical reference snapshot: `LogiHERO-agent-logihero-ai-operating-system-sanitized.zip`.
- Snapshot status: reference only. It contains useful `.ai` guidance and some security changes, but it also describes work from a historical agent branch that is not fully present in current `main`.

## Current architecture facts

- Backend/admin: one Express application in `server.js`, server-rendered admin HTML, PostgreSQL via `src/database/pool.js`.
- Android app: Gradle Android application under `app/`, still using package/namespace `com.example.driverassistant`.
- NDP: repository-local SDK under `sdks/android-agent` plus backend client in `src/integrations/ndp-client.js`.
- Deployment evidence is checked through `/health`, `/version`, Render, tests, and NDP when available.

## Current decisions

### MEM-001 - Source code is authoritative

Documentation, handovers, walkthroughs, and task artifacts are historical unless verified in current code.

### MEM-002 - Keep changes narrow and independently reviewable

Do not combine unrelated admin, Android, sync, upload, and observability work in one change.

### MEM-003 - Preserve Android identity until a release migration is approved

Do not rename `com.example.driverassistant`, package paths, signing identity, or Room/storage continuity without a dedicated migration plan.

### MEM-004 - Backend credentials must not leak to third-party Android HTTP clients

Current reconciliation integrated a ZIP security fix that derives a backend-only OkHttp client. Device credentials are added only for the configured backend origin and are stripped from non-backend requests.

### MEM-005 - Historical `.ai` claims need reclassification

The ZIP claims many fixes as complete on a prior agent branch. In current `main`, only some are present. Future agents must classify each important claim as verified, partial, stale documentation, or not present.
