# Device Reactivation

When a device token is rotated or rejected, Android must keep local business data and pending Work Time rows.

Backend credential states:

- `DEVICE_CREDENTIAL_INVALID`
- `DEVICE_DISABLED`
- `DRIVER_DISABLED`
- `REACTIVATION_REQUIRED`

Expected client behavior:

1. Stop automatic sync spam for the rejected credential.
2. Keep Room data, including pending Work Time records.
3. Show a reactivation path instead of generic sync failure.
4. Save the new activation token through `DeviceCredentialStore`.
5. Resume sync with the new `X-Device-Token`.

The old token remains invalid because backend rotation replaces `driver_devices.device_token_hash`.
