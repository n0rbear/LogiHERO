const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { TABLES } = require('../src/database/schema-contract');
const { DRIVER_PWA_TABLES } = require('../src/database/driver-pwa-schema');
const { assertLocalDatabaseUrl, inspectDatabase } = require('../src/database/database-inspection');
const { migrate } = require('../src/database/migration-runtime');

function firstLine(value) {
    return Buffer.isBuffer(value) ? value.toString('utf8').split(/\r?\n/)[0] : String(value || '').split(/\r?\n/)[0];
}

function loadManifest(backupFile, manifestFile = `${backupFile}.manifest.json`) {
    if (!fs.existsSync(manifestFile)) throw new Error('backup manifest is missing');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
    if (manifest.sha256 !== checksum) throw new Error('backup SHA-256 mismatch');
    if (manifest.scope !== 'logihero-data-only' || !['006_validate_schema', '007_driver_pwa_auth_foundation'].includes(manifest.migrationHead)) {
        throw new Error('unsupported backup manifest');
    }
    const expectedTables = manifest.migrationHead === '006_validate_schema'
        ? TABLES.map(([table]) => table)
        : [...TABLES.map(([table]) => table), ...DRIVER_PWA_TABLES];
    if (JSON.stringify(manifest.tables) !== JSON.stringify(expectedTables)) throw new Error('backup table scope mismatch');
    return manifest;
}

function runPgRestore(targetUrl, backupFile) {
    const args = ['--data-only', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', targetUrl, backupFile];
    const direct = spawnSync('pg_restore', args, { encoding: 'utf8', windowsHide: true });
    if (direct.status === 0 || direct.error?.code !== 'ENOENT') return direct;
    const url = new URL(targetUrl);
    const dockerConfig = process.env.DOCKER_CONFIG || path.join(os.tmpdir(), 'logihero-docker-config');
    fs.mkdirSync(dockerConfig, { recursive: true });
    return spawnSync('docker', [
        'exec', '-i', '-e', `PGPASSWORD=${decodeURIComponent(url.password)}`, 'logihero-postgres-dev',
        'pg_restore', '--data-only', '--no-owner', '--no-acl', '--exit-on-error',
        '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)
    ], {
        input: fs.readFileSync(backupFile),
        encoding: null,
        windowsHide: true,
        env: { ...process.env, DOCKER_CONFIG: dockerConfig }
    });
}

async function assertEmptyTarget(client) {
    const result = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'
    `);
    if (result.rowCount) throw new Error('restore target must be a newly created empty database');
}

async function restore(options = {}) {
    const backupFile = options.backupFile || process.env.RESTORE_FILE || process.argv[2];
    const targetUrl = options.targetUrl || process.env.RESTORE_DATABASE_URL;
    if (!backupFile || !fs.existsSync(backupFile)) throw new Error('missing backup archive');
    if (!targetUrl) throw new Error('missing RESTORE_DATABASE_URL');
    const parsed = assertLocalDatabaseUrl(targetUrl, 'Restore');
    const database = parsed.pathname.slice(1);
    if (!database.startsWith('logihero_restore_')) throw new Error('restore database name must start with logihero_restore_');
    const manifest = loadManifest(backupFile, options.manifestFile);

    let client = new Client({ connectionString: targetUrl, ssl: false });
    await client.connect();
    try {
        await assertEmptyTarget(client);
        await migrate(client);
        const empty = [];
        for (const table of [...TABLES.map(([name]) => name), ...DRIVER_PWA_TABLES]) {
            empty.push(Number((await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count));
        }
        if (empty.some((count) => count !== 0)) throw new Error('migrated restore target contains application data');
    } finally {
        await client.end();
    }

    const restoreResult = runPgRestore(targetUrl, backupFile);
    if (restoreResult.status !== 0) throw new Error(`pg_restore failed status=${restoreResult.status} message=${firstLine(restoreResult.stderr || restoreResult.stdout) || 'unknown'}`);

    client = new Client({ connectionString: targetUrl, ssl: false });
    await client.connect();
    try {
        const inspection = await inspectDatabase(client);
        const actualCounts = Object.fromEntries(manifest.tables.map((table) => [table, inspection.counts[table]]));
        if (JSON.stringify(actualCounts) !== JSON.stringify(manifest.rowCounts)) throw new Error('restored row counts do not match manifest');
        if (inspection.fingerprint !== manifest.schemaFingerprint) throw new Error('restored schema fingerprint does not match manifest');
        return { status: 'RESTORE_OK', backupFile, database, inspection };
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    restore()
        .then((result) => console.log(JSON.stringify({ status: result.status, backupFile: result.backupFile, database: result.database, checks: result.inspection.counts }, null, 2)))
        .catch((error) => {
            console.error(`[DB_RESTORE] failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { assertEmptyTarget, loadManifest, restore, runPgRestore };
