# Work Time

## Data Model

Sprint E adds a synchronized operational Work Time module around two primary records:

- `work_days`: one driver work shift for one date, optionally linked to a tour.
- `work_time_entries`: one status interval inside a work day.
- `work_time_audit`: append-only history for lifecycle, correction and approval events.

Legacy `work_times` remains supported for existing Android and reporting flows. It now carries the same sync metadata plus `work_day_uuid`, technical `status`, `duration_ms`, `source`, `manual_edit`, `correction_reason` and `approval_status`.

## Statuses

The stable API/database statuses are:

- `WORK`
- `DRIVING`
- `BREAK`
- `REST`
- `AVAILABILITY`
- `OFFLINE`

Display labels are local UI concerns. Legacy Hungarian values are normalized at the backend boundary.

## Lifecycle

The normal lifecycle is:

1. `POST /api/work-time/start-day`
2. `POST /api/work-time/change-status`
3. `POST /api/work-time/end-day`

A driver can have only one open work day. Status changes close the previous open entry and open a new one unless the new status is `OFFLINE`.

## Offline Behavior

Android continues to save Work Time records to Room first. Local edits use `syncState = PENDING`; the delta sync engine later pushes changed records through Sprint D's `/api/sync` infrastructure with retry and backoff.

## Sync

Work Time participates in delta sync through:

- `work_times`
- `work_days`
- `work_time_entries`

All synchronized records use `updated_at`, `deleted_at`, `sync_state` and `revision`.

## Conflict Handling

The backend uses optimistic locking. Stale `revision` or `baseRevision` values return `409 Conflict`; clients should reload the server version and show a conflict state instead of overwriting.

## Admin Correction and Approval

Admins review Work Time at:

- `/admin/work-time`
- `/admin/work-time/:uuid`

Corrections require a reason, validate overlap and preserve the previous value in `work_time_audit`.

Approval statuses:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `CORRECTION_REQUIRED`

## Summaries

Backend summaries are recalculated from entries. The module tracks total active time, driving time, break, rest, availability, manual corrections and operational anomaly flags.

## Time Zones

Stored timestamps are UTC epoch milliseconds. API clients may send ISO 8601 timestamps. Admin and Android render local time. Duration calculations use epoch milliseconds, so DST transitions do not produce negative or duplicated durations.

## Known Limits

This is an operational work time module. It does not claim full EU tachograph, payroll, HR or legal compliance.
