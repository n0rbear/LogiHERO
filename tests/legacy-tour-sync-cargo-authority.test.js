// Adversarial coverage for the legacy mobile bulk sync's cargo writes.
//
// TD-009 refuses a stop completion while cargo at that stop is still pending, but it reads
// cargo state *after* the payload's own cargo rows have been applied. If the client can also
// forge that cargo state in the same payload, the blocking rule is satisfied with
// attacker-controlled data. These tests pin down what a mobile payload may and may not do to
// cargo, and that the composition of the two cannot bypass the rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const TOUR_UUID = '33333333-3333-4333-8333-333333333333';
const PICKUP_STOP_UUID = '44444444-4444-4444-8444-444444444444';
const OTHER_STOP_UUID = '66666666-6666-4666-8666-666666666666';
const CARGO_UUID = '55555555-5555-4555-8555-555555555555';
const FOREIGN_CARGO_UUID = '77777777-7777-4777-8777-777777777777';
const SECOND_CARGO_UUID = '99999999-9999-4999-8999-999999999999';
const TOUR_ID = 10;
const FOREIGN_TOUR_ID = 99;
const PICKUP_STOP_ID = 20;
const OTHER_STOP_ID = 21;

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function authHeaders() {
    return { 'x-device-id': 'device-a', 'x-device-token': 'secret-a', 'x-driver-uuid': DRIVER_A_UUID };
}

function request(app, { body }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method: 'POST',
                path: '/api/sync-tours/Driver%20A',
                headers: { ...authHeaders(), 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
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

// Rows handed back from SELECTs are copies, the way real result rows are detached from
// whatever a later statement in the same transaction writes.
function createApp({ cargo = [] } = {}) {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const db = {
        // Owned by the authenticated driver, as a real row would be.
        tours: [{ id: TOUR_ID, uuid: TOUR_UUID, updated_at: 100, driver_uuid: DRIVER_A_UUID, driver_name: 'Driver A', company_uuid: null }],
        stops: [
            { id: PICKUP_STOP_ID, uuid: PICKUP_STOP_UUID, tour_id: TOUR_ID, stop_status: 'PENDING', is_completed: false, order_index: 0 },
            { id: OTHER_STOP_ID, uuid: OTHER_STOP_UUID, tour_id: TOUR_ID, stop_status: 'PENDING', is_completed: false, order_index: 1 }
        ],
        cargo: cargo.map(item => ({
            id: 1,
            uuid: CARGO_UUID,
            tour_id: TOUR_ID,
            name: 'Machine',
            serial_number: 'SN-1',
            type: 'MACHINE',
            quantity: 1,
            pickup_stop_id: null,
            delivery_stop_id: null,
            deleted_at: null,
            updated_at: 100,
            ...item
        })),
        cargoEvents: [],
        cargoWrites: []
    };

    async function clientQuery(sql, params = []) {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

        if (sql.startsWith('SELECT') && sql.includes('FROM tours WHERE uuid')) {
            const row = db.tours.find(t => t.uuid === params[0]);
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }

        if (sql.startsWith('SELECT') && sql.includes('FROM stops') && sql.includes('stop_status') && sql.includes('tour_id = $1')) {
            const rows = db.stops.filter(s => s.tour_id === params[0]).map(s => ({ ...s }));
            return { rows, rowCount: rows.length };
        }

        if (sql.includes('INSERT INTO stops')) {
            const uuid = params[0];
            const incomingCompleted = params[21];
            const incomingStatus = params[22];
            const existing = db.stops.find(s => s.uuid === uuid);
            if (existing) {
                existing.is_completed = existing.is_completed || !!incomingCompleted;
                if (!['COMPLETED', 'SKIPPED'].includes(existing.stop_status)) existing.stop_status = incomingStatus || existing.stop_status;
            }
            return { rows: [{ uuid }], rowCount: 1 };
        }

        if (sql.includes('UPDATE stops SET') && sql.includes('stop_status')) {
            const target = db.stops.find(s => String(s.uuid) === String(params[params.length - 1]));
            if (target) {
                target.stop_status = params[0];
                target.is_completed = !!params[1];
            }
            return { rows: [], rowCount: target ? 1 : 0 };
        }

        if (sql.includes('FROM cargo c') && sql.includes('JOIN stops')) return { rows: [], rowCount: 0 };

        if (sql.includes('SELECT uuid, id FROM stops WHERE tour_id')) {
            const rows = db.stops.filter(s => s.tour_id === params[0]).map(s => ({ uuid: s.uuid, id: s.id }));
            return { rows, rowCount: rows.length };
        }

        // Stored-cargo read used by the fix to establish authoritative current state. The
        // deleted_at filter is applied only when the statement actually asks for it, so this
        // models the real database rather than silently enforcing the invariant for the code.
        if (sql.startsWith('SELECT') && sql.includes('FROM cargo') && sql.includes('uuid') && sql.includes('ANY')) {
            const wanted = (params[1] || []).map(String);
            const excludesDeleted = sql.includes('deleted_at IS NULL');
            const rows = db.cargo
                .filter(c => c.tour_id === params[0] && wanted.includes(String(c.uuid))
                    && (!excludesDeleted || c.deleted_at === null))
                .map(c => ({ ...c }));
            return { rows, rowCount: rows.length };
        }

        // Authoritative cargo-blocking read (TD-009).
        if (sql.includes('FROM cargo') && sql.includes('pickup_stop_id') && sql.includes('tour_id = $1') && !sql.includes('INSERT')) {
            const stopId = params[1];
            const rows = db.cargo
                .filter(c => c.tour_id === params[0] && c.deleted_at === null
                    && (stopId === undefined || c.pickup_stop_id === stopId || c.delivery_stop_id === stopId))
                .map(c => ({ ...c }));
            return { rows, rowCount: rows.length };
        }

        // Narrow mobile transition update (status + conditions only), scoped to this tour.
        if (sql.startsWith('UPDATE cargo SET')) {
            const [status, conditionAtPickup, conditionAtDelivery, updatedAt, uuid, tourId] = params;
            db.cargoWrites.push({ status, conditionAtPickup, conditionAtDelivery, uuid });
            const excludesDeleted = sql.includes('deleted_at IS NULL');
            const target = db.cargo.find(c => String(c.uuid) === String(uuid) && c.tour_id === tourId
                && (!excludesDeleted || c.deleted_at === null));
            if (target) {
                target.status = status;
                target.updated_at = updatedAt;
            }
            return { rows: [], rowCount: target ? 1 : 0 };
        }

        if (sql.includes('INSERT INTO cargo_events')) {
            db.cargoEvents.push({ cargoId: params[0], eventType: params[1], fromStatus: params[2], toStatus: params[3], actorType: params[4] });
            return { rows: [], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO cargo')) {
            const [uuid, tourId, pickupStopId, deliveryStopId] = params;
            const status = params[18];
            const updatedAt = params[23];
            const deletedAt = params[24];
            const existing = db.cargo.find(c => c.uuid === uuid);
            if (existing) {
                // ON CONFLICT ... WHERE cargo.updated_at IS NULL OR EXCLUDED.updated_at >= cargo.updated_at
                if (existing.updated_at === null || Number(updatedAt) >= Number(existing.updated_at)) {
                    existing.tour_id = tourId;
                    existing.pickup_stop_id = pickupStopId ?? null;
                    existing.delivery_stop_id = deliveryStopId ?? null;
                    existing.status = status;
                    existing.updated_at = updatedAt;
                    existing.deleted_at = deletedAt ?? null;
                }
            } else {
                db.cargo.push({ id: db.cargo.length + 100, uuid, tour_id: tourId, pickup_stop_id: pickupStopId ?? null, delivery_stop_id: deliveryStopId ?? null, status, updated_at: updatedAt, deleted_at: deletedAt ?? null, name: params[7] });
            }
            return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
    }

    pool.query = async (sql, params = []) => {
        if (sql.includes('FROM driver_devices')) {
            const [deviceId, driverUuid] = params;
            if (deviceId === 'device-a' && driverUuid === DRIVER_A_UUID) {
                return { rows: [{ device_token_hash: hashToken('secret-a'), is_active: true, driver_active: true, deleted_at: null, driver_name: 'Driver A', driver_company_uuid: null }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
    };
    pool.connect = async () => ({ query: clientQuery, release: () => {} });

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'cargo-authority-test'; next(); });
    app.use(express.json());
    const createSyncTourRoutes = require('../src/routes/sync-tour.routes');
    const ImportEngine = require('../src/engines/import-engine');
    app.use(createSyncTourRoutes({ ImportEngine }));
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    return { app, db };
}

function payload({ cargo, completePickupStop = false } = {}) {
    const stop = {
        uuid: PICKUP_STOP_UUID,
        address: 'Stop 1',
        recipient: 'Recipient',
        order_index: 0,
        updated_at: 200,
        ...(completePickupStop ? { stop_status: 'COMPLETED', is_completed: true } : { stop_status: 'PENDING' })
    };
    return [{ tour: { uuid: TOUR_UUID, name: 'Own tour', updated_at: 200 }, stops: [stop], ...(cargo ? { cargo } : {}) }];
}

const blockingPickupCargo = { pickup_stop_id: PICKUP_STOP_ID, status: 'READY_FOR_PICKUP' };

test('Attack A: forged terminal cargo state cannot unlock a pickup stop', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'DELIVERED', updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'READY_FOR_PICKUP', 'illegal READY_FOR_PICKUP -> DELIVERED leap must be refused');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must stay blocked by the still-pending pickup');
});

test('Attack B: forged cancellation cannot unlock a delivery stop', async () => {
    const { app, db } = createApp({ cargo: [{ delivery_stop_id: PICKUP_STOP_ID, status: 'IN_TRANSIT' }] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'CANCELLED', updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'IN_TRANSIT', 'CANCELLED is not a driver transition and must be refused');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must stay blocked by the pending delivery');
});

test('Attack C: soft-deleting blocking cargo cannot unlock the stop', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'READY_FOR_PICKUP', deleted_at: 12345, updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.deleted_at, null, 'mobile sync must not soft-delete cargo');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must stay blocked');
});

test('Attack D: reassigning cargo to another stop cannot unlock the stop', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'READY_FOR_PICKUP', pickup_stop_id: OTHER_STOP_ID, updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.pickup_stop_id, PICKUP_STOP_ID, 'mobile sync must not re-point cargo at another stop');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must stay blocked');
});

test('Attack E: omitting cargo from the payload leaves server cargo blocking', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, { body: payload({ completePickupStop: true }) });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'READY_FOR_PICKUP', 'omitted cargo must be left untouched');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'stop must stay blocked');
});

test('Attack F: illegal lifecycle leap is refused even without any stop completion', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'DELIVERED', updated_at: 300 }] })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'READY_FOR_PICKUP', 'cargo lifecycle integrity must not depend on stop completion');
});

test('cargo belonging to another tour cannot be pulled into this tour', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    db.cargo.push({ id: 500, uuid: FOREIGN_CARGO_UUID, tour_id: FOREIGN_TOUR_ID, status: 'PLANNED', pickup_stop_id: null, delivery_stop_id: null, deleted_at: null, updated_at: 100, name: 'Foreign' });
    const res = await request(app, {
        body: payload({ cargo: [{ uuid: FOREIGN_CARGO_UUID, name: 'Stolen', status: 'PICKED_UP', updated_at: 300 }] })
    });
    assert.equal(res.status, 200, res.text);
    const foreign = db.cargo.find(c => c.uuid === FOREIGN_CARGO_UUID);
    assert.equal(foreign.tour_id, FOREIGN_TOUR_ID, 'foreign cargo must not be reassigned into the synced tour');
    assert.equal(foreign.status, 'PLANNED', 'foreign cargo status must not be changed');
});

test('mobile sync cannot create new cargo rows', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const before = db.cargo.length;
    const res = await request(app, {
        body: payload({ cargo: [{ uuid: '88888888-8888-4888-8888-888888888888', name: 'Invented', status: 'PLANNED', updated_at: 300 }] })
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(db.cargo.length, before, 'cargo creation is admin-only and must not happen through mobile sync');
});

test('legitimate offline pickup is accepted and then unblocks the stop', async () => {
    // The real Android flow: the driver picked the cargo up offline (local status PICKED_UP,
    // dedicated endpoint call lost) and closed the stop; both arrive in one later sync.
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'PICKED_UP', 'a legal driver transition must still be accepted offline');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, true, 'the stop must complete once its pickup is genuinely done');
});

test('legitimate offline delivery is accepted and then unblocks the stop', async () => {
    const { app, db } = createApp({ cargo: [{ delivery_stop_id: PICKUP_STOP_ID, status: 'IN_TRANSIT' }] });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'DELIVERED', updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'DELIVERED', 'IN_TRANSIT -> DELIVERED is a legal driver transition');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, true, 'the stop must complete once its delivery is genuinely done');
});

test('one satisfied cargo does not unblock a stop while another is still pending', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    db.cargo.push({
        id: 2, uuid: SECOND_CARGO_UUID, tour_id: TOUR_ID, name: 'Second', serial_number: 'SN-2',
        pickup_stop_id: PICKUP_STOP_ID, delivery_stop_id: null, status: 'READY_FOR_PICKUP',
        deleted_at: null, updated_at: 100
    });
    const res = await request(app, {
        body: payload({
            completePickupStop: true,
            // Only the first item is genuinely picked up; the second stays pending.
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', updated_at: 300 }]
        })
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(db.cargo.find(c => c.uuid === CARGO_UUID).status, 'PICKED_UP');
    assert.equal(db.cargo.find(c => c.uuid === SECOND_CARGO_UUID).status, 'READY_FOR_PICKUP');
    const stop = db.stops.find(s => s.uuid === PICKUP_STOP_UUID);
    assert.equal(stop.is_completed, false, 'a single remaining blocker must keep the stop blocked');
});

test('re-sending an already-applied transition is idempotent and writes no second event', async () => {
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: PICKUP_STOP_ID, status: 'PICKED_UP', updated_at: 300 }] });
    const body = payload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', updated_at: 300 }] });
    await request(app, { body });
    await request(app, { body });
    assert.equal(db.cargo.find(c => c.uuid === CARGO_UUID).status, 'PICKED_UP');
    assert.equal(db.cargoEvents.length, 0, 'repeating known state must not manufacture lifecycle events');
});

test('a soft-deleted cargo row cannot be transitioned through mobile sync', async () => {
    const { app, db } = createApp({ cargo: [{ pickup_stop_id: PICKUP_STOP_ID, status: 'READY_FOR_PICKUP', deleted_at: 999 }] });
    const res = await request(app, {
        body: payload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', updated_at: 300 }] })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'READY_FOR_PICKUP', 'deleted cargo is out of scope for the driver lifecycle');
    assert.equal(db.cargoEvents.length, 0, 'no audit event for a refused transition');
});

test('condition fields are only accepted on the transition they belong to', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    await request(app, {
        body: payload({
            // A pickup must not be able to write the delivery condition.
            cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'PICKED_UP', conditionAtPickup: 'ok', conditionAtDelivery: 'forged', updated_at: 300 }]
        })
    });
    const write = db.cargoWrites.at(-1);
    assert.equal(write.conditionAtPickup, 'ok', 'the pickup condition belongs to a pickup');
    assert.equal(write.conditionAtDelivery, null, 'the delivery condition must not ride along on a pickup');
});

test('an accepted transition writes exactly one audit event with driver attribution', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    await request(app, {
        body: payload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'DAMAGED', updated_at: 300 }] })
    });
    assert.equal(db.cargoEvents.length, 1);
    assert.equal(db.cargoEvents[0].eventType, 'DAMAGED_REPORTED', 'audit vocabulary must match the dedicated route');
    assert.equal(db.cargoEvents[0].fromStatus, 'READY_FOR_PICKUP');
    assert.equal(db.cargoEvents[0].toStatus, 'DAMAGED');
    assert.equal(db.cargoEvents[0].actorType, 'DRIVER');
});

test('legitimate offline damage report is accepted', async () => {
    const { app, db } = createApp({ cargo: [blockingPickupCargo] });
    const res = await request(app, {
        body: payload({ cargo: [{ uuid: CARGO_UUID, name: 'Machine', status: 'DAMAGED', updated_at: 300 }] })
    });
    assert.equal(res.status, 200, res.text);
    const cargo = db.cargo.find(c => c.uuid === CARGO_UUID);
    assert.equal(cargo.status, 'DAMAGED', 'reporting damage is a legal driver transition');
});
