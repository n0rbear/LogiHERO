const { spawn } = require('node:child_process');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3100';
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-dev-admin-token';
process.env.READ_ONLY_ADMIN_TOKEN = process.env.READ_ONLY_ADMIN_TOKEN || 'local-dev-read-only-token';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://logihero_dev:logihero_dev_password@127.0.0.1:5432/logihero_dev';
process.env.APP_COMMIT_SHA = process.env.APP_COMMIT_SHA || 'local';
process.env.APP_BUILD_TIME = process.env.APP_BUILD_TIME || new Date().toISOString();

async function close(server) {
    await new Promise((resolve) => server.close(resolve));
    const pool = require('../src/database/pool');
    await pool.end();
}

(async () => {
    const { start } = require('../server');
    const server = await start();
    const args = [require.resolve('@playwright/test/cli'), 'test', '--project=local-e2e'];
    if (process.argv.includes('--headed')) args.push('--headed');

    const child = spawn(process.execPath, args, {
        stdio: 'inherit',
        env: { ...process.env, LOGIHERO_E2E_EXTERNAL_SERVER: '1' },
        shell: false
    });

    child.on('exit', async (code) => {
        await close(server);
        process.exit(code || 0);
    });
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
