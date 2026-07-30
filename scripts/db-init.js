process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.DATABASE_URL || require('../src/config/env').DATABASE_URL;

const initDb = require('../src/database/init');
const pool = require('../src/database/pool');

(async () => {
    try {
        await initDb();
        console.log('[DB] init complete');
    } finally {
        await pool.end();
    }
})().catch((error) => {
    console.error('[DB] init failed:', error.message);
    process.exit(1);
});
