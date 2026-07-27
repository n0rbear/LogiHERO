# Security Operations

## Read-only smoke credential

`READ_ONLY_ADMIN_TOKEN` is the production credential used by authenticated smoke checks. `PRODUCTION_SMOKE_ADMIN_TOKEN` is the runner-side copy and must not be committed.

Read-only smoke must not mutate business data. The smoke script captures a business snapshot before and after authenticated checks and fails if counts or sync revision change.

## Abuse protection

Rate limits are applied to:

- Admin login.
- Driver activation.
- Device-auth failure paths.
- Device token rotation.

## Headers

Responses include `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and a Content Security Policy. Admin responses remain no-store.

## Secret scanning

Run before release:

```powershell
npm run secret:scan
```

The scanner allows explicit local/test placeholders and blocks committed env files, private keys, database URLs with unknown credentials, admin tokens and device tokens.
