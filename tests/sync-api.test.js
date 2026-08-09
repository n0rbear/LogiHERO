const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const DRIVER_B_UUID = '22222222-2222-4222-8222-222222222222';
const COMPANY_A_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOUR_A_UUID = '33333333-3333-4333-8333-333333333333';
const TOUR_B_UUID = '44444444-4444-4444-8444-444444444444';
const STOP_A_UUID = '55555555-5555-4555-8555-555555555555';
const STOP_B_UUID = '66666666-6666-4666-8666-666666666666';

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

function createApp(options = {}) {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];
    const state = {
        driverARow: { uuid: DRIVER_A_UUID, company_uuid: COMPANY_A_UUID, name: 'Driver A', activation_code: 'SECRET-CODE', updated_at: 10, revision: 1 },
        driverBRow: { uuid: DRIVER_B_UUID, company_uuid: COMPANY_B_UUID, name: 'Driver B', updated_at: 20, revision: 1 },
        tourARow: { uuid: TOUR_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', name: 'Own tour', updated_at: 30, revision: 1 },
        tourBRow: { uuid: TOUR_B_UUID, company_uuid: COMPANY_B_UUID, driver_uuid: DRIVER_B_UUID, driver_name: 'Driver B', name: 'Foreign tour', updated_at: 40, revision: 1 },
        stopARow: { uuid: STOP_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, tour_id: 11, address: 'Own stop', updated_at: 50, revision: 1 },
        stopBRow: { uuid: STOP_B_UUID, company_uuid: COMPANY_B_UUID, driver_uuid: DRIVER_B_UUID, tour_id: 12, address: 'Foreign stop', updated_at: 60, revision: 1 },
        ...options.state
    };

    async function handler(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes('FROM driver_devices')) {
            const [deviceId, driverUuid] = params;
            if (deviceId === 'device-a' && driverUuid === DRIVER_A_UUID) {
                return {
                    rows: [{
                        device_token_hash: hashToken('secret-a'),
                        is_active: true,
                        driver_active: true,
                        deleted_at: null,
                        driver_name: 'Driver A',
                        driver_company_uuid: COMPANY_A_UUID
                    }],
                    rowCount: 1
                };
            }
            if (deviceId === 'device-b' && driverUuid === DRIVER_B_UUID) {
                return {
                    rows: [{
                        device_token_hash: hashToken('secret-b'),
                        is_active: !options.revokedB,
                        driver_active: true,
                        deleted_at: options.revokedB ? Date.now() : null,
                        driver_name: 'Driver B',
                        driver_company_uuid: COMPANY_B_UUID
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };

        if (sql.includes('SELECT id FROM tours')) {
            const id = params[3];
            if (String(id) === '11') return { rows: [{ id: 11 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT s.id FROM stops s')) {
            const idOrUuid = params[3];
            if (String(idOrUuid) === '21' || idOrUuid === STOP_A_UUID) return { rows: [{ id: 21 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT uuid FROM work_days')) return { rows: [], rowCount: 0 };

        if (sql.startsWith('SELECT') && sql.includes('FROM drivers')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === DRIVER_A_UUID ? state.driverARow : params[0] === DRIVER_B_UUID ? state.driverBRow : null;
                if (row && params.length > 1 && row.uuid !== params[1]) return { rows: [], rowCount: 0 };
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            return { rows: [state.driverARow], rowCount: 1 };
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM tours')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === TOUR_A_UUID ? state.tourARow : params[0] === TOUR_B_UUID ? state.tourBRow : null;
                if (row && params.length > 1 && row.driver_uuid !== params[1]) return { rows: [], rowCount: 0 };
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            return { rows: [state.tourARow], rowCount: 1 };
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM stops')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === STOP_A_UUID ? state.stopARow : params[0] === STOP_B_UUID ? state.stopBRow : null;
                if (row && params.length > 1 && row.driver_uuid !== params[1]) return { rows: [], rowCount: 0 };
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            return { rows: [state.stopARow], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO drivers')) {
            return { rows: [{ ...state.driverARow, ...rowFromInsert(sql, params) }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO tours')) {
            return { rows: [{ ...state.tourARow, ...rowFromInsert(sql, params) }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO stops')) {
            return { rows: [{ ...state.stopARow, ...rowFromInsert(sql, params) }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    pool.connect = async () => ({
        query: handler,
        release: () => {}
    });
    pool.query = handler;

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'sync-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/sync.routes'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return { app, calls };
}

function rowFromInsert(sql, params) {
    const match = sql.match(/INSERT INTO \w+ \(([^)]+)\)/);
    assert.ok(match, sql);
    return Object.fromEntries(match[1].split(', ').map((field, index) => [field, params[index]]));
}

test('authenticated device can pull only own-scoped generic sync records', async () => {
    const { app, calls } = createApp();
    const res = await request(app, { path: '/api/sync?since=1', headers: authHeaders() });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.changes.drivers[0].uuid, DRIVER_A_UUID);
    assert.equal(body.changes.drivers[0].updatedAt, 10);
    assert.equal(body.changes.drivers[0].activationCode, undefined);
    assert.equal(body.changes.tours[0].driverUuid, DRIVER_A_UUID);
    assert.equal(body.changes.stops[0].driverUuid, DRIVER_A_UUID);
    assert.equal(calls.some(call => call.sql.includes('driver_uuid = $2::uuid') || call.sql.includes('uuid = $2::uuid')), true);
});

test('missing, invalid, unknown and revoked device credentials are rejected before generic sync data access', async () => {
    const attempts = [
        { headers: {}, expected: 401 },
        { headers: authHeaders({ token: 'wrong' }), expected: 401 },
        { headers: authHeaders({ device: 'unknown' }), expected: 401 },
        { headers: authHeaders({ device: 'device-b', token: 'secret-b', driverUuid: DRIVER_B_UUID }), expected: 403, revokedB: true }
    ];
    for (const attempt of attempts) {
        const { app, calls } = createApp({ revokedB: attempt.revokedB });
        const res = await request(app, { path: '/api/sync?since=1', headers: attempt.headers });
        assert.equal(res.status, attempt.expected);
        assert.equal(calls.some(call => call.sql.includes('FROM drivers') && !call.sql.includes('driver_devices')), false);
    }
});

test('authenticated owner can push own-scoped generic sync changes', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { tours: [{ uuid: TOUR_A_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, name: 'Mobile tour', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.applied.tours[0].driverUuid, DRIVER_A_UUID);
    assert.equal(body.applied.tours[0].companyUuid, COMPANY_A_UUID);
    assert.equal(calls.find(call => call.sql.includes('INSERT INTO tours')).sql.includes('approval_status'), false);
    assert.equal(calls.some(call => call.sql === 'COMMIT'), true);
});

test('own-scoped stale generic sync revision still returns conflict', async () => {
    const { app } = createApp({ state: { tourARow: { uuid: TOUR_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', name: 'Server tour', updated_at: 30, revision: 3 } } });
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { tours: [{ uuid: TOUR_A_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, name: 'Client tour', baseRevision: 2 }] } }
    });
    assert.equal(res.status, 409, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.error, 'SYNC_CONFLICT');
    assert.equal(body.conflicts[0].serverRevision, 3);
});

test('Driver A cannot update or delete Driver B generic sync data by submitting Driver B uuid', async () => {
    for (const record of [
        { uuid: TOUR_B_UUID, driverUuid: DRIVER_B_UUID, companyUuid: COMPANY_B_UUID, name: 'Takeover', revision: 1 },
        { uuid: TOUR_B_UUID, deletedAt: Date.now(), revision: 1 }
    ]) {
        const { app, calls } = createApp();
        const res = await request(app, {
            method: 'POST',
            path: '/api/sync',
            headers: authHeaders(),
            body: { changes: { tours: [record] } }
        });
        assert.equal(res.status, 403, res.text);
        assert.equal(JSON.parse(res.text).error, 'SYNC_SCOPE_DENIED');
        assert.equal(calls.some(call => call.sql.includes('INSERT INTO tours')), false);
        assert.equal(calls.some(call => call.sql === 'ROLLBACK'), true);
    }
});

test('Driver A cannot create data scoped to Driver B or another company', async () => {
    const attempts = [
        { uuid: '77777777-7777-4777-8777-777777777777', driverUuid: DRIVER_B_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID },
        { uuid: '88888888-8888-4888-8888-888888888888', driverUuid: DRIVER_A_UUID, driverName: 'Driver B', companyUuid: COMPANY_A_UUID },
        { uuid: '99999999-9999-4999-8999-999999999999', driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_B_UUID }
    ];
    for (const record of attempts) {
        const { app, calls } = createApp();
        const res = await request(app, {
            method: 'POST',
            path: '/api/sync',
            headers: authHeaders(),
            body: { changes: { tours: [{ ...record, name: 'Bad create', revision: 1 }] } }
        });
        assert.equal(res.status, 403, res.text);
        assert.equal(calls.some(call => call.sql.includes('INSERT INTO tours')), false);
    }
});

test('caller-controlled relation identifiers cannot bypass stop ownership', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { stops: [{ uuid: STOP_A_UUID, tourId: 12, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, address: 'Bad relation', revision: 1 }] } }
    });
    assert.equal(res.status, 403, res.text);
    assert.match(JSON.parse(res.text).rejected[0].error, /SCOPE_DENIED/);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO stops')), false);
});

test('batch scope denial rolls back authorized records and prevents partial unauthorized writes', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: {
            changes: {
                tours: [
                    { uuid: TOUR_A_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, name: 'Allowed', revision: 1 },
                    { uuid: TOUR_B_UUID, driverUuid: DRIVER_B_UUID, driverName: 'Driver B', companyUuid: COMPANY_B_UUID, name: 'Denied', revision: 1 }
                ]
            }
        }
    });
    assert.equal(res.status, 403, res.text);
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO tours')).length, 1);
    assert.equal(calls.some(call => call.sql === 'ROLLBACK'), true);
    assert.equal(calls.some(call => call.sql === 'COMMIT'), false);
});
