const express = require('express');
const pool = require('../database/pool');
const packageJson = require('../../package.json');
const { APP_COMMIT_SHA, APP_BUILD_TIME, ADMIN_TOKEN, DATABASE_URL, IS_DEPLOYED } = require('../config/env');
const router = express.Router();

const versionBody = () => ({
    service: 'logihero-backend',
    version: packageJson.version,
    commit: APP_COMMIT_SHA,
    buildTime: APP_BUILD_TIME
});

async function checkDatabase() {
    const started = Date.now();
    await pool.query('SELECT 1');
    return { status: 'ok', durationMs: Date.now() - started };
}

async function checkMigrations() {
    const result = await pool.query(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'schema_migrations'
        ) AS exists
    `);
    if (!result.rows[0]?.exists) return { status: 'missing' };
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
    return { status: 'ok', count: count.rows[0]?.count || 0 };
}

router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'logihero-backend'
    });
});

router.get('/ready', async (_req, res) => {
    const checks = {
        database: { status: 'unknown' },
        migrations: { status: 'unknown' },
        config: {
            databaseUrl: DATABASE_URL ? 'present' : 'missing',
            adminToken: ADMIN_TOKEN ? 'present' : 'missing',
            deployed: IS_DEPLOYED
        }
    };
    try {
        checks.database = await checkDatabase();
    } catch (_err) {
        checks.database = { status: 'error' };
    }

    try {
        checks.migrations = await checkMigrations();
    } catch (_err) {
        checks.migrations = { status: 'error' };
    }

    const missingConfig = !DATABASE_URL || !ADMIN_TOKEN;
    const ready = checks.database.status === 'ok' &&
        checks.migrations.status === 'ok' &&
        !missingConfig;
    const degraded = checks.database.status === 'ok' && !ready;

    res.status(ready ? 200 : 503).json({
        status: ready ? 'READY' : (degraded ? 'DEGRADED' : 'NOT_READY'),
        service: 'logihero-backend',
        checks,
        version: versionBody()
    });
});

router.get(['/version', '/health/version'], (req, res) => {
    res.json(versionBody());
});

module.exports = router;
