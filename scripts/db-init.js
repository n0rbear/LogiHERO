process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev';

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
