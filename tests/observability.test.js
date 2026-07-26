const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function request(app, { path = '/', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                path,
                headers
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, text })));
            });
            req.on('error', (error) => server.close(() => reject(error)));
            req.end();
        });
    });
}

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

test('version endpoint exposes safe build metadata only', async () => {
    process.env.APP_COMMIT_SHA = 'abc123';
    process.env.APP_BUILD_TIME = '2026-07-26T10:00:00.000Z';
    process.env.ADMIN_TOKEN = 'super-secret-token';
    clearProjectModules();

    const pool = require('../src/database/pool');
    pool.query = async () => ({ rows: [] });

    const app = express();
    app.use(require('../src/routes/health.routes'));
    const res = await request(app, { path: '/version' });

    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body.service, 'logihero-backend');
    assert.equal(body.commit, 'abc123');
    assert.equal(body.buildTime, '2026-07-26T10:00:00.000Z');
    assert.equal(JSON.stringify(body).includes('super-secret-token'), false);
});

test('request tracing, admin no-store, x-powered-by removal, and safe 500 body', async () => {
    const {
        requestIdMiddleware,
        adminNoStoreMiddleware,
        errorHandler
    } = require('../src/middleware/http-hardening');

    const app = express();
    app.disable('x-powered-by');
    app.use(requestIdMiddleware);
    app.use(adminNoStoreMiddleware);
    app.get('/admin/broken', () => {
        throw new Error('database password token should not leak');
    });
    app.use(errorHandler);

    const res = await request(app, {
        path: '/admin/broken',
        headers: { accept: 'text/html', 'x-request-id': 'trace-test-1' }
    });

    assert.equal(res.status, 500);
    assert.equal(res.headers['x-request-id'], 'trace-test-1');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.match(res.text, /Trace ID: trace-test-1/);
    assert.doesNotMatch(res.text, /database password token/);
});
