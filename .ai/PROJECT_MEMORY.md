# Project memory

## Baseline

- Baseline date: 2026-08-09.
- Current verified commit at reconciliation start: `2e0854ddf91e87c30fcde2ca41dbbce5abff2658`.
- Repository: `n0rbear/LogiHERO`.
- Historical reference snapshot: `LogiHERO-agent-logihero-ai-operating-system-sanitized.zip`.
- Snapshot status: reference only. It contains useful `.ai` guidance and some security changes, but it also describes work from a historical agent branch that is not fully present in current `main`.

## Current architecture facts

- Backend/admin: one Express application in `server.js`, server-rendered admin HTML, PostgreSQL via `src/database/pool.js`.
- Primary driver direction: mobile-first Driver PWA using durable PostgreSQL-backed browser sessions. Android and iOS native apps are optional future location companions only.
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

### MEM-006 - POD is a core feature and signed state is immutable

Proof of Delivery / digital delivery acceptance is planned but not implemented. It is distinct from the cargo `DELIVERED` state. A future signature must cover a server-built, immutable, versioned snapshot with a content hash; any covered data change requires a new acceptance and signatures. See `docs/POD_DELIVERY_ACCEPTANCE.md`.

### MEM-007 - Driver product is PWA-first

The Driver PWA is the primary new driver client for Android, iPhone, tablet, and browser. The existing large Android app is frozen reference code. Future native companions should be thin and limited to OS capabilities such as reliable background location.

### MEM-008 - Web username is a login handle, never ownership

Driver web login uses a separate `driver_accounts` record and durable `driver_web_sessions`. Every request derives driver UUID and company UUID from the server-side session joined to the driver record. Browser-supplied names or UUIDs are never authoritative.

### MEM-009 - AI is parked

AI is parked and is not part of current LogiHERO release scope. Keep the existing isolated backend reusable, but do not add AI UI, AI release requirements, or roadmap work without a new explicit decision.
