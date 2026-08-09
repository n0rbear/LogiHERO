const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const DRIVER_B_UUID = '22222222-2222-4222-8222-222222222222';

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function authHeaders({ device = 'device-a', token = 'secret-a', driverUuid = DRIVER_A_UUID } = {}) {
    return {
        'x-device-id': device,
        'x-device-token': token,
        'x-driver-uuid': driverUuid
    };
}

function request(app, { method = 'GET', path = '/', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method,
                path,
                headers: {
                    ...headers,
                    ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {})
                }
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

function createApp() {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];
    const importCalls = [];

    pool.query = async (sql, params = []) => {
        calls.push({ via: 'pool', sql, params });
        if (sql.includes('FROM driver_devices')) {
            const [deviceId, driverUuid] = params;
            if (deviceId === 'device-a' && driverUuid === DRIVER_A_UUID) {
                return { rows: [{ device_token_hash: hashToken('secret-a'), is_active: true, driver_active: true, deleted_at: null, driver_name: 'Driver A' }], rowCount: 1 };
            }
            if (deviceId === 'device-b' && driverUuid === DRIVER_B_UUID) {
                return { rows: [{ device_token_hash: hashToken('secret-b'), is_active: true, driver_active: true, deleted_at: null, driver_name: 'Driver B' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM tours WHERE driver_name')) {
            assert.equal(params[0], 'Driver A');
            return { rows: [{ id: 10, uuid: '33333333-3333-4333-8333-333333333333', driver_name: 'Driver A', name: 'Own tour', date: 123, updated_at: 456, deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('FROM stops WHERE tour_id')) return { rows: [{ id: 20, uuid: '44444444-4444-4444-8444-444444444444', tour_id: params[0], address: 'Stop', is_completed: false, order_index: 0 }], rowCount: 1 };
        if (sql.includes('FROM cargo WHERE tour_id')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
    };

    pool.connect = async () => ({
        query: async (sql, params = []) => {
            calls.push({ via: 'client', sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
            if (sql.startsWith('UPDATE stops SET deleted_at')) return { rows: [], rowCount: 1 };
            if (sql.startsWith('UPDATE tours SET deleted_at')) return { rows: [], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        },
        release: () => calls.push({ via: 'client', sql: 'RELEASE', params: [] })
    });

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'legacy-tour-auth-test'; next(); });
    app.use(express.json());
    const createSyncTourRoutes = require('../src/routes/sync-tour.routes');
    const tourRoutes = require('../src/routes/tour.routes');
    app.use(createSyncTourRoutes({
        ImportEngine: {
            processTour: async (_client, driverName, tour, stops, options) => {
                importCalls.push({ driverName, tour, stops, options });
            }
        }
    }));
    app.use(tourRoutes);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    return { app, calls, importCalls };
}

test('authenticated owner can GET own tours', async () => {
    const { app } = createApp();
    const res = await request(app, { path: '/api/get-tours/Driver%20A', headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text);
    assert.equal(body[0].tour.driver_name, 'Driver A');
    assert.equal(body[0].stops.length, 1);
});

test('authenticated owner can POST own tour sync', async () => {
    const { app, importCalls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync-tours/Driver%20A',
        headers: authHeaders(),
        body: [{ tour: { uuid: '33333333-3333-4333-8333-333333333333', name: 'Own tour' }, stops: [] }]
    });
    assert.equal(res.status, 200);
    assert.equal(importCalls.length, 1);
    assert.equal(importCalls[0].driverName, 'Driver A');
    assert.equal(importCalls[0].options.source, 'mobile');
});

test('unauthenticated legacy tour GET and POST are rejected before data access', async () => {
    const getCtx = createApp();
    const getRes = await request(getCtx.app, { path: '/api/get-tours/Driver%20A' });
    assert.equal(getRes.status, 401);
    assert.equal(getCtx.calls.some(call => call.sql.includes('FROM tours WHERE driver_name')), false);

    const postCtx = createApp();
    const postRes = await request(postCtx.app, { method: 'POST', path: '/api/sync-tours/Driver%20A', body: [] });
    assert.equal(postRes.status, 401);
    assert.equal(postCtx.calls.some(call => call.sql === 'BEGIN'), false);
});

test('invalid device credential is rejected', async () => {
    const { app } = createApp();
    const res = await request(app, {
        path: '/api/get-tours/Driver%20A',
        headers: authHeaders({ token: 'wrong' })
    });
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(res.text).credentialState, 'INVALID');
});

test('authenticated Driver A cannot GET Driver B tours by changing only path driverName', async () => {
    const { app, calls } = createApp();
    const res = await request(app, { path: '/api/get-tours/Driver%20B', headers: authHeaders() });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.text).error, 'DRIVER_SCOPE_DENIED');
    assert.equal(calls.some(call => call.sql.includes('FROM tours WHERE driver_name')), false);
});

test('authenticated Driver A cannot POST/sync Driver B tours by changing only path driverName', async () => {
    const { app, calls, importCalls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync-tours/Driver%20B',
        headers: authHeaders(),
        body: [{ tour: { uuid: '33333333-3333-4333-8333-333333333333', name: 'Foreign path' }, stops: [] }]
    });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.text).error, 'DRIVER_SCOPE_DENIED');
    assert.equal(importCalls.length, 0);
    assert.equal(calls.some(call => call.sql === 'BEGIN'), false);
});
