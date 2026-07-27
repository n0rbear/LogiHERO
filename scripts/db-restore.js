const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const backupFile = process.env.RESTORE_FILE || process.argv[2];
const targetUrl = process.env.RESTORE_DATABASE_URL;
if (!backupFile || !fs.existsSync(backupFile)) {
    console.error('[DB_RESTORE] missing RESTORE_FILE or first argument');
    process.exit(1);
}
if (!targetUrl) {
    console.error('[DB_RESTORE] missing RESTORE_DATABASE_URL');
    process.exit(1);
}
if ((process.env.RESTORE_TARGET || '').toLowerCase() === 'production' && process.env.RESTORE_CONFIRM !== 'production') {
    console.error('[DB_RESTORE] production restore is blocked without RESTORE_CONFIRM=production');
    process.exit(1);
}
if (/onrender\.com|render\.com/i.test(targetUrl) && process.env.RESTORE_CONFIRM !== 'production') {
    console.error('[DB_RESTORE] refusing possible production restore target');
    process.exit(1);
}

function firstLine(value) {
    return Buffer.isBuffer(value) ? value.toString('utf8').split(/\r?\n/)[0] : String(value || '').split(/\r?\n/)[0];
}

function localDockerUrl(url) {
    return /127\.0\.0\.1|localhost/.test(url);
}

function dockerDbArgs(url) {
    const parsed = new URL(url);
    return {
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.slice(1)
    };
}

function runDockerDatabaseCommand(command, database) {
    const cfg = dockerDbArgs(targetUrl);
    return spawnSync('docker', ['exec', '-e', `PGPASSWORD=${cfg.password}`, 'logihero-postgres-dev', command, '-U', cfg.user, database], {
        encoding: 'utf8',
        windowsHide: true
    });
}

function prepareDockerTargetDatabase() {
    if (!localDockerUrl(targetUrl) || process.env.RESTORE_CREATE_DATABASE !== 'true') return;
    const cfg = dockerDbArgs(targetUrl);
    if (process.env.RESTORE_DROP_DATABASE === 'true') {
        spawnSync('docker', ['exec', '-e', `PGPASSWORD=${cfg.password}`, 'logihero-postgres-dev', 'dropdb', '--if-exists', '-U', cfg.user, cfg.database], {
            encoding: 'utf8',
            windowsHide: true
        });
    }
    const created = runDockerDatabaseCommand('createdb', cfg.database);
    if (created.status !== 0 && !/already exists/i.test(created.stderr || created.stdout || '')) {
        console.error(`[DB_RESTORE] failed to create target database message=${firstLine(created.stderr || created.stdout)}`);
        process.exit(created.status || 1);
    }
}

function runPgRestore() {
    const direct = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname', targetUrl, backupFile], {
        encoding: 'utf8',
        windowsHide: true
    });
    if (direct.status === 0 || direct.error?.code !== 'ENOENT') return direct;
    if (!localDockerUrl(targetUrl)) return direct;
    prepareDockerTargetDatabase();
    const cfg = dockerDbArgs(targetUrl);
    return spawnSync('docker', ['exec', '-i', '-e', `PGPASSWORD=${cfg.password}`, 'logihero-postgres-dev',
        'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '-U', cfg.user, '-d', cfg.database], {
        input: fs.readFileSync(backupFile),
        encoding: null,
        windowsHide: true
    });
}

const restore = runPgRestore();
if (restore.status !== 0) {
    console.error(`[DB_RESTORE] failed status=${restore.status} message=${firstLine(restore.stderr || restore.stdout) || 'pg_restore failed'}`);
    process.exit(restore.status || 1);
}

process.env.DATABASE_URL = targetUrl;
const pool = require('../src/database/pool');

async function count(table) {
    return Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count);
}

(async () => {
    const checks = {
        drivers: await count('drivers'),
        driverDevices: await count('driver_devices'),
        hotels: await count('hotels'),
        tours: await count('tours'),
        workDays: await count('work_days'),
        workEntries: await count('work_time_entries'),
        workConflicts: await count('work_time_conflicts'),
        audit: await count('work_time_audit'),
        migrations: await count('schema_migrations')
    };
    const rawToken = await pool.query("SELECT COUNT(*)::int AS count FROM driver_devices WHERE device_token_hash IS NOT NULL AND length(device_token_hash) <> 64");
    if (Number(rawToken.rows[0].count) > 0) throw new Error('driver_devices contains non-hash token values');
    await pool.end();
    console.log(JSON.stringify({ status: 'RESTORE_OK', backupFile, checks }, null, 2));
})().catch(async (error) => {
    console.error('[DB_RESTORE] failed:', error.message);
    process.exit(1);
});
