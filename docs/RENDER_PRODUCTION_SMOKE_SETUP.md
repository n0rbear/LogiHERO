# Render Production Smoke Setup

Current status: `BLOCKED_EXTERNAL_CONFIGURATION` unless the operator provides a production read-only smoke token.

Required environment variables:

- `READ_ONLY_ADMIN_TOKEN`: configured on Render for the backend service.
- `PRODUCTION_SMOKE_ADMIN_TOKEN`: configured only in the local/CI smoke runner environment.

Setup:

1. Generate a strong random token with a trusted secret generator.
2. Store it in Render as `READ_ONLY_ADMIN_TOKEN`.
3. Do not commit the token.
4. Trigger or wait for a Render deploy.
5. Set the same value locally or in CI as `PRODUCTION_SMOKE_ADMIN_TOKEN`.
6. Run:

```bash
npm run smoke:production
```

Expected full result:

```text
[SMOKE] status=FULL_PASS production authenticated read-only smoke passed
```

Rotation/revocation:

1. Replace `READ_ONLY_ADMIN_TOKEN` in Render.
2. Deploy.
3. Update CI/local secret storage.
4. Remove the old token from all secret stores.

Without `PRODUCTION_SMOKE_ADMIN_TOKEN`, public-only smoke requires explicit opt-in:

```bash
SMOKE_ALLOW_PARTIAL=true npm run smoke:production
```

That result is `PARTIAL_PUBLIC_ONLY`, not a full production pass.
