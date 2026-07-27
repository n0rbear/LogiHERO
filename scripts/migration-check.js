const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const migrationsDir = path.join(__dirname, '..', 'src', 'database', 'migrations');
const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.js')).sort();
const ids = new Set();
const manifest = [];

for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    delete require.cache[require.resolve(fullPath)];
    const migration = require(fullPath);
    if (!migration.id || typeof migration.up !== 'function') {
        throw new Error(`Invalid migration file: ${file}`);
    }
    if (ids.has(migration.id)) {
        throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    ids.add(migration.id);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    manifest.push({ file, id: migration.id, checksum });
}

const ordered = [...files].sort();
if (files.join('\n') !== ordered.join('\n')) {
    throw new Error('Migration files are not sorted lexicographically.');
}

console.log(JSON.stringify({
    status: 'MIGRATIONS_OK',
    count: manifest.length,
    migrations: manifest
}, null, 2));
