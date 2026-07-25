
# LogiHERO

LogiHERO is a standalone logistics operations project with an Android driver app, a Node.js/PostgreSQL backend, a web-based admin/driver dashboard, synchronization endpoints, and NDP diagnostics preparation.

This repository must be treated as an independent LogiHERO codebase, not as a Driver Assistant copy. Existing production URLs, database targets, Android package IDs, and external service links should only be changed after the matching LogiHERO infrastructure exists.

## Components

- Android app: Kotlin, Jetpack Compose, Room, Retrofit, Hilt, WorkManager.
- Backend/admin: Node.js, Express, PostgreSQL via `pg`.
- Admin web UI: server-rendered HTML/JavaScript in Express route modules.
- Database: PostgreSQL schema initialized by `src/database/init.js`.
- Diagnostics: NDP ingest preparation for Android and backend events.

## Local Backend

1. Copy `.env.example` to `.env`.
2. Fill `DATABASE_URL` with a local PostgreSQL connection string.
3. Keep real tokens and keys out of git.
4. Start the backend:

```powershell
npm install
npm start
```

The backend listens on `PORT` and exposes `/health`. The admin/fleet UI is served by the same backend at `/admin/` and `/`. The Tour Core list and Leaflet route map are available at `/admin/tours`.

## Android

Build with Android Studio or Gradle:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug
```

The Android backend base URL is currently provided through `NDP_BACKEND_BASE_URL` at build time. For the emulator, use `http://10.0.2.2:3000/`. For a real device, use the development machine LAN address or the future LogiHERO Render backend URL.

## Environment

Use `.env.example` as the source of required variables. Production values belong in Render, local shell variables, or local `.env` files that are ignored by git.

Key variables:

- `DATABASE_URL`
- `ADMIN_TOKEN`
- `PORT`
- `MAX_UPLOAD_BYTES`
- `NDP_PROJECT_ID`
- `NDP_APP_NAME`
- `NDP_INGEST_ENDPOINT`
- `NDP_INGEST_KEY`
- `NDP_ENVIRONMENT`
- `NDP_BACKEND_BASE_URL`
- `MISTRAL_API_KEY`

## NDP

LogiHERO needs its own NDP project identifier and ingest key. Until those exist, use placeholders only. Diagnostics must remain non-blocking: if NDP is not configured or unavailable, business features should continue to work.

Current local NDP registration:

- `NDP_PROJECT_ID=cms0g920d0001v1mom53he7pk`
- `NDP_APP_NAME=LogiHERO`
- `NDP_ENVIRONMENT=production` on Render, `development` locally

The real `NDP_INGEST_KEY` must not be committed. In the local NDP project it is stored in the ignored NDP `.env` file as `NDP_LOGIHERO_INGEST_KEY`, or it can be regenerated from the NDP ingestion settings page.

The NDP ingest contract requires both:

- `X-NDP-Project-Id`
- `X-NDP-Ingest-Key`

Android and backend events include a `component` payload field such as `android`, `backend`, `sync`, or `database`.

## Render Plan

Render layout:

- `logihero-backend`: one Node.js web service for backend APIs and the admin UI, `npm install`, `npm start`, health check `/health`.
- Database: current shared PostgreSQL database unless a deliberate migration plan approves separation.

Deployment order:

1. Create database.
2. Create backend service with LogiHERO environment variables.
3. Verify `/health`.
4. Verify `/admin/`.
5. Set Android `NDP_BACKEND_BASE_URL` to the new backend URL.
6. Configure NDP project/ingest values.
7. Only then retire or ignore old Driver Assistant URLs.

## Audit

See:

- `docs/logihero-technical-audit.md`
- `docs/shared-database-safety.md`
- `docs/admin-table-input-plan.md`
- `docs/android-application-id-plan.md`
