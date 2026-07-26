# LogiHERO Local Development

This guide starts the backend with a reproducible local PostgreSQL database and real browser validation.

## Environment

Copy `.env.example` to `.env` for local work and keep production secrets out of git.

Required local values:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev
ADMIN_TOKEN=local-dev-admin-token
APP_COMMIT_SHA=local
APP_BUILD_TIME=unknown
```

## Database

Start PostgreSQL:

```bash
npm run db:up
```

Initialize the schema:

```bash
npm run db:init
```

Record versioned migrations:

```bash
npm run db:migrate
```

Load idempotent development data:

```bash
npm run db:seed
```

Stop PostgreSQL:

```bash
npm run db:down
```

The seed script refuses to run when `NODE_ENV=production`, on Render, or when `DATABASE_URL` is not local.

The development seed includes Work Time examples: an open day, closed days, driving/break/work/rest combinations, approval states, a manual correction marker, two drivers, multiple dates, and one tour-linked work day.

## Backend

Start the app:

```bash
npm run dev
```

Then open:

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/version`
- `http://127.0.0.1:3000/admin/login`

Use the local `ADMIN_TOKEN` value to sign in.

## Tests

Run syntax/type checks:

```bash
npm run typecheck
```

Run automated tests:

```bash
npm test
```

Run database integration tests after PostgreSQL is up:

```bash
npm run test:integration
```

Run real Chromium E2E tests:

```bash
npm run test:e2e
```

Run headed E2E when a visible browser session is available:

```bash
npm run test:e2e:headed
```

Run read-only production smoke:

```bash
npm run smoke:production
```

## Production Build Metadata

The `/version` and `/health/version` endpoints expose only safe metadata:

- `service`
- `version`
- `commit`
- `buildTime`

Set these values in the production environment:

```env
APP_COMMIT_SHA=<deployed git commit sha>
APP_BUILD_TIME=<build timestamp>
```

Render's official default environment variable documentation lists `RENDER_GIT_COMMIT`, so the app uses it as a safe fallback for `commit` when `APP_COMMIT_SHA` is not set. No Render-specific automatic build timestamp variable is assumed here; set `APP_BUILD_TIME` explicitly in the build or deploy configuration if you need it populated.
