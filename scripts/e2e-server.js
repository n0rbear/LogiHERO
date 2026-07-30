process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3100';
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-dev-admin-token';
process.env.READ_ONLY_ADMIN_TOKEN = process.env.READ_ONLY_ADMIN_TOKEN || 'local-dev-read-only-token';
process.env.DATABASE_URL = process.env.DATABASE_URL || require('../src/config/env').DATABASE_URL;
process.env.APP_COMMIT_SHA = process.env.APP_COMMIT_SHA || 'local';
process.env.APP_BUILD_TIME = process.env.APP_BUILD_TIME || new Date().toISOString();

const pool = require('../src/database/pool');
const { start } = require('../server');

start().then((server) => {
    let closing = false;
    const shutdown = () => {
        if (closing) return;
        closing = true;
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 3000).unref();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}).catch((error) => {
    console.error(error.message);
    process.exit(1);
});
