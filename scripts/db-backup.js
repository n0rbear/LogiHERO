const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { TABLES } = require('../src/database/schema-contract');
const { DRIVER_PWA_TABLES } = require('../src/database/driver-pwa-schema');
const { assertLocalDatabaseUrl, inspectDatabase } = require('../src/database/database-inspection');

function firstLine(value) {
    return Buffer.isBuffer(value) ? value.toString('utf8').split(/\r?\n/)[0] : String(value || '').split(/\r?\n/)[0];
}

const BACKUP_TABLES = [...TABLES.map(([table]) => table), ...DRIVER_PWA_TABLES];

function dumpArgs(databaseUrl, file) {
    const tables = BACKUP_TABLES.map((table) => `--table=public.${table}`);
    return ['--format=custom', '--data-only', '--no-owner', '--no-acl', ...tables, '--file', file, databaseUrl];
}

function runPgDump(databaseUrl, file) {
    const direct = spawnSync('pg_dump', dumpArgs(databaseUrl, file), { encoding: 'utf8', windowsHide: true });
    if (direct.status === 0 || direct.error?.code !== 'ENOENT') return direct;
    const url = new URL(databaseUrl);
    const dockerArgs = [
        'exec', '-e', `PGPASSWORD=${decodeURIComponent(url.password)}`, 'logihero-postgres-dev',
        'pg_dump', '--format=custom', '--data-only', '--no-owner', '--no-acl',
        ...BACKUP_TABLES.map((table) => `--table=public.${table}`),
        '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)
    ];
    const dockerConfig = process.env.DOCKER_CONFIG || path.join(os.tmpdir(), 'logihero-docker-config');
    fs.mkdirSync(dockerConfig, { recursive: true });
    const docker = spawnSync('docker', dockerArgs, {
        encoding: null,
        windowsHide: true,
        env: { ...process.env, DOCKER_CONFIG: dockerConfig }
    });
    if (docker.status === 0) fs.writeFileSync(file, docker.stdout);
    return docker;
}

async function backup(options = {}) {
    const databaseUrl = options.databaseUrl || process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('missing BACKUP_DATABASE_URL or DATABASE_URL');
    const parsed = assertLocalDatabaseUrl(databaseUrl, 'Backup');
    const outDir = path.resolve(options.outDir || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = options.file || path.join(outDir, `logihero-local-${stamp}.dump`);

    const client = new Client({ connectionString: databaseUrl, ssl: false });
    await client.connect();
    let inspection;
    try {
        inspection = await inspectDatabase(client);
    } finally {
        await client.end();
    }

    const result = runPgDump(databaseUrl, file);
    if (result.status !== 0) throw new Error(`pg_dump failed status=${result.status} message=${firstLine(result.stderr || result.stdout) || 'unknown'}`);
    const stat = fs.statSync(file);
    if (!stat.size) throw new Error('pg_dump produced an empty archive');
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifest = {
        formatVersion: 1,
        scope: 'logihero-data-only',
        createdAt: new Date().toISOString(),
        database: parsed.pathname.slice(1),
        archive: path.basename(file),
        bytes: stat.size,
        sha256: checksum,
        tables: BACKUP_TABLES,
        rowCounts: Object.fromEntries(BACKUP_TABLES.map((table) => [table, inspection.counts[table]])),
        schemaFingerprint: inspection.fingerprint,
        migrationHead: '007_driver_pwa_auth_foundation',
        integrity: {
            uuids: inspection.uuids,
            relationships: inspection.relationships,
            sequences: inspection.sequences
        }
    };
    const manifestFile = `${file}.manifest.json`;
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`);
    return { status: 'BACKUP_OK', file, manifestFile, bytes: stat.size, sha256: checksum, inspection };
}

if (require.main === module) {
    backup()
        .then((result) => console.log(JSON.stringify({ status: result.status, file: result.file, manifestFile: result.manifestFile, bytes: result.bytes, sha256: result.sha256 }, null, 2)))
        .catch((error) => {
            console.error(`[DB_BACKUP] failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { BACKUP_TABLES, backup, dumpArgs, runPgDump };
