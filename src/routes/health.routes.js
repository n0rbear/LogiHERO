const express = require('express');
const pool = require('../database/pool');
const { verifyMigrations } = require('../database/migration-runtime');
const packageJson = require('../../package.json');
const { APP_COMMIT_SHA, APP_BUILD_TIME, ADMIN_TOKEN, DATABASE_URL, IS_DEPLOYED } = require('../config/env');

const versionBody = () => ({
    service: 'logihero-backend',
    version: packageJson.version,
    commit: APP_COMMIT_SHA,
    buildTime: APP_BUILD_TIME
});

async function checkDatabase(db) {
    const started = Date.now();
    await db.query('SELECT 1');
    return { status: 'ok', durationMs: Date.now() - started };
}

async function checkMigrations(db, verifier) {
    const state = await verifier(db);
    return { status: 'ok', head: state.head, applied: state.applied.length };
}

function createHealthRouter({
    db = pool,
    migrationVerifier = verifyMigrations,
    config = { DATABASE_URL, ADMIN_TOKEN, IS_DEPLOYED }
} = {}) {
    const router = express.Router();

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
                databaseUrl: config.DATABASE_URL ? 'present' : 'missing',
                adminToken: config.ADMIN_TOKEN ? 'present' : 'missing',
                deployed: config.IS_DEPLOYED
            }
        };
        try {
            checks.database = await checkDatabase(db);
        } catch (_err) {
            checks.database = { status: 'error' };
        }

        try {
            checks.migrations = await checkMigrations(db, migrationVerifier);
        } catch (err) {
            checks.migrations = { status: 'error', code: err.code || 'MIGRATION_INVALID' };
        }

        const missingConfig = !config.DATABASE_URL || !config.ADMIN_TOKEN;
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

    router.get(['/version', '/health/version'], (_req, res) => {
        res.json(versionBody());
    });
    return router;
}

module.exports = createHealthRouter();
module.exports.createHealthRouter = createHealthRouter;
