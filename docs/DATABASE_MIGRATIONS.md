# Database Migrations

LogiHERO uses explicit, ordered PostgreSQL migrations under `src/database/migrations/`.

## Commands

```bash
npm run db:migrate
npm run db:migrate:status
npm run db:migrate:verify
npm run db:migrate -- --to 004_reconcile_types_and_defaults
```

- `migrate` applies pending files in filename order.
- `status` reports applied, pending, unknown, missing-metadata, gap, and checksum states without writing.
- `verify` requires the latest migration head, matching checksums, and the canonical schema contract.
- `--to` applies only through the named migration and never rolls a database backward.

The ledger stores migration ID, filename, description, SHA-256 checksum, `applied_at`, execution time, and optional application commit. A PostgreSQL advisory lock serializes migration runners. Ledger bootstrap and every migration execute in transactions. Any changed applied migration, unknown ledger entry, sequence gap, precondition failure, or schema drift fails closed.

`001_baseline_logihero_schema` is the immutable historical baseline. Migrations `002-006` create, backfill, reconcile, constrain, and validate the current canonical schema. The contract mirrors what `db:init` historically created, so `tours.date` is `BIGINT` while `work_times.date` is `TEXT`, and the three columns `init.js` declared as `FLOAT` (`live_updates.speed`, `next_stop_dist`, `tour_remaining_dist`) are `DOUBLE PRECISION`. A contract that disagrees with the real column types blocks every existing database from upgrading, so these are asserted by unit test.

## Startup

Normal `npm start` does not create, alter, seed, or backfill database objects. It calls the same read-only verification used by `/ready` and refuses to start against a stale or invalid database.

Local startup order:

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npm start
```

## Local Backup And Restore

`npm run db:backup` currently accepts localhost PostgreSQL only. It writes a custom-format, data-only archive limited to canonical LogiHERO tables, plus a SHA-256 file and manifest containing row counts, migration head, schema fingerprint, UUID/relationship checks, and sequence state.

`npm run db:restore` currently accepts only a newly created, empty localhost database whose name starts with `logihero_restore_`. It verifies the archive hash and table scope, migrates the empty target, restores data without `--clean`, then rechecks row counts, schema fingerprint, UUID/relationship integrity, and sequences.

Production backup, migration, restore, and Render `DATABASE_URL` cutover require a separate explicitly authorized run. No down migration or destructive rollback command is provided.

## Deployment sequence (Render)

Migrations are **not** run automatically when the service boots. `npm start` only verifies, so a
deploy against a database that has not been migrated refuses to serve traffic instead of
mutating schema under load. That also means several Render instances starting at once cannot
race each other into a schema change.

The intended order for a deployment that includes a migration is:

1. take a backup of the target database;
2. run `npm run db:migrate` once, as an explicit step, against the target `DATABASE_URL`;
3. deploy the application, which will verify the head and start.

If step 2 is skipped, the new instances fail readiness and the old ones keep serving. Running
step 2 from more than one place at once is safe: the advisory lock serializes runners and the
second one finds the work already applied.

Credentials come from `DATABASE_URL` in the service environment; the migration runner takes the
same connection settings as the application and needs no additional privileges beyond those
required to alter the application's own schema.

**No production migration, backup, restore or `DATABASE_URL` cutover has been performed.** The
evidence in this repository is from local PostgreSQL only.
