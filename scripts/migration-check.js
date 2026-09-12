const { LATEST_MIGRATION_ID, loadMigrations } = require('../src/database/migration-runtime');

const migrations = loadMigrations();
if (!migrations.length || migrations.at(-1).id !== LATEST_MIGRATION_ID) {
    throw new Error(`Migration manifest head must be ${LATEST_MIGRATION_ID}`);
}

console.log(JSON.stringify({
    status: 'MIGRATIONS_VALID',
    count: migrations.length,
    head: migrations.at(-1).id,
    migrations: migrations.map(({ id, filename, description, checksum }) => ({ id, filename, description, checksum }))
}, null, 2));
