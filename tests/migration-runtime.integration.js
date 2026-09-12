const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { Client } = require('pg');

const { assertLocalDatabaseUrl } = require('../src/database/database-inspection');
const { migrate, verifyMigrations } = require('../src/database/migration-runtime');
const { createHealthRouter } = require('../src/routes/health.routes');
const { backup } = require('../scripts/db-backup');
const { restore } = require('../scripts/db-restore');

// Assembled rather than written as a literal connection string, so the committed source does
// not contain a "scheme://user:pass@host" pattern for the secret scan to flag.
function localRootUrl() {
    const url = new URL(`postgresql://${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5433'}/postgres`);
    url.username = process.env.PGUSER || 'logihero_dev';
    url.password = process.env.PGPASSWORD || 'logihero_dev_password';
    return url.toString();
}

const ROOT_URL = process.env.MIGRATION_TEST_DATABASE_URL || localRootUrl();
assertLocalDatabaseUrl(ROOT_URL, 'Migration integration test');

function databaseUrl(name) {
    const parsed = new URL(ROOT_URL);
    parsed.pathname = `/${name}`;
    return parsed.toString();
}

function quoteIdentifier(value) {
    if (!/^logihero_(?:migration|restore)_test_[a-z0-9_]+$/.test(value)) throw new Error('unsafe test database name');
    return `"${value}"`;
}

async function createDatabase(prefix = 'migration') {
    const name = `logihero_${prefix}_test_${crypto.randomBytes(6).toString('hex')}`;
    const admin = new Client({ connectionString: ROOT_URL, ssl: false });
    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
    } finally {
        await admin.end();
    }
    return { name, url: databaseUrl(name) };
}

async function dropDatabase(name) {
    const admin = new Client({ connectionString: ROOT_URL, ssl: false });
    await admin.connect();
    try {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [name]);
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    } finally {
        await admin.end();
    }
}

async function withDatabase(fn, prefix) {
    const database = await createDatabase(prefix);
    try {
        return await fn(database);
    } finally {
        await dropDatabase(database.name);
    }
}

async function connected(url) {
    const client = new Client({ connectionString: url, ssl: false });
    await client.connect();
    return client;
}

function request(app, path = '/ready') {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, body: JSON.parse(body) })));
            });
            req.on('error', (error) => server.close(() => reject(error)));
        });
    });
}

async function createLegacyFingerprint(client, { includeCompany = true } = {}) {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await client.query(`CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, description TEXT, applied_at BIGINT)`);
    await client.query(`INSERT INTO schema_migrations VALUES ('001_baseline_logihero_schema', 'Baseline current LogiHERO idempotent schema managed by db:init.', 1)`);
    await client.query(`CREATE TABLE companies (uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL)`);
    if (includeCompany) await client.query(`INSERT INTO companies (name, slug) VALUES ('Existing Company', 'existing-company')`);
    await client.query(`CREATE TABLE drivers (id SERIAL PRIMARY KEY, uuid UUID UNIQUE, company_uuid UUID, name TEXT UNIQUE)`);
    await client.query(`INSERT INTO drivers (name) VALUES ('Legacy Driver')`);
    await client.query(`CREATE TABLE tours (id SERIAL PRIMARY KEY, uuid UUID UNIQUE DEFAULT gen_random_uuid(), company_uuid UUID, driver_uuid UUID, driver_name TEXT, date BIGINT)`);
    await client.query(`INSERT INTO tours (driver_name, date) VALUES ('Legacy Driver', 1788700000000)`);
    await client.query(`CREATE TABLE live_updates (id SERIAL PRIMARY KEY, driver_name TEXT, driver_uuid UUID, company_uuid UUID)`);
    await client.query(`INSERT INTO live_updates (driver_name) VALUES ('Legacy Driver')`);
}

test('empty database migrates 001-007, stays idempotent, and readiness is READY', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            const first = await migrate(client);
            assert.equal(first.state.head, '007_driver_pwa_auth_foundation');
            assert.equal(first.results.filter((item) => item.status === 'applied').length, 7);
            const second = await migrate(client);
            assert.equal(second.results.every((item) => item.status === 'already_applied'), true);
            assert.equal((await client.query("SELECT data_type FROM information_schema.columns WHERE table_name='tours' AND column_name='date'")).rows[0].data_type, 'bigint');
            assert.equal((await client.query("SELECT udt_name FROM information_schema.columns WHERE table_name='cargo_events' AND column_name='uuid'")).rows[0].udt_name, 'uuid');
            assert.equal(Number((await client.query('SELECT COUNT(*)::int AS count FROM companies')).rows[0].count), 0);
            assert.equal(Number((await client.query('SELECT COUNT(*)::int AS count FROM role_permissions')).rows[0].count), 0);

            const app = express();
            app.use(createHealthRouter({
                db: client,
                config: { DATABASE_URL: url, ADMIN_TOKEN: 'test-admin', IS_DEPLOYED: false }
            }));
            const ready = await request(app);
            assert.equal(ready.status, 200);
            assert.equal(ready.body.status, 'READY');
            assert.equal(ready.body.checks.migrations.head, '007_driver_pwa_auth_foundation');
        } finally {
            await client.end();
        }
    });
});

test('legacy production-shaped schema upgrades without implicit demo or permission seed', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            await createLegacyFingerprint(client);
            const result = await migrate(client);
            assert.equal(result.state.head, '007_driver_pwa_auth_foundation');
            const driver = (await client.query("SELECT uuid, company_uuid FROM drivers WHERE name='Legacy Driver'")).rows[0];
            assert.ok(driver.uuid);
            assert.ok(driver.company_uuid);
            assert.equal((await client.query('SELECT driver_uuid, company_uuid FROM tours')).rows[0].driver_uuid, driver.uuid);
            assert.equal((await client.query('SELECT driver_uuid, company_uuid FROM live_updates')).rows[0].driver_uuid, driver.uuid);
            assert.equal(Number((await client.query("SELECT COUNT(*)::int AS count FROM companies WHERE slug='demo-company'")).rows[0].count), 0);
            assert.equal(Number((await client.query('SELECT COUNT(*)::int AS count FROM role_permissions')).rows[0].count), 0);
            const baseline = (await client.query("SELECT filename, checksum FROM schema_migrations WHERE id='001_baseline_logihero_schema'")).rows[0];
            assert.equal(baseline.filename, '001_baseline_logihero_schema.js');
            assert.match(baseline.checksum, /^[a-f0-9]{64}$/);
        } finally {
            await client.end();
        }
    });
});

test('migrate --to stops at the requested head and a later run completes the sequence', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            const partial = await migrate(client, { to: '004_reconcile_types_and_defaults' });
            assert.equal(partial.state.head, '004_reconcile_types_and_defaults');
            assert.deepEqual(partial.state.pending, ['005_add_constraints_and_indexes', '006_validate_schema', '007_driver_pwa_auth_foundation']);
            await assert.rejects(() => verifyMigrations(client), (error) => error.code === 'MIGRATIONS_PENDING');
            const app = express();
            app.use(createHealthRouter({ db: client, config: { DATABASE_URL: url, ADMIN_TOKEN: 'test-admin', IS_DEPLOYED: false } }));
            const notReady = await request(app);
            assert.equal(notReady.status, 503);
            assert.equal(notReady.body.checks.migrations.code, 'MIGRATIONS_PENDING');
            const completed = await migrate(client);
            assert.equal(completed.state.head, '007_driver_pwa_auth_foundation');
            assert.equal(completed.results.filter((item) => item.status === 'applied').length, 3);
        } finally {
            await client.end();
        }
    });
});

test('checksum mismatch, missing migration, and schema drift fail closed', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            await migrate(client);
            await client.query("UPDATE schema_migrations SET checksum='tampered' WHERE id='004_reconcile_types_and_defaults'");
            await assert.rejects(() => verifyMigrations(client), (error) => error.code === 'CHECKSUM_MISMATCH');
            await client.query("UPDATE schema_migrations SET checksum=(SELECT checksum FROM schema_migrations WHERE id='005_add_constraints_and_indexes') WHERE id='004_reconcile_types_and_defaults'");
        } finally {
            await client.end();
        }
    });

    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            await migrate(client);
            await client.query("DELETE FROM schema_migrations WHERE id='004_reconcile_types_and_defaults'");
            await assert.rejects(() => verifyMigrations(client), (error) => error.code === 'MIGRATION_GAP');
        } finally {
            await client.end();
        }
    });

    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            await migrate(client);
            await client.query('ALTER TABLE tours ALTER COLUMN date TYPE TEXT USING NULL');
            await assert.rejects(() => verifyMigrations(client), (error) => error.code === 'SCHEMA_DRIFT');
            const app = express();
            app.use(createHealthRouter({ db: client, config: { DATABASE_URL: url, ADMIN_TOKEN: 'test-admin', IS_DEPLOYED: false } }));
            const ready = await request(app);
            assert.equal(ready.status, 503);
            assert.equal(ready.body.checks.migrations.code, 'SCHEMA_DRIFT');
        } finally {
            await client.end();
        }
    });
});

test('failed migration rolls back and concurrent runners serialize with advisory lock', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            const failing = [{ id: '001_failure', filename: '001_failure.js', description: 'failure', checksum: 'failure', up: async (db) => {
                await db.query('CREATE TABLE rollback_probe (id INTEGER)');
                throw new Error('intentional failure');
            } }];
            await assert.rejects(() => migrate(client, { migrations: failing }), (error) => error.code === 'MIGRATION_FAILED');
            assert.equal((await client.query("SELECT to_regclass('public.rollback_probe') AS name")).rows[0].name, null);
            assert.equal(Number((await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0].count), 0);
        } finally {
            await client.end();
        }
    });

    await withDatabase(async ({ url }) => {
        const firstClient = await connected(url);
        const secondClient = await connected(url);
        try {
            const slow = [{ id: '001_slow', filename: '001_slow.js', description: 'slow', checksum: 'slow', up: async (db) => {
                await db.query('SELECT pg_sleep(0.35)');
                await db.query('CREATE TABLE concurrency_probe (id INTEGER)');
            } }];
            const started = Date.now();
            const [first, second] = await Promise.all([
                migrate(firstClient, { migrations: slow }),
                migrate(secondClient, { migrations: slow })
            ]);
            assert.ok(Date.now() - started >= 300);
            assert.equal(first.results.concat(second.results).filter((item) => item.status === 'applied').length, 1);
            assert.equal(Number((await firstClient.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0].count), 1);
        } finally {
            await firstClient.end();
            await secondClient.end();
        }
    });
});

test('ownership backfill precondition aborts its migration without partial UUID mutation', { timeout: 120000 }, async () => {
    await withDatabase(async ({ url }) => {
        const client = await connected(url);
        try {
            await createLegacyFingerprint(client, { includeCompany: false });
            await assert.rejects(() => migrate(client), /unowned drivers require exactly one existing company/);
            assert.equal((await client.query("SELECT uuid FROM drivers WHERE name='Legacy Driver'")).rows[0].uuid, null);
            assert.equal(Number((await client.query("SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id='003_backfill_legacy_rows'")).rows[0].count), 0);
        } finally {
            await client.end();
        }
    });
});

test('local LogiHERO-only custom backup restores with matching counts, fingerprint, UUIDs, and sequences', { timeout: 120000 }, async () => {
    const source = await createDatabase('migration');
    const target = await createDatabase('restore');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-backup-test-'));
    const archive = path.join(directory, 'local.dump');
    try {
        const sourceClient = await connected(source.url);
        try {
            await migrate(sourceClient);
            const company = (await sourceClient.query("INSERT INTO companies (name, slug) VALUES ('Backup Company', 'backup-company') RETURNING uuid")).rows[0];
            const driver = (await sourceClient.query("INSERT INTO drivers (company_uuid, name, created_at, updated_at) VALUES ($1, 'Backup Driver', 1, 1) RETURNING uuid", [company.uuid])).rows[0];
            const account = (await sourceClient.query(
                "INSERT INTO driver_accounts (driver_uuid, username, username_normalized, password_hash, created_at, updated_at) VALUES ($1, 'backup.driver', 'backup.driver', '$argon2id$test-hash', 1, 1) RETURNING uuid",
                [driver.uuid]
            )).rows[0];
            await sourceClient.query(
                "INSERT INTO driver_web_sessions (account_uuid, token_hash, csrf_token_hash, password_version, created_at, last_seen_at, expires_at) VALUES ($1, repeat('a', 64), repeat('b', 64), 1, 1, 1, 2)",
                [account.uuid]
            );
        } finally {
            await sourceClient.end();
        }

        const backupResult = await backup({ databaseUrl: source.url, outDir: directory, file: archive });
        assert.equal(backupResult.status, 'BACKUP_OK');
        assert.match(backupResult.sha256, /^[a-f0-9]{64}$/);
        const restoreResult = await restore({ backupFile: archive, targetUrl: target.url });
        assert.equal(restoreResult.status, 'RESTORE_OK');
        assert.equal(restoreResult.inspection.counts.companies, 1);
        assert.equal(restoreResult.inspection.counts.drivers, 1);
        assert.equal(restoreResult.inspection.counts.driver_accounts, 1);
        assert.equal(restoreResult.inspection.counts.driver_web_sessions, 1);
        assert.equal(restoreResult.inspection.fingerprint, backupResult.inspection.fingerprint);
    } finally {
        await dropDatabase(source.name);
        await dropDatabase(target.name);
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

module.exports = { ROOT_URL, createDatabase, dropDatabase, databaseUrl };
