# LogiHERO Sync Protocol

## Data Model Audit

Current alignment:

- Driver: backend/admin have full profile, device activation, active status. Android uses profile DTOs rather than a Room Driver entity.
- Tour: Android, backend, and admin share UUID, driver name, route/status fields, soft delete, and timestamps. Sprint D adds `created_at`, `sync_state`, and `revision`.
- Stop: Android and backend share UUID, route/order/status, hotel stop fields, photo URL, soft delete, and timestamps. Sprint D adds `created_at`, `sync_state`, and `revision`.
- Hotel: backend/admin use `uuid`; Android historically used `publicId`. Both are treated as the public sync identity. Sprint D adds `sync_state` and `revision`.
- Cargo: Android/backend share UUID, tour link, stop UUID links, status, dimensions, soft delete, and timestamps. Sprint D adds `sync_state` and `revision`.
- Device: backend owns device activation state; Android sends `deviceId` during activation/unlink. Sprint D adds backend sync metadata.
- Work Time: Android had UUID but no timestamps, delete marker, state, or revision. Sprint D adds them.
- Costs: Android had UUID and timestamp but no created/updated/delete marker, state, or revision. Sprint D adds them.

Main remaining naming differences:

- Android camelCase maps to backend snake_case through Gson `SerializedName`.
- Hotel `publicId` remains as Android's local name for backend `uuid` in legacy hotel flows.
- Some older APIs still use `driverName`; the delta API also accepts `driver_name`.

## Delta Sync

Pull:

```http
GET /api/sync?since=<epoch_ms>
```

Returns only records whose `updated_at` or `deleted_at` is newer than `since`, grouped by entity.

Push:

```http
POST /api/sync
Content-Type: application/json

{
  "changes": {
    "drivers": [{ "uuid": "...", "name": "...", "baseRevision": 1 }]
  }
}
```

The server applies each batch transactionally. Rejected records are returned without blocking unrelated valid records. Revision conflicts block the transaction and return `409`.

## Conflict Resolution

The server uses optimistic locking:

- Client sends `baseRevision` or `revision`.
- Server compares it with the current row `revision`.
- If stale, server returns `409 SYNC_CONFLICT` with the current server row.
- Android `DeltaSyncEngine` stops push processing on 409 so the UI/repository can reload current server state before retrying.

## Logging

Every sync pull/push/conflict writes a `sync_events` row and structured log line with:

- request ID
- entity
- UUID/key
- direction
- result
- duration
