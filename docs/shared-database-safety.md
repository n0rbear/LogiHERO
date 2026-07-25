# LogiHERO shared database safety

Date: 2026-07-25

## Scope

LogiHERO currently uses the existing PostgreSQL database. No new database was created, no production data was deleted, and no destructive migration was run during this review.

## Tables Used

Core operational tables:

- `companies`
- `drivers`
- `web_users`
- `role_permissions`
- `driver_devices`
- `live_updates`
- `costs`
- `chat_messages`
- `work_times`
- `hotels`
- `tours`
- `stops`

Supporting storage:

- uploaded files under `/uploads`
- Android local Room database on devices

## Current Separation Model

The schema has partial tenant separation:

- `company_uuid` exists on drivers and most operational tables.
- `driver_uuid` exists on driver-linked operational tables.
- `is_demo` exists on `companies`.

The application still has legacy lookup paths that depend on globally unique `driver_name`. This means LogiHERO and Driver Assistant can collide if both systems share the same database and contain the same driver names.

## Main Risks

- `drivers.name` is globally unique, not scoped by company.
- Many reads and writes still use `driver_name` without requiring `company_uuid`.
- `initDb()` runs automatically at server startup and performs `CREATE TABLE IF NOT EXISTS`, conditional `ALTER TABLE`, default demo company creation, and backfill `UPDATE` statements for missing tenant fields.
- `/admin/delete-driver` hard-deletes a driver by UUID.
- `/admin/delete-tour` and hotel delete endpoints can remove or soft-delete records without a separate tenant boundary beyond the selected record.
- `/admin/dev-reset-database` deletes all rows from core tables if called in a non-deployed environment with the confirm phrase.
- `/admin/dev-reset-demo` deletes all demo-company data.
- Demo seed uses fixed slugs and globally unique driver names.
- Upload files are not tenant-isolated at the filesystem level.

## Immediate Protection Rules

- Production and Render must always set `NODE_ENV=production`.
- Production and Render must set a strong `ADMIN_TOKEN`.
- Never expose admin endpoints without `ADMIN_TOKEN` in deployed environments.
- Do not run `/admin/dev-reset-database` against a shared or production database.
- Do not run `/admin/dev-reset-demo` unless the target data is verified as disposable demo data.
- Do not share driver names between LogiHERO and Driver Assistant while `driver_name` remains a routing key.
- Do not set a localhost NDP URL in Render.
- Do not commit `.env`, database URLs, admin tokens, Render tokens, GitHub tokens, or NDP ingest keys.
- Back up the database before any schema or tenant migration.

## Code-Level Protections Added

- Development reset and seed endpoints are now blocked in deployed environments through `IS_DEPLOYED`.
- `/health` now returns sanitized service and database status without connection strings, usernames, database names, stack traces, or SQL error text.

## Forbidden Operations

- `DROP TABLE`
- `TRUNCATE`
- `prisma migrate reset`
- destructive schema sync
- global `DELETE FROM ...` against production/shared data
- seed/reset operations against production/shared data
- force-push without explicit approval
- application ID/package migration without a release plan

## Startup Migration Risk

`src/database/init.js` is not destructive, but it is still an automatic startup schema tool. It can add columns, constraints, a default demo company, default role permissions, and backfill missing tenant fields.

Safe short-term rule:

- Allow startup schema checks only after reviewing the exact target database and taking a backup.

Safer later direction:

- Replace startup schema changes with reviewed migration files.
- Add a `RUN_SCHEMA_MIGRATIONS=true` deployment flag before any schema-changing startup code runs.
- Split tenant backfills into explicit one-time migration scripts with dry-run output.

## Future Separation Options

1. Separate LogiHERO database.
2. Separate PostgreSQL schema in the same database.
3. Shared database with strict tenant scoping on every route.

Recommended target:

- Separate LogiHERO database, or at minimum a separate schema, before broad production use.

## Safe Migration Direction

1. Inventory all records by `company_uuid`, `driver_uuid`, and `driver_name`.
2. Add route-level tenant requirements to every admin and sync endpoint.
3. Stop accepting raw `driver_name` as the only identity for writes.
4. Introduce explicit company selection in admin.
5. Build dry-run migration reports.
6. Back up production data.
7. Move LogiHERO data into a separate database or schema.
8. Repoint Render only after `/health`, `/admin/`, Android sync, and NDP ingest pass.
