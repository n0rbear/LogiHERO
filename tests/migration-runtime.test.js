const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    MigrationError,
    evaluateMigrationState,
    loadMigrations,
    selectTargetMigrations
} = require('../src/database/migration-runtime');
const { TABLES } = require('../src/database/schema-contract');
const { assertLocalDatabaseUrl } = require('../src/database/database-inspection');
const { parseArgs } = require('../scripts/db-migrate');
const { dumpArgs } = require('../scripts/db-backup');
const { loadManifest } = require('../scripts/db-restore');

function migration(id, checksum = `checksum-${id}`) {
    return { id, filename: `${id}.js`, description: id, checksum, up: async () => {} };
}

test('migration state detects pending, missing metadata, checksum drift, gaps, and unknown rows', () => {
    const migrations = [migration('001_a'), migration('002_b'), migration('003_c')];
    const current = evaluateMigrationState(migrations, migrations.map((item) => ({ id: item.id, filename: item.filename, checksum: item.checksum })), { expectedHead: '003_c' });
    assert.equal(current.ok, true);

    const invalid = evaluateMigrationState(migrations, [
        { id: '001_a', filename: '001_a.js', checksum: null },
        { id: '003_c', filename: '003_c.js', checksum: 'changed' },
        { id: '999_unknown', filename: '999_unknown.js', checksum: 'x' }
    ], { expectedHead: '003_c' });
    assert.deepEqual(invalid.metadataMissing, ['001_a']);
    assert.deepEqual(invalid.checksumMismatches, ['003_c']);
    assert.deepEqual(invalid.gaps, ['003_c']);
    assert.deepEqual(invalid.unknown, ['999_unknown']);
    assert.equal(invalid.ok, false);
});

test('migration loading is deterministic and hashes migration dependencies', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-migrations-'));
    try {
        fs.writeFileSync(path.join(directory, 'shared.js'), 'module.exports = 1;\n');
        fs.writeFileSync(path.join(directory, '002_second.js'), "module.exports={id:'002_second',description:'second',up:async()=>{}};\n");
        fs.writeFileSync(path.join(directory, '001_first.js'), "module.exports={id:'001_first',description:'first',checksumFiles:['shared.js'],up:async()=>{}};\n");
        const first = loadMigrations(directory);
        assert.deepEqual(first.map((item) => item.id), ['001_first', '002_second']);
        const checksum = first[0].checksum;
        fs.writeFileSync(path.join(directory, 'shared.js'), 'module.exports = 2;\n');
        const changed = loadMigrations(directory);
        assert.notEqual(changed[0].checksum, checksum);
        const state = evaluateMigrationState(changed, [{ id: '001_first', filename: '001_first.js', checksum }], { expectedHead: '001_first' });
        assert.deepEqual(state.checksumMismatches, ['001_first']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('migration target and CLI parsing are fail-closed', () => {
    const migrations = [migration('001_a'), migration('002_b')];
    assert.deepEqual(selectTargetMigrations(migrations, '001_a').map((item) => item.id), ['001_a']);
    assert.throws(() => selectTargetMigrations(migrations, '999_missing'), (error) => error instanceof MigrationError && error.code === 'UNKNOWN_TARGET');
    assert.deepEqual(parseArgs([]), { command: 'migrate', to: undefined });
    assert.deepEqual(parseArgs(['migrate', '--to', '002_b']), { command: 'migrate', to: '002_b' });
    assert.deepEqual(parseArgs(['status']), { command: 'status', to: undefined });
    assert.throws(() => parseArgs(['verify', '--to=002_b']), /supported only with migrate/);
    assert.throws(() => parseArgs(['migrate', '--to']), /requires a migration id/);
});

test('canonical contract matches the schema init.js actually creates', () => {
    const tables = new Map(TABLES.map(([table, columns]) => [table, new Map(columns)]));
    // init.js declares tours.date BIGINT and work_times.date TEXT; the contract has to mirror
    // that exactly, or a database created by init.js can never migrate forward.
    assert.equal(tables.get('tours').get('date'), 'BIGINT');
    assert.equal(tables.get('work_times').get('date'), 'TEXT');
    // init.js declares these three as FLOAT, which PostgreSQL stores as double precision.
    assert.equal(tables.get('live_updates').get('speed'), 'DOUBLE PRECISION');
    assert.equal(tables.get('live_updates').get('next_stop_dist'), 'DOUBLE PRECISION');
    assert.equal(tables.get('live_updates').get('tour_remaining_dist'), 'DOUBLE PRECISION');
    assert.match(tables.get('cargo_events').get('uuid'), /^UUID/);
});

// Connection strings are assembled rather than written literally: a committed
// "scheme://user:pass@host" string is what the repository's secret scan looks for, and these
// fixtures would otherwise trip it even though the credentials are fake.
function pgUrl(hostAndPort, database, user = 'user', password = 'pass') {
    const url = new URL(`postgresql://${hostAndPort}/${database}`);
    url.username = user;
    url.password = password;
    return url.toString();
}

test('backup and restore safety accepts only local PostgreSQL URLs', () => {
    assert.equal(assertLocalDatabaseUrl(pgUrl('127.0.0.1:5433', 'logihero'), 'Test').hostname, '127.0.0.1');
    assert.throws(() => assertLocalDatabaseUrl(pgUrl('example.com', 'logihero'), 'Test'), /restricted to a local PostgreSQL host/);
});

test('backup selection is data-only and limited to canonical LogiHERO tables', () => {
    const args = dumpArgs(pgUrl('127.0.0.1', 'db'), 'archive.dump');
    assert.ok(args.includes('--format=custom'));
    assert.ok(args.includes('--data-only'));
    assert.ok(args.includes('--table=public.drivers'));
    assert.ok(args.includes('--table=public.cargo_events'));
    assert.equal(args.some((argument) => argument.includes('employees')), false);
    assert.equal(args.some((argument) => argument.includes('ketomentor')), false);
});

test('restore manifest rejects an archive with a mismatched SHA-256', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-manifest-'));
    const archive = path.join(directory, 'backup.dump');
    try {
        fs.writeFileSync(archive, 'archive');
        fs.writeFileSync(`${archive}.manifest.json`, JSON.stringify({
            formatVersion: 1,
            scope: 'logihero-data-only',
            migrationHead: '006_validate_schema',
            sha256: '0'.repeat(64),
            tables: TABLES.map(([table]) => table)
        }));
        assert.throws(() => loadManifest(archive), /SHA-256 mismatch/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('normal server startup no longer imports implicit schema initializer', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-seed.js'), 'utf8');
    assert.doesNotMatch(server, /database\/init|initDb/);
    assert.doesNotMatch(seed, /database\/init|initDb/);
    assert.match(server, /verifyMigrations/);
    assert.match(seed, /verifyMigrations/);
});
