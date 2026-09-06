const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const COMPANY_A_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COST_A_UUID = '77777777-7777-4777-8777-777777777777';
const HOTEL_A_UUID = '88888888-8888-4888-8888-888888888888';
const CARGO_A_UUID = '99999999-9999-4999-8999-999999999999';
const WORK_DAY_LOCKED_UUID = 'aaaaaaaa-1111-4111-8111-111111111111';
const WORK_DAY_OPEN_UUID = 'bbbbbbbb-1111-4111-8111-111111111111';
const WORK_DAY_OPEN2_UUID = 'bbbbbbbb-2222-4222-8222-222222222222';
const WORK_ENTRY_UUID = 'cccccccc-1111-4111-8111-111111111111';
const WORK_ENTRY_OPEN_UUID = 'cccccccc-2222-4222-8222-222222222222';
const TOUR_A_UUID = 'dddddddd-1111-4111-8111-111111111111';
const STOP_A_UUID = 'eeeeeeee-1111-4111-8111-111111111111';

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

function rowFromInsert(sql, params) {
    const match = sql.match(/INSERT INTO \w+ \(([^)]+)\)/);
    assert.ok(match, sql);
    return { fields: match[1].split(', '), row: Object.fromEntries(match[1].split(', ').map((field, index) => [field, params[index]])) };
}

function createApp(options = {}) {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];
    const state = {
        driverARow: { uuid: DRIVER_A_UUID, company_uuid: COMPANY_A_UUID, name: 'Driver A', updated_at: 10, revision: 1 },
        costARow: { uuid: COST_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', status: 'Rogzitve', amount: 10, updated_at: 10, revision: 1 },
        hotelARow: { uuid: HOTEL_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', status: 'CHECKED_OUT', updated_at: 10, revision: 1 },
        workDayLockedRow: { uuid: WORK_DAY_LOCKED_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', approval_status: 'APPROVED', admin_note: null, anomaly_flags: [], updated_at: 10, revision: 1 },
        workDayOpenRow: { uuid: WORK_DAY_OPEN_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', approval_status: 'PENDING', admin_note: null, anomaly_flags: [], updated_at: 10, revision: 1 },
        workDayOpen2Row: { uuid: WORK_DAY_OPEN2_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', approval_status: 'PENDING', admin_note: null, anomaly_flags: [], updated_at: 10, revision: 1 },
        workEntryRow: { uuid: WORK_ENTRY_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', work_day_uuid: WORK_DAY_LOCKED_UUID, updated_at: 10, revision: 1 },
        workEntryOpenRow: { uuid: WORK_ENTRY_OPEN_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', work_day_uuid: WORK_DAY_OPEN_UUID, updated_at: 10, revision: 1 },
        tourARow: { uuid: TOUR_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', name: 'Tour A', tour_status: 'IN_PROGRESS', is_closed: false, updated_at: 10, revision: 1 },
        stopARow: { uuid: STOP_A_UUID, company_uuid: COMPANY_A_UUID, driver_uuid: DRIVER_A_UUID, tour_id: 1, address: 'Stop A', stop_status: 'PENDING', is_completed: false, updated_at: 10, revision: 1 },
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
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };

        // Work-day lock lookup performed for work_time_entries relation ownership.
        if (sql.includes('SELECT approval_status, admin_note, anomaly_flags FROM work_days')) {
            const workDayUuid = params[3];
            if (workDayUuid === WORK_DAY_LOCKED_UUID) return { rows: [state.workDayLockedRow], rowCount: 1 };
            if (workDayUuid === WORK_DAY_OPEN_UUID) return { rows: [state.workDayOpenRow], rowCount: 1 };
            if (workDayUuid === WORK_DAY_OPEN2_UUID) return { rows: [state.workDayOpen2Row], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith('SELECT') && sql.includes('FROM costs')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === COST_A_UUID ? state.costARow : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM hotels')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === HOTEL_A_UUID ? state.hotelARow : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM cargo')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === CARGO_A_UUID ? { uuid: CARGO_A_UUID, driver_uuid: DRIVER_A_UUID, company_uuid: COMPANY_A_UUID, status: 'PLANNED' } : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM work_days')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === WORK_DAY_LOCKED_UUID ? state.workDayLockedRow : params[0] === WORK_DAY_OPEN_UUID ? state.workDayOpenRow : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM work_time_entries')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === WORK_ENTRY_UUID ? state.workEntryRow
                    : params[0] === WORK_ENTRY_OPEN_UUID ? state.workEntryOpenRow
                        : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM tours') && !sql.includes('sync_scope_t')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === TOUR_A_UUID ? state.tourARow : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM stops')) {
            if (sql.includes('uuid::text = $1')) {
                const row = params[0] === STOP_A_UUID ? state.stopARow : null;
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
        }

        if (sql.includes('INSERT INTO costs')) return { rows: [{ ...state.costARow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO hotels')) return { rows: [{ ...state.hotelARow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO cargo')) return { rows: [{ uuid: CARGO_A_UUID, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO work_days')) return { rows: [{ ...state.workDayOpenRow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO work_time_entries')) return { rows: [{ ...state.workEntryRow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO tours')) return { rows: [{ ...state.tourARow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        if (sql.includes('INSERT INTO stops')) return { rows: [{ ...state.stopARow, ...rowFromInsert(sql, params).row }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    }

    pool.connect = async () => ({ query: handler, release: () => {} });
    pool.query = handler;

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'sync-invariant-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/sync.routes'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return { app, calls };
}

test('generic sync cannot set or read back a client-supplied cost approval/payment status', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { costs: [{ uuid: COST_A_UUID, driverUuid: DRIVER_A_UUID, companyUuid: COMPANY_A_UUID, amount: 25, status: 'Kifizetve', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const insertCall = calls.find(call => call.sql.includes('INSERT INTO costs'));
    assert.ok(insertCall, 'expected an INSERT INTO costs call');
    assert.equal(insertCall.sql.includes('status'), false, 'generic sync must not write the costs.status column');
});

test('generic sync cannot set hotel status or soft-delete a hotel', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { hotels: [{ uuid: HOTEL_A_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, name: 'Hotel', status: 'CANCELLED', deletedAt: Date.now(), revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const insertCall = calls.find(call => call.sql.includes('INSERT INTO hotels'));
    assert.ok(insertCall, 'expected an INSERT INTO hotels call');
    assert.equal(insertCall.sql.includes('status'), false, 'generic sync must not write the hotels.status column');
    assert.equal(insertCall.sql.includes('deleted_at'), false, 'generic sync must not write hotels.deleted_at');
});

test('generic sync rejects all cargo writes: no mobile creation path, no status/deleted_at bypass', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: {
            changes: {
                cargo: [
                    { uuid: CARGO_A_UUID, driverUuid: DRIVER_A_UUID, companyUuid: COMPANY_A_UUID, status: 'DELIVERED', revision: 1 },
                    { uuid: '10101010-1010-4101-8101-101010101010', driverUuid: DRIVER_A_UUID, companyUuid: COMPANY_A_UUID, name: 'Forged cargo', revision: 1 }
                ]
            }
        }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected.every(item => item.error === 'CARGO_SYNC_WRITE_NOT_SUPPORTED'), true);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO cargo')), false);
});

test('generic sync cannot mutate a work day the admin has already approved', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { work_days: [{ uuid: WORK_DAY_LOCKED_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, totalWorkMs: 999999, revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected[0].error, 'WORK_DAY_LOCKED');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_days')), false);
});

test('generic sync still allows writes to an open (not approved) work day', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { work_days: [{ uuid: WORK_DAY_OPEN_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, notes: 'still open', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected.length, 0);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_days')), true);
});

test('generic sync cannot mutate an entry belonging to an already-approved work day', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { work_time_entries: [{ uuid: WORK_ENTRY_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, workDayUuid: WORK_DAY_LOCKED_UUID, status: 'WORK', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected[0].error, 'WORK_DAY_LOCKED');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_time_entries')), false);
});

test('generic sync cannot mutate an entry under an approved work day by omitting work_day_uuid', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        // work_day_uuid / workDayUuid deliberately omitted: the stored parent of the
        // existing entry is the approved work day and must stay authoritative.
        body: { changes: { work_time_entries: [{ uuid: WORK_ENTRY_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, status: 'WORK', startTime: 1, endTime: 2, revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected[0]?.error, 'WORK_DAY_LOCKED');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_time_entries')), false);
});

test('generic sync cannot reparent an entry out of an approved work day into an open one', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        // Existing entry's stored parent is the APPROVED day; client supplies an OPEN day instead.
        body: { changes: { work_time_entries: [{ uuid: WORK_ENTRY_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, workDayUuid: WORK_DAY_OPEN_UUID, status: 'WORK', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.match(String(body.rejected[0]?.error), /WORK_DAY_LOCKED|WORK_DAY_REPARENT_NOT_SUPPORTED/);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_time_entries')), false);
});

test('generic sync cannot move an entry between two open work days', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        // Stored parent is open (so the lock check passes) but the client points the entry
        // at a different open day: the reparent itself must still be refused.
        body: { changes: { work_time_entries: [{ uuid: WORK_ENTRY_OPEN_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, workDayUuid: WORK_DAY_OPEN2_UUID, status: 'WORK', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected[0]?.error, 'WORK_DAY_REPARENT_NOT_SUPPORTED');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_time_entries')), false);
});

test('generic sync still allows updating an entry under an open work day', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { work_time_entries: [{ uuid: WORK_ENTRY_OPEN_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, workDayUuid: WORK_DAY_OPEN_UUID, status: 'WORK', revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const body = JSON.parse(res.text);
    assert.equal(body.rejected.length, 0, res.text);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO work_time_entries')), true);
});

test('generic sync cannot set tour_status or is_closed on an existing tour (bypassing completion-blocking)', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { tours: [{ uuid: TOUR_A_UUID, driverUuid: DRIVER_A_UUID, driverName: 'Driver A', companyUuid: COMPANY_A_UUID, name: 'Tour A', tourStatus: 'COMPLETED', isClosed: true, revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const insertCall = calls.find(call => call.sql.includes('INSERT INTO tours'));
    assert.ok(insertCall, 'expected an INSERT INTO tours call');
    assert.equal(insertCall.sql.includes('tour_status'), false, 'generic sync must not write tours.tour_status');
    assert.equal(insertCall.sql.includes('is_closed'), false, 'generic sync must not write tours.is_closed');
});

test('generic sync cannot set stop_status or is_completed on an existing stop (bypassing cargo-blocking)', async () => {
    const { app, calls } = createApp();
    const res = await request(app, {
        method: 'POST',
        path: '/api/sync',
        headers: authHeaders(),
        body: { changes: { stops: [{ uuid: STOP_A_UUID, driverUuid: DRIVER_A_UUID, companyUuid: COMPANY_A_UUID, address: 'Stop A', stopStatus: 'COMPLETED', isCompleted: true, revision: 1 }] } }
    });
    assert.equal(res.status, 200, res.text);
    const insertCall = calls.find(call => call.sql.includes('INSERT INTO stops'));
    assert.ok(insertCall, 'expected an INSERT INTO stops call');
    assert.equal(insertCall.sql.includes('stop_status'), false, 'generic sync must not write stops.stop_status');
    assert.equal(insertCall.sql.includes('is_completed'), false, 'generic sync must not write stops.is_completed');
});
