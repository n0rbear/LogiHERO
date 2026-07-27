# Release Gate

Run locally before pushing a release candidate:

```powershell
npm run release:gate
```

Run the production release gate after the production smoke token is available:

```powershell
$env:PRODUCTION_SMOKE_ADMIN_TOKEN=(Get-Clipboard)
$env:RESTORE_FILE='backups/logihero-local-<timestamp>.dump'
$env:RESTORE_DATABASE_URL='postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_restore'
$env:RESTORE_CREATE_DATABASE='true'
$env:RESTORE_DROP_DATABASE='true'
npm run release:gate:release
```

The gate checks git state, whitespace, secrets, typecheck, unit tests, integration tests, Playwright, Android JVM tests, migration drift, optional restore drill and production smoke.

Valid final states are:

- `RELEASE_READY`
- `RELEASE_READY_WITH_EXTERNAL_MONITORING_SETUP`
- `BLOCKED_MISSING_PRODUCTION_CREDENTIAL`
- `BLOCKED_BACKUP_RESTORE`
- `BLOCKED_TEST_FAILURE`
- `BLOCKED_PRODUCTION_DEPLOY`
