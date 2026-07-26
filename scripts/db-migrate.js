process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/database/pool');

async function ensureTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            description TEXT,
            applied_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )
    `);
}

async function run() {
    const migrationsDir = path.join(__dirname, '..', 'src', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.js')).sort();
    const client = await pool.connect();
    try {
        await ensureTable(client);
        for (const file of files) {
            const migration = require(path.join(migrationsDir, file));
            if (!migration.id || typeof migration.up !== 'function') {
                throw new Error(`Invalid migration file: ${file}`);
            }
            const exists = (await client.query('SELECT id FROM schema_migrations WHERE id = $1', [migration.id])).rows[0];
            if (exists) continue;
            await client.query('BEGIN');
            try {
                await migration.up(client);
                await client.query(
                    'INSERT INTO schema_migrations (id, description, applied_at) VALUES ($1, $2, $3)',
                    [migration.id, migration.description || '', Date.now()]
                );
                await client.query('COMMIT');
                console.log(`[MIGRATION] applied ${migration.id}`);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
        console.log('[MIGRATION] complete');
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch((error) => {
    console.error('[MIGRATION] failed:', error.message);
    process.exit(1);
});
