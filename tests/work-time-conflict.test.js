const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const DRIVER_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVER_UUID = '22222222-2222-4222-8222-222222222222';
const CONFLICT_UUID = '33333333-3333-4333-8333-333333333333';

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
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
                headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, text, body: text ? JSON.parse(text) : null })));
            });
            req.on('error', error => server.close(() => reject(error)));
            if (data) req.write(data);
            req.end();
        });
    });
}

function conflict(overrides = {}) {
    return {
        uuid: CONFLICT_UUID,
        work_day_uuid: '44444444-4444-4444-8444-444444444444',
        entry_uuid: '55555555-5555-4555-8555-555555555555',
        driver_uuid: DRIVER_UUID,
        local_revision: 1,
        backend_revision: 2,
        local_value: { status: 'DRIVING', revision: 1 },
        backend_value: { uuid: '44444444-4444-4444-8444-444444444444', status: 'WORK', revision: 2 },
        approval_status: 'PENDING',
        admin_correction: false,
        reason: 'STALE_REVISION',
        resolution_status: 'UNRESOLVED',
        created_at: 1000,
        resolved_at: null,
        ...overrides
    };
}

function createApp(handler, auth = { status: 200, driverUuid: DRIVER_UUID }) {
    clearProjectModules();
    const authPath = require.resolve('../src/middleware/requireDeviceAuth');
    require.cache[authPath] = {
        id: authPath,
        filename: authPath,
        loaded: true,
        exports: {
            requireDeviceAuth(req, res, next) {
                if (auth.status !== 200) return res.status(auth.status).json({ error: auth.error || 'DEVICE_AUTH_FAILED' });
                req.deviceAuth = { driverUuid: auth.driverUuid || DRIVER_UUID, deviceId: auth.deviceId || 'dev-device-active-1' };
                next();
            }
        }
    };
    const pool = require('../src/database/pool');
    pool.query = async (sql, params = []) => handler(sql, params);
    pool.connect = async () => ({
        query: async (sql, params = []) => handler(sql, params),
        release: () => {}
    });
    const app = express();
    app.use((req, _res, next) => { req.requestId = 'conflict-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/work-time.routes'));
    return app;
}

test('conflict list returns current driver conflicts in audit order', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM work_time_conflicts')) return { rows: [conflict({ created_at: 2000 }), conflict({ uuid: '66666666-6666-4666-8666-666666666666', created_at: 1000 })] };
        return { rows: [] };
    });
    const res = await request(app, { path: '/api/work-time/conflicts' });
    assert.equal(res.status, 200);
    assert.equal(res.body[0].createdAt, 2000);
    assert.equal(res.body.length, 2);
});

test('conflict detail enforces ownership', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const res = await request(app, { path: `/api/work-time/conflicts/${CONFLICT_UUID}` });
    assert.equal(res.status, 404);
});

test('conflict detail rejects invalid uuid', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const res = await request(app, { path: '/api/work-time/conflicts/not-a-uuid' });
    assert.equal(res.status, 400);
});

test('accept server resolves unresolved conflict', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('SELECT * FROM work_time_conflicts')) return { rows: [conflict()] };
        if (sql.includes('UPDATE work_time_conflicts')) return { rows: [conflict({ resolution_status: 'SERVER_ACCEPTED', resolved_at: 3000 })] };
        return { rows: [], rowCount: 1 };
    });
    const res = await request(app, { method: 'POST', path: `/api/work-time/conflicts/${CONFLICT_UUID}/accept-server` });
    assert.equal(res.status, 200);
    assert.equal(res.body.resolutionStatus, 'SERVER_ACCEPTED');
    assert.ok(calls.some(sql => sql.includes('UPDATE work_days')));
});

test('reapply local resolves normal stale revision conflict', async () => {
    const app = createApp(async (sql) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('SELECT * FROM work_time_conflicts')) return { rows: [conflict({ reason: 'STALE_REVISION' })] };
        if (sql.includes('UPDATE work_time_conflicts')) return { rows: [conflict({ resolution_status: 'LOCAL_REAPPLIED' })] };
        return { rows: [], rowCount: 1 };
    });
    const res = await request(app, { method: 'POST', path: `/api/work-time/conflicts/${CONFLICT_UUID}/reapply-local` });
    assert.equal(res.status, 200);
    assert.equal(res.body.resolutionStatus, 'LOCAL_REAPPLIED');
});

test('defer keeps conflict for later review', async () => {
    const app = createApp(async (sql) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('SELECT * FROM work_time_conflicts')) return { rows: [conflict()] };
        if (sql.includes('UPDATE work_time_conflicts')) return { rows: [conflict({ resolution_status: 'DEFERRED' })] };
        return { rows: [], rowCount: 1 };
    });
    const res = await request(app, { method: 'POST', path: `/api/work-time/conflicts/${CONFLICT_UUID}/defer` });
    assert.equal(res.status, 200);
    assert.equal(res.body.resolutionStatus, 'DEFERRED');
});

test('already resolved conflict returns 409', async () => {
    const app = createApp(async (sql) => {
        if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('SELECT * FROM work_time_conflicts')) return { rows: [conflict({ resolution_status: 'DEFERRED' })] };
        return { rows: [] };
    });
    const res = await request(app, { method: 'POST', path: `/api/work-time/conflicts/${CONFLICT_UUID}/accept-server` });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'CONFLICT_ALREADY_RESOLVED');
});

for (const [name, row] of [
    ['approved conflict requires manual review', conflict({ approval_status: 'APPROVED', reason: 'APPROVED_RECORD_LOCKED' })],
    ['corrected conflict requires manual review', conflict({ admin_correction: true, reason: 'ADMIN_CORRECTED_RECORD_LOCKED' })],
    ['soft delete conflict requires manual review', conflict({ reason: 'SOFT_DELETED_RECORD' })]
]) {
    test(name, async () => {
        const app = createApp(async (sql) => {
            if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [] };
            if (sql.includes('SELECT * FROM work_time_conflicts')) return { rows: [row] };
            return { rows: [], rowCount: 1 };
        });
        const res = await request(app, { method: 'POST', path: `/api/work-time/conflicts/${CONFLICT_UUID}/reapply-local` });
        assert.equal(res.status, 409);
        assert.equal(res.body.error, 'MANUAL_REVIEW_REQUIRED');
    });
}

test('disabled device token is rejected before conflict routes', async () => {
    const app = createApp(async () => ({ rows: [] }), { status: 403, error: 'DEVICE_DISABLED' });
    const res = await request(app, { path: '/api/work-time/conflicts' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'DEVICE_DISABLED');
});

test('disabled driver token is rejected before conflict routes', async () => {
    const app = createApp(async () => ({ rows: [] }), { status: 403, error: 'DRIVER_DISABLED' });
    const res = await request(app, { path: '/api/work-time/conflicts' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'DRIVER_DISABLED');
});

test('missing or wrong token is rejected before conflict routes', async () => {
    const app = createApp(async () => ({ rows: [] }), { status: 401, error: 'DEVICE_TOKEN_REQUIRED' });
    const res = await request(app, { path: '/api/work-time/conflicts' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'DEVICE_TOKEN_REQUIRED');
});
