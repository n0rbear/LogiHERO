LogiHERO Sprint 1 - Tour Core impact analysis

Scope
- Only the standalone LogiHERO repository was modified.
- No NDP repository files, original Driver Assistant repository files, external SDK source, destructive database reset, DROP, TRUNCATE, or production seed were used.

Initial state
- Backend already had `tours`, `stops`, `live_updates`, Android sync, Driver Assistant-derived OSRM logic in `src/engines/status-engine.js`, and Leaflet map code in `src/routes/driver-dashboard.routes.js`.
- Android already had Room entities for `Tour` and `Stop`, stop reorder controls, external navigation intents, live location service, and offline-first local storage.
- Admin root page existed, but there was no dedicated full-fleet tour map page and no normalized Tour Core API set.

Implementation plan used
1. Reuse the existing `tours`, `stops`, `live_updates`, OSRM and Leaflet foundations.
2. Add non-destructive cache/status columns only.
3. Centralize next-stop, route and progress calculations in one backend engine.
4. Expose Tour Core APIs without duplicating existing legacy sync endpoints.
5. Extend Android models and UI with route/progress fields while preserving offline sync.

Data model changes
- `tours`: vehicle, trailer, return depot, planned/actual start/end, tour status, next stop, last driver location, planned/remaining/completed distance and duration, route polyline/status/error/calculated timestamp.
- `stops`: stop status, actual departure time, segment/cumulative distance and duration, route warning.
- Android Room moved from version 24 to 25 with a non-destructive 24_25 migration.

Route and progress rules
- Next stop is the first active stop in order that is not completed or skipped.
- Completed/skipped stops are not reopened by mobile sync.
- Route calculation uses OSRM when available and falls back to straight-line estimates if OSRM is unavailable.
- Stale driver location threshold is 15 minutes.
- Completed distance is based on completed stop segment cache; when fresh GPS exists, distance to next stop is recalculated from current position.

Sync conflict rule
- Admin payloads may replace stop order/details when they are newer.
- Mobile sync protects terminal stop states: `COMPLETED` and `SKIPPED` are not overwritten by older or less final states.
- Mobile completion is accepted even when the backend has an older timestamp race, so an offline completed stop is not silently lost.

NDP privacy rule
- New NDP events only send technical IDs, route status, counts and warning codes.
- Full addresses, phone numbers, exact coordinates, polylines, personal details and secrets are excluded.

Known sprint limits
- Native Android full map rendering was not replaced with a paid map SDK. The sprint adds an offline-readable tour route/progress summary and keeps external navigation intents.
- Geocoding is not newly introduced. Stops without coordinates are allowed and surfaced through route warnings/fallback behavior.
- Production schema changes are applied by the existing startup-safe `ALTER TABLE ADD COLUMN` path, not by a destructive migration.
