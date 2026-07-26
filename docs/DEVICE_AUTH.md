# Device Auth

`/api/work-time/*` routes use device ownership checks.

Android sends:

- `X-Device-Id`
- `X-Device-Token`
- `X-Driver-UUID`

The backend verifies:

- device exists;
- device is active;
- driver is active;
- device belongs to that driver;
- SHA-256 token hash matches with timing-safe comparison.

The raw token is returned only during activation or explicit admin token rotation. It is stored by Android through `DeviceCredentialStore`, protected by Android Keystore AES/GCM. It is never logged by backend code and is not rendered in persistent admin HTML. The backend stores only `device_token_hash` and `token_rotated_at`.

Credential failures return specific states: `MISSING`, `INVALID`, `DEVICE_DISABLED`, `DRIVER_DISABLED`, or `REACTIVATION_REQUIRED`.

Admin token rotation:

```http
POST /admin/drivers/:uuid/devices/:deviceId/rotate-token
```

Only `FULL_ADMIN` may rotate. The response includes the new raw token once. The previous token is immediately invalid because its hash is replaced.
