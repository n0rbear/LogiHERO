# Work Time Conflicts

Work Time conflicts are stored in `work_time_conflicts`.

API:

- `GET /api/work-time/conflicts`
- `GET /api/work-time/conflicts/:uuid`
- `POST /api/work-time/conflicts/:uuid/accept-server`
- `POST /api/work-time/conflicts/:uuid/reapply-local`
- `POST /api/work-time/conflicts/:uuid/defer`

All routes require device auth and driver ownership.

Resolution states:

- `UNRESOLVED`
- `SERVER_ACCEPTED`
- `LOCAL_REAPPLIED`
- `DEFERRED`
- `MANUAL_REVIEW_REQUIRED`

Android may not overwrite:

- approved work days;
- admin-corrected records;
- soft-deleted records;
- another driver's records;
- records with newer backend revision.

Manual admin review is required for approved records, admin correction, soft-delete conflicts, and forbidden time overlaps. Conflict actions are append-only audited through `work_time_audit`.
