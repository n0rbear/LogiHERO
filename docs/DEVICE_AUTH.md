# Device Auth

Sprint F hardens `/api/work-time/*` routes with device ownership checks.

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

The raw token is returned only during activation and is stored by Android preferences for now. It is never logged by backend code and is not rendered in admin HTML. The backend stores only `device_token_hash` and `token_rotated_at`.

Future hardening should move Android token storage to Android Keystore-backed encrypted preferences and add an explicit rotation endpoint for non-activation rotation.
