# Database Migrations

Sprint F adds a small versioned migration runner:

- migration files: `src/database/migrations/`
- tracking table: `schema_migrations`
- command: `npm run db:migrate`

The current production-compatible schema is recorded by `001_baseline_logihero_schema`. Existing `db:init` remains the idempotent bootstrap and compatibility initializer. `db:migrate` records ordered migration files and never marks a failed migration as successful.

Use order:

```bash
npm run db:up
npm run db:init
npm run db:migrate
npm run db:seed
```

No destructive rollback is implemented. Do not delete or rename production columns without a reviewed data migration.
