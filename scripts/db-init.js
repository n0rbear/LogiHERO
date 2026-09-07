process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const pool = require('../src/database/pool');
const { migrate } = require('../src/database/migration-runtime');

(async () => {
    const client = await pool.connect();
    try {
        const result = await migrate(client);
        console.log(`[DB] migration head ready: ${result.state.head}`);
    } finally {
        client.release();
        await pool.end();
    }
})().catch((error) => {
    console.error(`[DB] migration failed: ${error.code || 'FAILED'}: ${error.message}`);
    process.exit(1);
});
