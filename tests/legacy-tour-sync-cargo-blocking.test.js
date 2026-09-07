const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const TOUR_UUID = '33333333-3333-4333-8333-333333333333';
const STOP_UUID = '44444444-4444-4444-8444-444444444444';
const CARGO_UUID = '55555555-5555-4555-8555-555555555555';
const TOUR_ID = 10;
const STOP_ID = 20;

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function authHeaders() {
    return {
        'x-device-id': 'device-a',
        'x-device-token': 'secret-a',
        'x-driver-uuid': DRIVER_A_UUID
    };
}

function request(app, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method: 'POST',
                path: '/api/sync-tours/Driver%20A',
                headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, text })));
            });
            req.on('error', error => server.close(() => reject(error)));
            req.write(data);
            req.end();
        });
    });
}

// Simulates just enough of the tour/stop/cargo tables for ImportEngine.processTour to run,
// including applying its writes, so a cargo status supplied in the same payload is visible
// to any later read inside the same sync.
function createApp({ cargo = [] } = {}) {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];
    const db = {
        // Owned by the authenticated driver, as a real row would be.
        tours: [{ id: TOUR_ID, uuid: TOUR_UUID, updated_at: 100, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', company_uuid: null }],
        stops: [{ id: STOP_ID, uuid: STOP_UUID, tour_id: TOUR_ID, stop_status: 'PENDING', is_completed: false, order_index: 0 }],
        cargo: cargo.map(item => ({
            id: 1,
            uuid: CARGO_UUID,
            tour_id: TOUR_ID,
            name: 'Machine',
            serial_number: 'SN-1',
            pickup_stop_id: null,
            delivery_stop_id: null,
            deleted_at: null,
            ...item
        }))
    };

    async function clientQuery(sql, params = []) {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

        if (sql.startsWith('SELECT') && sql.includes('FROM tours WHERE uuid')) {
            const row = db.tours.find(t => t.uuid === params[0]);
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }

        // Prior stop state lookup (used by the fix to detect real transitions). Rows are
        // copied, the way a real query returns detached rows: a later UPDATE in the same
        // transaction must not retroactively change what this read returned.
        if (sql.startsWith('SELECT') && sql.includes('FROM stops') && sql.includes('stop_status') && sql.includes('tour_id = $1')) {
            const rows = db.stops.filter(s => s.tour_id === params[0]).map(s => ({ ...s }));
            return { rows, rowCount: rows.length };
        }

        if (sql.includes('INSERT INTO stops')) {
            const uuid = params[0] || STOP_UUID;
            const incomingCompleted = params[21];
            const incomingStatus = params[22];
            const existing = db.stops.find(s => s.uuid === uuid);
            if (existing) {
                existing.is_completed = existing.is_completed || !!incomingCompleted;
                if (!['COMPLETED', 'SKIPPED'].includes(existing.stop_status)) existing.stop_status = incomingStatus || existing.stop_status;
            } else {
                db.stops.push({ id: 99, uuid, tour_id: params[1], is_completed: !!incomingCompleted, stop_status: incomingStatus, order_index: params[18] });
            }
            return { rows: [{ uuid }], rowCount: 1 };
        }

        // Revert of a refused completion (the fix).
        if (sql.includes('UPDATE stops SET') && sql.includes('stop_status')) {
            // Mirrors the real statement: uuid is $4 and the tour scope, when present, is $5.
            const [status, isCompleted, , uuid, tourId] = params;
            const scopesTour = sql.includes('tour_id = $5');
            const target = db.stops.find(s => String(s.uuid) === String(uuid)
                && (!scopesTour || s.tour_id === tourId));
            if (target) {
                target.stop_status = status;
                target.is_completed = !!isCompleted;
            }
            return { rows: [], rowCount: target ? 1 : 0 };
        }

        // Cargo pickup/delivery order sequence validation (existing, non-blocking).
        if (sql.includes('FROM cargo c') && sql.includes('JOIN stops')) return { rows: [], rowCount: 0 };

        if (sql.includes('SELECT uuid, id FROM stops WHERE tour_id')) {
            return { rows: db.stops.map(s => ({ uuid: s.uuid, id: s.id })), rowCount: db.stops.length };
        }

        // Stored-cargo read backing the mobile transition authority check.
        if (sql.startsWith('SELECT') && sql.includes('FROM cargo') && sql.includes('ANY')) {
            const wanted = (params[1] || []).map(String);
            const rows = db.cargo
                .filter(c => c.tour_id === params[0] && wanted.includes(String(c.uuid)))
                .map(c => ({ ...c }));
            return { rows, rowCount: rows.length };
        }

        // Authoritative cargo-blocking read (present only once the fix exists).
        if (sql.includes('FROM cargo') && sql.includes('pickup_stop_id') && sql.includes('tour_id = $1') && !sql.includes('INSERT')) {
            const stopId = params[1];
            const rows = db.cargo
                .filter(c => c.tour_id === params[0] && c.deleted_at === null
                    && (stopId === undefined || c.pickup_stop_id === stopId || c.delivery_stop_id === stopId))
                .map(c => ({ ...c }));
            return { rows, rowCount: rows.length };
        }

        // Narrow mobile transition update (status only, scoped to this tour).
        if (sql.startsWith('UPDATE cargo SET')) {
            const [status, , , updatedAt, uuid, tourId] = params;
            const target = db.cargo.find(c => String(c.uuid) === String(uuid) && c.tour_id === tourId);
            if (target) {
                target.status = status;
                target.updated_at = updatedAt;
            }
            return { rows: [], rowCount: target ? 1 : 0 };
        }

        if (sql.includes('INSERT INTO cargo_events')) return { rows: [], rowCount: 1 };

        if (sql.includes('INSERT INTO cargo')) {
            const uuid = params[0];
            const status = params[18];
            const existing = db.cargo.find(c => c.uuid === uuid);
            if (existing) existing.status = status;
            return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
    }

    pool.query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM driver_devices')) {
            const [deviceId, driverUuid] = params;
            if (deviceId === 'device-a' && driverUuid === DRIVER_A_UUID) {
                return { rows: [{ device_token_hash: hashToken('secret-a'), is_active: true, driver_active: true, deleted_at: null, driver_name: 'Driver A', driver_company_uuid: null }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    };
    pool.connect = async () => ({ query: clientQuery, release: () => {} });

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'td009-test'; next(); });
    app.use(express.json());
    const createSyncTourRoutes = require('../src/routes/sync-tour.routes');
    const ImportEngine = require('../src/engines/import-engine');
    app.use(createSyncTourRoutes({ ImportEngine }));
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    return { app, calls, db };
}

function completeStopPayload({ cargo } = {}) {
    return [{
        tour: { uuid: TOUR_UUID, name: 'Own tour', updated_at: 200 },
        stops: [{
            uuid: STOP_UUID,
            address: 'Stop 1',
            recipient: 'Recipient',
            order_index: 0,
            stop_status: 'COMPLETED',
            is_completed: true,
            updated_at: 200
        }],
        ...(cargo ? { cargo } : {})
    }];
}

test('stop completion is refused while a pickup at that stop is still pending', async () => {
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: STOP_ID, status: 'READY_FOR_PICKUP' }] });
    const res = await request(app, { headers: authHeaders(), body: completeStopPayload() });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must not be completed while pickup is pending');
    assert.notEqual(stop.stop_status, 'COMPLETED');
});

test('stop completion is refused while a delivery at that stop is still pending', async () => {
    const { app, db } = createApp({ cargo: [{ delivery_stop_id: STOP_ID, status: 'IN_TRANSIT' }] });
    const res = await request(app, { headers: authHeaders(), body: completeStopPayload() });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must not be completed while delivery is pending');
    assert.notEqual(stop.stop_status, 'COMPLETED');
});

test('stop completion succeeds once the cargo at that stop is delivered', async () => {
    const { app, db } = createApp({ cargo: [{ delivery_stop_id: STOP_ID, status: 'DELIVERED' }] });
    const res = await request(app, { headers: authHeaders(), body: completeStopPayload() });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, true, 'satisfied cargo must not block completion');
    assert.equal(stop.stop_status, 'COMPLETED');
});

test('terminal cargo states (cancelled) do not block stop completion', async () => {
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: STOP_ID, status: 'CANCELLED' }] });
    const res = await request(app, { headers: authHeaders(), body: completeStopPayload() });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, true, 'cancelled cargo must not block completion');
});

test('offline batch that picks the cargo up and completes the stop together still succeeds', async () => {
    // The driver did both offline: the cargo transition arrives in the same payload as the
    // stop completion, so the check must evaluate the post-sync cargo state, not the stale one.
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: STOP_ID, status: 'READY_FOR_PICKUP' }] });
    const res = await request(app, {
        headers: authHeaders(),
        body: completeStopPayload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', updated_at: 200 }] })
    });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, true, 'legitimate offline pickup+complete batch must sync');
    assert.equal(stop.stop_status, 'COMPLETED');
});

test('a stop already completed on the server is not re-blocked by later pending cargo', async () => {
    // Android re-sends every tour on each sync cycle. An already-completed stop must not
    // start failing just because cargo was later moved back into a pending state.
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: STOP_ID, status: 'READY_FOR_PICKUP' }] });
    db.stops[0].is_completed = true;
    db.stops[0].stop_status = 'COMPLETED';
    const res = await request(app, { headers: authHeaders(), body: completeStopPayload() });
    assert.equal(res.status, 200, res.text);
    const stop = db.stops.find(s => s.uuid === STOP_UUID);
    assert.equal(stop.is_completed, true, 'pre-existing completion must be preserved');
    assert.equal(stop.stop_status, 'COMPLETED');
});
