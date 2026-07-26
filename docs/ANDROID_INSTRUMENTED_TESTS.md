# Android Instrumented Tests

Run on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android-connected-test.ps1 -AvdName NDP_E2E_API_36
```

Useful options:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/android-connected-test.ps1 `
  -AvdName NDP_E2E_API_36 `
  -GradleTask connectedAndroidTest `
  -BootTimeoutSeconds 480 `
  -LogFile build\android-connected-test.log `
  -ShutdownAfter
```

Instrumented packages:

- `credentials`: Android Keystore token storage and legacy migration.
- `network`: device headers and OkHttp redaction.
- `worktime`: Work Time Compose screen states and status actions.
- `conflicts`: conflict list, manual review, accept/reapply/defer action wiring.
- `persistence`: real Room Work Time persistence.

The suite avoids long sleeps. UI tests use Compose test synchronization; emulator boot waits use bounded polling.
