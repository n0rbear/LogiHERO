# Admin Roles

Sprint F introduces two admin roles:

- `FULL_ADMIN`: normal admin access, including write operations.
- `READ_ONLY`: read-only admin smoke/review access.

`ADMIN_TOKEN` creates a `FULL_ADMIN` session. `READ_ONLY_ADMIN_TOKEN` creates a `READ_ONLY` session. Tokens are environment variables only and must not be committed.

Read-only admins may view dashboard, drivers, hotels, tours and Work Time pages. Unsafe admin methods (`POST`, `PUT`, `PATCH`, `DELETE`) return `403` for read-only sessions or bearer/header token use.

Production smoke can use `PRODUCTION_SMOKE_ADMIN_TOKEN` or `READ_ONLY_ADMIN_TOKEN`; it must perform read-only checks only. Missing authenticated smoke token is a partial result, not a full pass.
