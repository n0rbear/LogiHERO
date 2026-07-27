const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const isProduction = process.env.BACKUP_TARGET === 'production';
const databaseUrl = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('[DB_BACKUP] missing BACKUP_DATABASE_URL or DATABASE_URL');
    process.exit(1);
}
if (isProduction && process.env.BACKUP_CONFIRM !== 'production') {
    console.error('[DB_BACKUP] production backup requires BACKUP_CONFIRM=production');
    process.exit(1);
}

const outDir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = path.join(outDir, `logihero-${isProduction ? 'production' : 'local'}-${stamp}.dump`);

function firstLine(value) {
    return Buffer.isBuffer(value) ? value.toString('utf8').split(/\r?\n/)[0] : String(value || '').split(/\r?\n/)[0];
}

function runPgDump() {
    const direct = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file, databaseUrl], {
        encoding: 'utf8',
        windowsHide: true
    });
    if (direct.status === 0 || direct.error?.code !== 'ENOENT') return direct;
    if (!/127\.0\.0\.1|localhost/.test(databaseUrl)) return direct;
    const url = new URL(databaseUrl);
    const args = ['exec', '-e', `PGPASSWORD=${decodeURIComponent(url.password)}`, 'logihero-postgres-dev',
        'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1)];
    const docker = spawnSync('docker', args, { encoding: null, windowsHide: true });
    if (docker.status === 0) fs.writeFileSync(file, docker.stdout);
    return docker;
}

const result = runPgDump();

if (result.status !== 0) {
    console.error(`[DB_BACKUP] failed status=${result.status} message=${firstLine(result.stderr || result.stdout) || 'pg_dump failed'}`);
    process.exit(result.status || 1);
}
const stat = fs.statSync(file);
if (!stat.size) {
    console.error('[DB_BACKUP] failed empty backup file');
    process.exit(1);
}
const checksum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`);

console.log(JSON.stringify({
    status: 'BACKUP_OK',
    target: isProduction ? 'production' : 'local',
    file,
    bytes: stat.size,
    sha256: checksum
}, null, 2));
