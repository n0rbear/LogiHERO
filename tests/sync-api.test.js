const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function request(app, { method = 'GET', path = '/', body } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method,
                path,
                headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, text })));
            });
            req.on('error', error => server.close(() => reject(error)));
            if (data) req.write(data);
            req.end();
        });
    });
}

function createApp(handler) {
    clearProjectModules();
    const pool = require('../src/database/pool');
    pool.connect = async () => ({
        query: async (sql, params = []) => handler(sql, params),
        release: () => {}
    });
    pool.query = async (sql, params = []) => handler(sql, params);
    const app = express();
    app.use((req, _res, next) => { req.requestId = 'sync-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/sync.routes'));
    return app;
}

test('GET /api/sync returns changed records grouped by entity', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM drivers')) return { rows: [{ uuid: '11111111-1111-4111-8111-111111111111', name: 'Driver', updated_at: 10, revision: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const res = await request(app, { path: '/api/sync?since=1' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body.changes.drivers[0].uuid, '11111111-1111-4111-8111-111111111111');
    assert.equal(body.changes.drivers[0].updatedAt, 10);
});

test('POST /api/sync applies revisioned changes and logs sync event', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FROM drivers')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO drivers')) return { rows: [{ uuid: params[0], name: 'Mobile Driver', updated_at: Date.now(), revision: 1 }], rowCount: 1 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const uuid = '11111111-1111-4111-8111-111111111111';
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        body: { changes: { drivers: [{ uuid, name: 'Mobile Driver', revision: 1 }] } }
    });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).applied.drivers[0].uuid, uuid);
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO sync_events')));
});

test('POST /api/sync returns 409 when base revision is stale', async () => {
    const app = createApp(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FROM drivers')) return { rows: [{ uuid: '11111111-1111-4111-8111-111111111111', name: 'Server', revision: 3, updated_at: 20 }], rowCount: 1 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        body: { changes: { drivers: [{ uuid: '11111111-1111-4111-8111-111111111111', name: 'Client', baseRevision: 2 }] } }
    });
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.text).error, 'SYNC_CONFLICT');
});
