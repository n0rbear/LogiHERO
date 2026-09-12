const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LATEST_MIGRATION_ID = '007_driver_pwa_auth_foundation';
const MIGRATION_LOCK_KEY = '7246494845524';

class MigrationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'MigrationError';
        this.code = code;
        this.details = details;
    }
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function migrationChecksum(filePath, migration) {
    const files = [filePath, ...(migration.checksumFiles || []).map((file) => path.resolve(path.dirname(filePath), file))];
    const contents = files.map((file) => `${path.basename(file)}\n${fs.readFileSync(file)}`).join('\n');
    return sha256(contents);
}

function loadMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
    const files = fs.readdirSync(migrationsDir)
        .filter((file) => /^\d{3}_[a-z0-9_]+\.js$/.test(file))
        .sort((a, b) => a.localeCompare(b));
    const ids = new Set();
    return files.map((file) => {
        const filePath = path.join(migrationsDir, file);
        delete require.cache[require.resolve(filePath)];
        const migration = require(filePath);
        const expectedId = file.replace(/\.js$/, '');
        if (migration.id !== expectedId || typeof migration.up !== 'function' || !migration.description) {
            throw new MigrationError('INVALID_MIGRATION', `Invalid migration definition: ${file}`);
        }
        if (ids.has(migration.id)) {
            throw new MigrationError('DUPLICATE_MIGRATION', `Duplicate migration id: ${migration.id}`);
        }
        ids.add(migration.id);
        return {
            ...migration,
            filename: file,
            filePath,
            checksum: migrationChecksum(filePath, migration)
        };
    });
}

async function migrationTableExists(client) {
    const result = await client.query(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'schema_migrations'
        ) AS exists
    `);
    return Boolean(result.rows[0]?.exists);
}

async function ensureMigrationTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            id TEXT PRIMARY KEY,
            filename TEXT,
            description TEXT NOT NULL DEFAULT '',
            checksum TEXT,
            applied_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
            execution_ms INTEGER,
            app_commit TEXT
        )
    `);
    await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS filename TEXT");
    await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
    await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS execution_ms INTEGER");
    await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS app_commit TEXT");
    await client.query("ALTER TABLE public.schema_migrations ALTER COLUMN description SET DEFAULT ''");
}

async function readAppliedMigrations(client) {
    if (!await migrationTableExists(client)) return [];
    const columns = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
    `);
    const available = new Set(columns.rows.map((row) => row.column_name));
    const select = [
        'id',
        available.has('filename') ? 'filename' : 'NULL::TEXT AS filename',
        available.has('description') ? 'description' : "''::TEXT AS description",
        available.has('checksum') ? 'checksum' : 'NULL::TEXT AS checksum',
        available.has('applied_at') ? 'applied_at' : 'NULL::BIGINT AS applied_at',
        available.has('execution_ms') ? 'execution_ms' : 'NULL::INTEGER AS execution_ms',
        available.has('app_commit') ? 'app_commit' : 'NULL::TEXT AS app_commit'
    ];
    return (await client.query(`SELECT ${select.join(', ')} FROM public.schema_migrations ORDER BY id`)).rows;
}

function evaluateMigrationState(migrations, appliedRows, { expectedHead = LATEST_MIGRATION_ID } = {}) {
    const knownById = new Map(migrations.map((migration) => [migration.id, migration]));
    const appliedById = new Map(appliedRows.map((row) => [row.id, row]));
    const unknown = appliedRows.filter((row) => !knownById.has(row.id)).map((row) => row.id);
    const checksumMismatches = [];
    const metadataMissing = [];
    for (const migration of migrations) {
        const row = appliedById.get(migration.id);
        if (!row) continue;
        if (!row.checksum) metadataMissing.push(migration.id);
        else if (row.checksum !== migration.checksum) checksumMismatches.push(migration.id);
        if (row.filename && row.filename !== migration.filename) checksumMismatches.push(migration.id);
    }
    const appliedKnown = migrations.filter((migration) => appliedById.has(migration.id));
    const pending = migrations.filter((migration) => !appliedById.has(migration.id));
    const gaps = [];
    let sawPending = false;
    for (const migration of migrations) {
        if (!appliedById.has(migration.id)) sawPending = true;
        else if (sawPending) gaps.push(migration.id);
    }
    const head = appliedKnown.at(-1)?.id || null;
    const expectedExists = migrations.some((migration) => migration.id === expectedHead);
    return {
        ok: unknown.length === 0 && checksumMismatches.length === 0 && metadataMissing.length === 0 && gaps.length === 0 && expectedExists && head === expectedHead,
        head,
        expectedHead,
        unknown,
        checksumMismatches: [...new Set(checksumMismatches)],
        metadataMissing,
        gaps,
        pending: pending.map((migration) => migration.id),
        applied: appliedKnown.map((migration) => migration.id)
    };
}

function assertStateIsValid(state, { allowPending = false, allowLegacyBaseline = false } = {}) {
    const metadataMissing = allowLegacyBaseline
        ? state.metadataMissing.filter((id) => id !== '001_baseline_logihero_schema')
        : state.metadataMissing;
    if (state.unknown.length) throw new MigrationError('UNKNOWN_APPLIED_MIGRATION', `Unknown applied migrations: ${state.unknown.join(', ')}`, state);
    if (state.checksumMismatches.length) throw new MigrationError('CHECKSUM_MISMATCH', `Migration checksum mismatch: ${state.checksumMismatches.join(', ')}`, state);
    if (metadataMissing.length) throw new MigrationError('MIGRATION_METADATA_MISSING', `Migration checksum metadata missing: ${metadataMissing.join(', ')}`, state);
    if (state.gaps.length) throw new MigrationError('MIGRATION_GAP', `Applied migration sequence contains gaps before: ${state.gaps.join(', ')}`, state);
    if (!allowPending && state.pending.length) throw new MigrationError('MIGRATIONS_PENDING', `Pending migrations: ${state.pending.join(', ')}`, state);
}

function selectTargetMigrations(migrations, to) {
    if (!to) return migrations;
    const index = migrations.findIndex((migration) => migration.id === to);
    if (index < 0) throw new MigrationError('UNKNOWN_TARGET', `Unknown migration target: ${to}`);
    return migrations.slice(0, index + 1);
}

async function inspectMigrations(client, options = {}) {
    const migrations = options.migrations || loadMigrations(options.migrationsDir);
    const applied = await readAppliedMigrations(client);
    return {
        migrations,
        applied,
        state: evaluateMigrationState(migrations, applied, { expectedHead: options.expectedHead || LATEST_MIGRATION_ID })
    };
}

async function verifyMigrations(client, options = {}) {
    const inspected = await inspectMigrations(client, options);
    assertStateIsValid(inspected.state);
    const expected = inspected.migrations.find((migration) => migration.id === (options.expectedHead || LATEST_MIGRATION_ID));
    if (!expected || inspected.state.head !== expected.id) {
        throw new MigrationError('MIGRATION_HEAD_MISMATCH', `Expected migration head ${options.expectedHead || LATEST_MIGRATION_ID}, found ${inspected.state.head || 'none'}`, inspected.state);
    }
    if (typeof expected.verify === 'function') await expected.verify(client);
    return inspected.state;
}

async function migrate(client, options = {}) {
    const migrations = options.migrations || loadMigrations(options.migrationsDir);
    const selected = selectTargetMigrations(migrations, options.to);
    const appCommit = options.appCommit || process.env.APP_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || null;
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
        await client.query('BEGIN');
        try {
            await client.query('SET LOCAL search_path TO public, pg_catalog');
            await ensureMigrationTable(client);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        let applied = await readAppliedMigrations(client);
        let state = evaluateMigrationState(migrations, applied, { expectedHead: selected.at(-1)?.id || LATEST_MIGRATION_ID });
        assertStateIsValid(state, { allowPending: true, allowLegacyBaseline: true });

        const appliedById = new Map(applied.map((row) => [row.id, row]));
        const legacyBaseline = appliedById.get('001_baseline_logihero_schema');
        if (legacyBaseline && !legacyBaseline.checksum) {
            const baseline = migrations.find((migration) => migration.id === legacyBaseline.id);
            await client.query('BEGIN');
            try {
                await client.query('SET LOCAL search_path TO public, pg_catalog');
                await client.query(
                    `UPDATE public.schema_migrations
                     SET filename = $2, description = COALESCE(NULLIF(description, ''), $3), checksum = $4,
                         execution_ms = COALESCE(execution_ms, 0), app_commit = COALESCE(app_commit, $5)
                     WHERE id = $1 AND checksum IS NULL`,
                    [baseline.id, baseline.filename, baseline.description, baseline.checksum, appCommit]
                );
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            applied = await readAppliedMigrations(client);
            appliedById.set(baseline.id, applied.find((row) => row.id === baseline.id));
        }

        const appliedIds = new Set(applied.map((row) => row.id));
        const results = [];
        for (const migration of selected) {
            if (appliedIds.has(migration.id)) {
                results.push({ id: migration.id, status: 'already_applied' });
                continue;
            }
            const started = Date.now();
            await client.query('BEGIN');
            try {
                await client.query('SET LOCAL search_path TO public, pg_catalog');
                await migration.up(client);
                const executionMs = Date.now() - started;
                await client.query(
                    `INSERT INTO public.schema_migrations
                        (id, filename, description, checksum, applied_at, execution_ms, app_commit)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [migration.id, migration.filename, migration.description, migration.checksum, Date.now(), executionMs, appCommit]
                );
                await client.query('COMMIT');
                appliedIds.add(migration.id);
                results.push({ id: migration.id, status: 'applied', executionMs });
            } catch (error) {
                await client.query('ROLLBACK');
                throw new MigrationError('MIGRATION_FAILED', `Migration ${migration.id} failed: ${error.message}`, { migrationId: migration.id, cause: error });
            }
        }
        const final = await inspectMigrations(client, {
            migrations,
            expectedHead: selected.at(-1)?.id || LATEST_MIGRATION_ID
        });
        assertStateIsValid(final.state, { allowPending: Boolean(options.to) });
        const target = selected.at(-1);
        if (typeof target?.verify === 'function') await target.verify(client);
        return { state: final.state, results };
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
}

module.exports = {
    DEFAULT_MIGRATIONS_DIR,
    LATEST_MIGRATION_ID,
    MIGRATION_LOCK_KEY,
    MigrationError,
    assertStateIsValid,
    ensureMigrationTable,
    evaluateMigrationState,
    inspectMigrations,
    loadMigrations,
    migrate,
    migrationChecksum,
    readAppliedMigrations,
    selectTargetMigrations,
    sha256,
    verifyMigrations
};
