# Database Backup and Restore

Production backups must use PostgreSQL custom format (`pg_dump --format=custom`) and a SHA-256 checksum file next to the dump.

## Local backup

```powershell
$env:BACKUP_DATABASE_URL='postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev'
npm run db:backup
```

The script writes `backups/logihero-local-<timestamp>.dump` and `<file>.sha256`. If local `pg_dump` is unavailable, it uses the `logihero-postgres-dev` Docker container.

## Local restore drill

```powershell
$env:RESTORE_FILE='backups/logihero-local-<timestamp>.dump'
$env:RESTORE_DATABASE_URL='postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_restore'
$env:RESTORE_CREATE_DATABASE='true'
$env:RESTORE_DROP_DATABASE='true'
npm run db:restore
```

The restore command validates row counts for drivers, devices, hotels, tours, work-time tables, audit data and migrations. It also verifies that stored device tokens are hashes.

## Production guardrails

Production backup requires:

```powershell
$env:BACKUP_TARGET='production'
$env:BACKUP_CONFIRM='production'
```

Production restore is blocked unless `RESTORE_TARGET=production` and `RESTORE_CONFIRM=production` are both set. Do not restore directly into production during a release drill; restore to an isolated database first.
