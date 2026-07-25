# LogiHERO technical audit

Date: 2026-07-25

## A. Current project state

Main components:

- Android app: `app/src/main/java/com/example/driverassistant`, Kotlin/Compose, Room, Retrofit, Hilt, WorkManager.
- Backend: `server.js` plus modular Express routes in `src/routes`.
- Web admin/driver dashboard: generated HTML/JavaScript in `src/routes/root.routes.js` and `src/routes/driver-dashboard.routes.js`.
- Database: PostgreSQL through `src/database/pool.js`; schema/bootstrap in `src/database/init.js`.
- NDP diagnostics: backend client in `src/integrations/ndp-client.js`; Android build fields in `app/build.gradle.kts`; current backend event coverage in `src/routes/cost.routes.js`.

Startup:

- Backend: `npm start`.
- Android: `.\gradlew.bat assembleDebug` or Android Studio.
- Backend health: `GET /health`.
- Admin/fleet UI: `GET /admin/` and `GET /`.

Current stack:

- Android Gradle project, Kotlin, Compose, Room, Retrofit/OkHttp, Hilt.
- Node.js, Express, PostgreSQL.
- External HTTP services: Mistral API, OSRM, OpenStreetMap Nominatim, Telegram build notification API.

## B. Driver Assistant remnants

Safe changes completed:

- `package.json`: package name changed from `driver-assistant-backend` to `logihero-backend`.
- `settings.gradle.kts`: Gradle root project name changed to `LogiHERO`.
- `README.md`: replaced empty README with LogiHERO standalone project documentation.
- `.env.example`: filled with LogiHERO-oriented placeholders.
- `settings.gradle.kts`: Android now uses the repo-local `sdks/android-agent` module instead of an absolute external NDP SDK path.
- `app/build.gradle.kts`: Android build defaults now include LogiHERO NDP project metadata and the LogiHERO backend URL.
- `src/integrations/ndp-client.js`: backend NDP events now send `X-NDP-Project-Id` and LogiHERO component metadata.
- `src/routes/health.routes.js`: `/health` now returns sanitized service/database status.
- `src/routes/dev-reset.routes.js` and `src/routes/dev-seed.routes.js`: development data reset/seed endpoints are blocked in deployed environments.
- `src/routes/root.routes.js`: admin/fleet UI is available at `/admin/` and has LogiHERO design tokens.

Documented, not changed yet:

- Android namespace/application ID: `app/build.gradle.kts` uses `com.example.driverassistant`. Changing this requires package migration and install/update strategy.
- Android source path/package declarations: files under `app/src/main/java/com/example/driverassistant` and tests under matching packages.
- Main Android class names: `DriverAssistantApp.kt`, package imports, and generated references.
- Backend comments and docs: `docs/server.md`, `docs/database.md`, `app/driverassistant terv.html`.
- Android backend default URL: `app/build.gradle.kts` now defaults `NDP_BACKEND_BASE_URL` to `https://logihero-backend.onrender.com/`.
- Template file: `DriverAssistant_tura_import_sablon.xlsx`.
- NDP Android module: `settings.gradle.kts` now references the repo-local `sdks/android-agent` copy. Longer term, this can be replaced by a versioned package or submodule if NDP becomes a separately published SDK.

## C. Connection map

Android -> backend:

- Retrofit base URL: `app/src/main/java/com/example/driverassistant/di/NetworkModule.kt` uses `BuildConfig.NDP_BACKEND_BASE_URL`.
- Endpoint contract: `app/src/main/java/com/example/driverassistant/data/api/BackendApi.kt`.
- Main Android endpoints: `/api/live-update`, `/api/sync-costs`, `/api/sync-tours/:driverName`, `/api/sync-worktimes`, `/api/sync-hotels`, `/api/sync-profile`, `/api/activate-driver`, `/api/unlink-device`, `/api/get-*`, `/api/send-chat`, `/api/upload-photo`, `/api/upload-stop-photo`.

Backend -> database:

- `src/database/pool.js` reads `DATABASE_URL`.
- `src/database/init.js` creates/extends tables at server startup.
- Core tables: `companies`, `drivers`, `web_users`, `role_permissions`, `driver_devices`, `live_updates`, `costs`, `chat_messages`, `work_times`, `hotels`, `tours`, `stops`.

Web admin -> backend:

- `src/routes/root.routes.js` uses browser `fetch` calls against same-origin `/api/*` and `/admin/*`.
- `src/routes/driver-dashboard.routes.js` uses same-origin API/admin endpoints plus OSRM and Nominatim.
- Admin write endpoints use `requireAdmin` from `src/middleware/requireAdmin.js`.

NDP:

- Backend: `src/integrations/ndp-client.js` posts to `NDP_INGEST_ENDPOINT` with `X-NDP-Ingest-Key`.
- Current backend coverage: `/api/sync-costs` request/database/response events in `src/routes/cost.routes.js`.
- Android: Gradle build fields expose `NDP_PROJECT_ID`, `NDP_APP_NAME`, `NDP_INGEST_ENDPOINT`, `NDP_INGEST_KEY`, `NDP_ENVIRONMENT`, and `NDP_BACKEND_BASE_URL`.

Render:

- Production Android backend URL is centralized through `BuildConfig.NDP_BACKEND_BASE_URL`.
- Render service IDs/config files were not present in the repo.

## D. Changes performed

Modified:

- `package.json`
- `settings.gradle.kts`
- `.env.example`
- `README.md`
- `server.js`
- `src/config/env.js`
- `src/integrations/ndp-client.js`
- `src/routes/cost.routes.js`
- `src/routes/health.routes.js`
- `src/routes/dev-reset.routes.js`
- `src/routes/dev-seed.routes.js`
- `src/routes/root.routes.js`
- `app/build.gradle.kts`
- `app/src/main/java/com/example/driverassistant/DriverAssistantApp.kt`
- `app/src/main/java/com/example/driverassistant/ui/viewmodel/CostsViewModel.kt`
- `app/src/main/java/com/example/driverassistant/MainActivity.kt`
- `app/src/main/java/com/example/driverassistant/service/LocationService.kt`
- `app/src/main/java/com/example/driverassistant/ui/screen/DashboardScreen.kt`
- `app/src/main/java/com/example/driverassistant/ui/screen/ProfileScreen.kt`
- `app/src/main/java/com/example/driverassistant/ui/screen/ToursScreen.kt`
- `app/src/main/java/com/example/driverassistant/util/IntentUtils.kt`
- `app/src/main/res/values/strings.xml`
- `app/src/pilot/res/values/strings.xml`
- `sdks/android-agent/**`

Created:

- `docs/logihero-technical-audit.md`
- `docs/ndp-integration.md`
- `docs/shared-database-safety.md`
- `docs/admin-table-input-plan.md`
- `docs/android-application-id-plan.md`

No database data was deleted. No destructive migrations were run. No production URL was changed.

## E. NDP integration state

Ready:

- Backend NDP client exists and is fail-soft.
- Backend NDP client sends `X-NDP-Project-Id` with `NDP_PROJECT_ID=cms0g920d0001v1mom53he7pk`.
- Android NDP SDK configuration supports `projectId` through the repo-local SDK.
- Cost sync backend events are prepared.
- `.env.example` now includes LogiHERO NDP placeholders: `NDP_PROJECT_ID`, `NDP_INGEST_ENDPOINT`, `NDP_INGEST_KEY`, `NDP_ENVIRONMENT`.

Needs LogiHERO-specific values:

- Real LogiHERO ingest endpoint/key for each target environment.
- Render production environment variables.
- Optional broader event coverage for admin import/export and table editing.

Recommended event groups:

- `cost_validation_failed`, `save_cost`, `sync_costs_started`, `sync_costs_finished`.
- `cost_sync_received`, `cost_sync_saved`, `cost_sync_save_failed`, `cost_sync_responded`.
- Later: admin table import/export and bulk edit lifecycle events.

## F. GitHub preparation

Current repository state:

- Git branch: `main`.
- Worktree already had existing modified/untracked files before this audit. Those were preserved.
- `.gitignore` already excludes `node_modules/`, `.env`, `.env.*`, private key files, dumps, backups, build folders, and IDE/cache files.

Secret check:

- No real key was added.
- Potential secret-bearing variables found only as env var names/placeholders: `DATABASE_URL`, `ADMIN_TOKEN`, `MISTRAL_API_KEY`, `NDP_INGEST_KEY`, Telegram token/chat ID.
- Do not commit local `.env`, database dumps, screenshots containing secrets, or Render/GitHub/NDP tokens.

Suggested repository:

- Name: `logihero`.
- First commit message: `chore: prepare LogiHERO standalone project`.

Suggested setup commands after review:

```powershell
git remote remove origin
git remote add origin https://github.com/<owner>/logihero.git
git add package.json settings.gradle.kts .env.example README.md docs/logihero-technical-audit.md
git commit -m "chore: prepare LogiHERO standalone project"
git push -u origin main
```

## G. Render plan

Services:

- Backend service: `logihero-backend`.
- Database: separate PostgreSQL database recommended; shared database only as a temporary, documented bridge.
- Admin UI is served by the same `logihero-backend` service. No separate admin Render service is required for the current plan.

Backend commands:

- Build: `npm install`
- Start: `npm start`
- Health check: `/health`
- Admin check: `/admin/`

Environment variables:

- `NODE_ENV=production`
- `PORT` from Render
- `DATABASE_URL`
- `ADMIN_TOKEN`
- `MAX_UPLOAD_BYTES`
- `NDP_PROJECT_ID`
- `NDP_INGEST_ENDPOINT`
- `NDP_INGEST_KEY`
- `NDP_ENVIRONMENT=production`

URL changes:

- After the backend exists, rebuild Android with `NDP_BACKEND_BASE_URL=https://<logihero-backend>.onrender.com/`.
- Keep Driver Assistant Render services untouched.

CORS:

- Current admin is same-origin, so CORS is not central yet.
- If admin is split into its own service, allow only the LogiHERO admin domain and required methods/headers, including `Authorization`, `X-Admin-Token`, and `X-NDP-Trace-Id`.

## H. Database evaluation

Current schema supports partial tenant separation through `company_uuid` and `driver_uuid`, but older fields still rely heavily on `driver_name`.

Risks:

- `drivers.name` is globally unique, not scoped per company.
- Several sync/read routes query by `driver_name`.
- Startup migration assigns missing records to `Demo Company`.
- Some hard deletes exist for dev/admin operations.
- Foreign keys are mostly logical, not enforced by declared FK constraints.

Temporary shared database can be used only if:

- LogiHERO has distinct companies/drivers/activation codes.
- No Driver Assistant clients point to the same backend with overlapping driver names.
- Dev reset endpoints are disabled/protected in production.
- A backup exists before any LogiHERO import/migration.

Recommended target:

- Keep the current database for this phase, with strict operational rules in `docs/shared-database-safety.md`.
- Add explicit tenant scoping to all routes before multi-tenant production use.
- Replace startup schema changes with reviewed migration files before broad production use.

## I. Table-based admin preparation

Current form-based entry points:

- Driver profile/admin: `src/routes/root.routes.js`, `src/routes/driver-dashboard.routes.js`; endpoints `/admin/save-driver`, `/api/activate-driver`, `/api/sync-profile`, `/api/upload-photo`.
- Costs: `src/routes/driver-dashboard.routes.js`; endpoints `/admin/save-cost`, `/admin/update-cost-status`, `/api/sync-costs`.
- Hotels: `src/routes/driver-dashboard.routes.js`; endpoints in `src/routes/hotel.routes.js` for sync/save/delete/read.
- Tours/stops: `src/routes/driver-dashboard.routes.js`; endpoints `/admin/save-tour`, `/admin/delete-tour`, `/admin/transfer-tour`, `/api/sync-tours/:driverName`, `/api/get-tours/:driverName`.
- Chat: `src/routes/driver-dashboard.routes.js`; endpoints `/api/send-chat`, `/api/get-chat/:driverName`.
- Work time/history: endpoints in `src/routes/worktime.routes.js` and `src/routes/history.routes.js`.

Suggested table model:

- Drivers grid: name, contact fields, license plate, active state, activation code.
- Tours grid: tour header rows with expandable stop rows.
- Stops grid: recipient/company/address/date/time window/type/contact/hotel fields.
- Costs grid: driver, amount, currency, category, mileage, status, notes, photo.
- Hotels grid: driver, name, address, room/code/booking/contact/notes.

Backend work needed:

- Bulk create/update/delete endpoints per entity.
- Row-level validation responses with stable row IDs.
- Dry-run import endpoint for CSV/XLSX.
- Transactional save with partial error reporting.
- Audit/NDP events for import, validation, save, and rollback.

Recommended save model:

- Manual batch save for tours/stops and imports.
- Optional autosave for low-risk scalar edits after validation is mature.

## J. Blocking questions

- What is the final Android application ID/package policy: keep `com.example.driverassistant` for compatibility or migrate to a LogiHERO ID?
- Is `https://logihero-backend.onrender.com/` the final Render backend URL, or should Android be rebuilt later with a different production URL?
- What is the real LogiHERO NDP ingest key for Render and Android release builds?
- Should LogiHERO use a new PostgreSQL database, a separate schema, or a temporary shared database?
- How should the external NDP Android SDK dependency be included in the new repository?

## K. Recommended next steps

1. Create or verify the LogiHERO Render backend and database, then set production env vars.
2. Decide Android package/application ID migration before publishing builds.
3. Keep the Android backend default URL aligned with the live LogiHERO backend.
4. Replace the repo-local NDP Android SDK copy with a versioned package or submodule once NDP publishes one.
5. Add route-level environment gating for dev reset/seed endpoints.
6. Design and implement bulk admin APIs before rebuilding the admin UI as tables.
7. Add a formal migration system instead of startup-only schema changes.
