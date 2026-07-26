# Android Keystore Credential Storage

`DeviceCredentialStore` protects the driver device token with Android Keystore AES/GCM.

Storage:

- legacy plain key: `driver_prefs/device_token`;
- secure preference file: `device_credentials`;
- encrypted payload key: `device_token_encrypted`;
- Keystore alias: `logihero_device_token`.

The app migrates once at startup and during profile activation:

1. If secure credential already exists, keep it.
2. If no secure credential exists, read the legacy token.
3. Encrypt it with Android Keystore.
4. Read it back to verify the write.
5. Remove the legacy plain token only after verification.

The Retrofit interceptor reads the token only through `DeviceCredentialStore`. It redacts `x-device-token` and `authorization` in OkHttp logging.
Sprint H also redacts `cookie` and `set-cookie`, and instrumented tests verify actual log output does not contain the raw token.

Credential states used by the app/backend contract:

- `AVAILABLE`
- `MISSING`
- `INVALID`
- `REVOKED`
- `DEVICE_DISABLED`
- `DRIVER_DISABLED`
- `REACTIVATION_REQUIRED`

Credential failure must not delete local business data or pending Work Time records.
