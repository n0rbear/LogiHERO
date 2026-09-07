// TD-010: the legacy mobile tour sync resolves the tour from a client-supplied UUID. These
// tests drive the real route, with real device authentication, against real PostgreSQL, and
// pin down that an authenticated driver can only ever reach their own tour.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const pool = require('../src/database/pool');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const A_UUID = 'a0000000-0000-4000-8000-00000000000a';
const B_UUID = 'b0000000-0000-4000-8000-00000000000b';
const C_UUID = 'c0000000-0000-4000-8000-00000000000c';
const COMPANY_1 = 'c1000000-0000-4000-8000-000000000001';
const COMPANY_2 = 'c2000000-0000-4000-8000-000000000002';
const A_NAME = 'TD010 Driver A';
const B_NAME = 'TD010 Driver B';
const C_NAME = 'TD010 Driver C';
const DEVICE_A = 'td010-device-a';
const TOKEN_A = 'td010-secret-a';

function buildApp() {
    const app = express();
    app.use((req, _res, next) => { req.requestId = 'td010-test'; next(); });
    app.use(express.json());
    const createSyncTourRoutes = require('../src/routes/sync-tour.routes');
    const ImportEngine = require('../src/engines/import-engine');
    app.use(createSyncTourRoutes({ ImportEngine }));
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    return app;
}

function post(app, pathname, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method: 'POST',
                path: pathname,
                headers: {
                    'x-device-id': DEVICE_A,
                    'x-device-token': TOKEN_A,
                    'x-driver-uuid': A_UUID,
                    ...headers,
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(data)
                }
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', c => { text += c; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, text })));
            });
            req.on('error', e => server.close(() => reject(e)));
            req.write(data);
            req.end();
        });
    });
}

async function cleanup() {
    await pool.query("DELETE FROM cargo_events WHERE cargo_id IN (SELECT id FROM cargo WHERE driver_name LIKE 'TD010%' OR name LIKE 'TD010%')");
    await pool.query("DELETE FROM cargo WHERE name LIKE 'TD010%' OR driver_name LIKE 'TD010%'");
    await pool.query("DELETE FROM stops WHERE tour_id IN (SELECT id FROM tours WHERE driver_name LIKE 'TD010%')");
    await pool.query("DELETE FROM tours WHERE driver_name LIKE 'TD010%'");
    await pool.query("DELETE FROM driver_devices WHERE device_id = $1", [DEVICE_A]);
    await pool.query("DELETE FROM drivers WHERE name LIKE 'TD010%'");
}

// Seeds driver A (the caller), plus an owner driver and a tour owned by them.
async function seed({ ownerUuid, ownerName, ownerCompany }) {
    await pool.query(
        "INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)",
        [A_UUID, COMPANY_1, A_NAME]
    );
    if (ownerUuid !== A_UUID) {
        await pool.query(
            "INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)",
            [ownerUuid, ownerCompany, ownerName]
        );
    }
    await pool.query(
        "INSERT INTO driver_devices (driver_uuid, device_id, device_token_hash, is_active) VALUES ($1,$2,$3,true)",
        [A_UUID, DEVICE_A, hashToken(TOKEN_A)]
    );
    const tour = await pool.query(
        "INSERT INTO tours (driver_uuid, driver_name, company_uuid, name, updated_at) VALUES ($1,$2,$3,'TD010 Tour',100) RETURNING id, uuid",
        [ownerUuid, ownerName, ownerCompany]
    );
    const stop = await pool.query(
        "INSERT INTO stops (tour_id, address, recipient, order_index, stop_status, is_completed, updated_at) VALUES ($1,'TD010 Addr','TD010 Recipient',0,'PENDING',false,100) RETURNING id, uuid",
        [tour.rows[0].id]
    );
    const cargo = await pool.query(
        "INSERT INTO cargo (tour_id, pickup_stop_id, name, status, updated_at) VALUES ($1,$2,'TD010 Cargo','READY_FOR_PICKUP',100) RETURNING id, uuid",
        [tour.rows[0].id, stop.rows[0].id]
    );
    return { tour: tour.rows[0], stop: stop.rows[0], cargo: cargo.rows[0] };
}

function syncBody(fixture, { cargo, stops } = {}) {
    return [{
        tour: { uuid: fixture.tour.uuid, name: 'TD010 Tour', updated_at: 200 },
        stops: stops || [{
            uuid: fixture.stop.uuid,
            address: 'TD010 Addr',
            recipient: 'HIJACKED',
            order_index: 0,
            stop_status: 'ARRIVED',
            updated_at: 200
        }],
        ...(cargo ? { cargo } : {})
    }];
}

test('TD-010 legacy tour sync owner scope (real PostgreSQL)', async (t) => {
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        t.skip(`Local PostgreSQL unavailable: ${e.code || e.message}`);
        return;
    }
    const app = buildApp();

    await t.test('Attack A: cannot mutate cargo on another driver tour', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: B_UUID, ownerName: B_NAME, ownerCompany: COMPANY_1 });
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture, {
                cargo: [{ uuid: fixture.cargo.uuid, name: 'TD010 Cargo', status: 'PICKED_UP', updated_at: 300 }]
            }));
            assert.equal(res.status < 500, true, res.text);
            const cargo = await pool.query('SELECT status FROM cargo WHERE id = $1', [fixture.cargo.id]);
            assert.equal(cargo.rows[0].status, 'READY_FOR_PICKUP', 'foreign cargo must not be transitioned');
        } finally {
            await cleanup();
        }
    });

    await t.test('Attack B: cannot mutate an existing stop on another driver tour', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: B_UUID, ownerName: B_NAME, ownerCompany: COMPANY_1 });
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture));
            const stop = await pool.query('SELECT stop_status FROM stops WHERE id = $1', [fixture.stop.id]);
            assert.equal(stop.rows[0].stop_status, 'PENDING', 'foreign stop lifecycle must not be advanced');
        } finally {
            await cleanup();
        }
    });

    await t.test('Attack C: cannot create a new stop under another driver tour', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: B_UUID, ownerName: B_NAME, ownerCompany: COMPANY_1 });
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture, {
                stops: [{ uuid: 'dd000000-0000-4000-8000-0000000000dd', address: 'TD010 Injected', recipient: 'TD010 Injected', order_index: 5, stop_status: 'PENDING', updated_at: 200 }]
            }));
            const injected = await pool.query('SELECT id FROM stops WHERE tour_id = $1 AND address = $2', [fixture.tour.id, 'TD010 Injected']);
            assert.equal(injected.rowCount, 0, 'no stop may be injected into a foreign tour');
        } finally {
            await cleanup();
        }
    });

    await t.test('same company, different driver is still refused', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: B_UUID, ownerName: B_NAME, ownerCompany: COMPANY_1 });
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture));
            const stop = await pool.query('SELECT stop_status FROM stops WHERE id = $1', [fixture.stop.id]);
            assert.equal(stop.rows[0].stop_status, 'PENDING', 'sharing a company must not grant access');
        } finally {
            await cleanup();
        }
    });

    await t.test('different company is refused', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: C_UUID, ownerName: C_NAME, ownerCompany: COMPANY_2 });
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture));
            const stop = await pool.query('SELECT stop_status FROM stops WHERE id = $1', [fixture.stop.id]);
            assert.equal(stop.rows[0].stop_status, 'PENDING', 'cross-company access must be refused');
        } finally {
            await cleanup();
        }
    });

    await t.test('a foreign stop UUID cannot be mutated through an owned tour', async () => {
        // Same root cause: once a parent is authorized, a child named by UUID must not escape
        // that boundary. Here the tour genuinely belongs to A, but the stop belongs to B.
        await cleanup();
        const mine = await seed({ ownerUuid: A_UUID, ownerName: A_NAME, ownerCompany: COMPANY_1 });
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [B_UUID, COMPANY_1, B_NAME]);
        const foreignTour = await pool.query("INSERT INTO tours (driver_uuid, driver_name, company_uuid, name, updated_at) VALUES ($1,$2,$3,'TD010 Tour',100) RETURNING id", [B_UUID, B_NAME, COMPANY_1]);
        const foreignStop = await pool.query(
            "INSERT INTO stops (tour_id, address, recipient, order_index, stop_status, is_completed, updated_at) VALUES ($1,'TD010 Addr','TD010 Recipient',0,'PENDING',false,100) RETURNING id, uuid",
            [foreignTour.rows[0].id]
        );
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: mine.tour.uuid, name: 'TD010 Tour', updated_at: 200 },
                stops: [{ uuid: foreignStop.rows[0].uuid, address: 'TD010 Addr', order_index: 0, stop_status: 'COMPLETED', is_completed: true, updated_at: 200 }]
            }]);
            const after = await pool.query('SELECT stop_status, is_completed, tour_id FROM stops WHERE id = $1', [foreignStop.rows[0].id]);
            assert.equal(after.rows[0].stop_status, 'PENDING', 'a foreign stop must not be advanced through an owned tour');
            assert.equal(after.rows[0].is_completed, false);
            assert.equal(after.rows[0].tour_id, foreignTour.rows[0].id, 'a foreign stop must not be re-parented');
        } finally {
            await cleanup();
        }
    });

    await t.test('own tour still syncs normally', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: A_UUID, ownerName: A_NAME, ownerCompany: COMPANY_1 });
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, syncBody(fixture, {
                cargo: [{ uuid: fixture.cargo.uuid, name: 'TD010 Cargo', status: 'PICKED_UP', updated_at: 300 }]
            }));
            assert.equal(res.status, 200, res.text);
            const stop = await pool.query('SELECT stop_status FROM stops WHERE id = $1', [fixture.stop.id]);
            assert.equal(stop.rows[0].stop_status, 'ARRIVED', 'the owner may still advance their own stop');
            const cargo = await pool.query('SELECT status FROM cargo WHERE id = $1', [fixture.cargo.id]);
            assert.equal(cargo.rows[0].status, 'PICKED_UP', 'the owner may still transition their own cargo');
        } finally {
            await cleanup();
        }
    });

    await t.test('a new mobile-created tour is still created, stamped with the authenticated owner', async () => {
        // Android creates tours locally (manual add and AI import), so an unknown UUID must
        // still be accepted — now owned by the caller rather than by whatever the payload says.
        await cleanup();
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [A_UUID, COMPANY_1, A_NAME]);
        await pool.query("INSERT INTO driver_devices (driver_uuid, device_id, device_token_hash, is_active) VALUES ($1,$2,$3,true)", [A_UUID, DEVICE_A, hashToken(TOKEN_A)]);
        const newTourUuid = 'ee000000-0000-4000-8000-0000000000ee';
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                // A payload claiming someone else's ownership must not be believed.
                tour: { uuid: newTourUuid, name: 'TD010 Tour', driver_name: B_NAME, updated_at: 200 },
                stops: [{ uuid: 'ff000000-0000-4000-8000-0000000000ff', address: 'TD010 Addr', order_index: 0, stop_status: 'PENDING', updated_at: 200 }]
            }]);
            assert.equal(res.status, 200, res.text);
            const created = await pool.query('SELECT driver_uuid, driver_name, company_uuid FROM tours WHERE uuid = $1', [newTourUuid]);
            assert.equal(created.rowCount, 1, 'mobile tour creation must still work');
            assert.equal(created.rows[0].driver_uuid, A_UUID, 'ownership comes from the authenticated device');
            assert.equal(created.rows[0].driver_name, A_NAME, 'a payload-claimed driver_name must be ignored');
            assert.equal(created.rows[0].company_uuid, COMPANY_1);
        } finally {
            await cleanup();
        }
    });

    // The deleted-tour branch takes its own path through the route, so it needs its own proof
    // that it follows the same ownership rule rather than the driver_name match it used to.
    await t.test('delete path: a foreign tour and its stops cannot be deleted', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: B_UUID, ownerName: B_NAME, ownerCompany: COMPANY_1 });
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: fixture.tour.uuid, name: 'TD010 Tour', deletedAt: Date.now(), updated_at: 200 }
            }]);
            assert.equal(res.status, 200, res.text);
            const tour = await pool.query('SELECT deleted_at FROM tours WHERE id = $1', [fixture.tour.id]);
            assert.equal(tour.rows[0].deleted_at, null, 'a foreign tour must not be deleted');
            const stop = await pool.query('SELECT deleted_at FROM stops WHERE id = $1', [fixture.stop.id]);
            assert.equal(stop.rows[0].deleted_at, null, 'a foreign tour\'s stops must not be deleted');
        } finally {
            await cleanup();
        }
    });

    await t.test('delete path: a stale driver_name cannot delete a tour owned by someone else', async () => {
        // tours.driver_name is a denormalized copy. If a tour is reassigned (or a driver
        // renamed) so that driver_uuid says B while driver_name still reads A, the old
        // name-only delete matched and let A delete B's tour. Ownership now comes from the
        // UUID, and the name is only consulted for rows that have no driver_uuid at all.
        await cleanup();
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [A_UUID, COMPANY_1, A_NAME]);
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [B_UUID, COMPANY_1, B_NAME]);
        await pool.query("INSERT INTO driver_devices (driver_uuid, device_id, device_token_hash, is_active) VALUES ($1,$2,$3,true)", [A_UUID, DEVICE_A, hashToken(TOKEN_A)]);
        const tour = await pool.query(
            "INSERT INTO tours (driver_uuid, driver_name, company_uuid, name, updated_at) VALUES ($1,$2,$3,'TD010 Tour',100) RETURNING id, uuid",
            [B_UUID, A_NAME, COMPANY_1]
        );
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: tour.rows[0].uuid, name: 'TD010 Tour', deletedAt: Date.now(), updated_at: 200 }
            }]);
            assert.equal(res.status, 200, res.text);
            const after = await pool.query('SELECT deleted_at FROM tours WHERE id = $1', [tour.rows[0].id]);
            assert.equal(after.rows[0].deleted_at, null, 'a stale driver_name must not grant delete rights');
        } finally {
            await cleanup();
        }
    });

    await t.test('delete path: cross-company deletion is refused', async () => {
        await cleanup();
        const fixture = await seed({ ownerUuid: C_UUID, ownerName: C_NAME, ownerCompany: COMPANY_2 });
        try {
            await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: fixture.tour.uuid, name: 'TD010 Tour', deletedAt: Date.now(), updated_at: 200 }
            }]);
            const tour = await pool.query('SELECT deleted_at FROM tours WHERE id = $1', [fixture.tour.id]);
            assert.equal(tour.rows[0].deleted_at, null, 'cross-company deletion must be refused');
        } finally {
            await cleanup();
        }
    });

    await t.test('delete path: the owner can still delete a legacy NULL driver_uuid tour', async () => {
        await cleanup();
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [A_UUID, COMPANY_1, A_NAME]);
        await pool.query("INSERT INTO driver_devices (driver_uuid, device_id, device_token_hash, is_active) VALUES ($1,$2,$3,true)", [A_UUID, DEVICE_A, hashToken(TOKEN_A)]);
        const tour = await pool.query("INSERT INTO tours (driver_name, name, updated_at) VALUES ($1,'TD010 Tour',100) RETURNING id, uuid", [A_NAME]);
        const stop = await pool.query("INSERT INTO stops (tour_id, address, recipient, order_index, stop_status, is_completed, updated_at) VALUES ($1,'TD010 Addr','TD010 Recipient',0,'PENDING',false,100) RETURNING id", [tour.rows[0].id]);
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: tour.rows[0].uuid, name: 'TD010 Tour', deletedAt: Date.now(), updated_at: 200 }
            }]);
            assert.equal(res.status, 200, res.text);
            const after = await pool.query('SELECT deleted_at FROM tours WHERE id = $1', [tour.rows[0].id]);
            assert.notEqual(after.rows[0].deleted_at, null, 'the named owner of a legacy tour must still be able to delete it');
            const afterStop = await pool.query('SELECT deleted_at FROM stops WHERE id = $1', [stop.rows[0].id]);
            assert.notEqual(afterStop.rows[0].deleted_at, null, 'its stops must be soft-deleted too');
        } finally {
            await cleanup();
        }
    });

    await t.test('legacy tour with NULL driver_uuid still syncs for the named owner', async () => {
        // Tours created by earlier mobile syncs carry driver_name only; scoping must not
        // strand them.
        await cleanup();
        await pool.query("INSERT INTO drivers (uuid, company_uuid, name, is_active) VALUES ($1,$2,$3,true)", [A_UUID, COMPANY_1, A_NAME]);
        await pool.query("INSERT INTO driver_devices (driver_uuid, device_id, device_token_hash, is_active) VALUES ($1,$2,$3,true)", [A_UUID, DEVICE_A, hashToken(TOKEN_A)]);
        const tour = await pool.query("INSERT INTO tours (driver_name, name, updated_at) VALUES ($1,'TD010 Tour',100) RETURNING id, uuid", [A_NAME]);
        const stop = await pool.query("INSERT INTO stops (tour_id, address, recipient, order_index, stop_status, is_completed, updated_at) VALUES ($1,'TD010 Addr','TD010 Recipient',0,'PENDING',false,100) RETURNING id, uuid", [tour.rows[0].id]);
        try {
            const res = await post(app, `/api/sync-tours/${encodeURIComponent(A_NAME)}`, [{
                tour: { uuid: tour.rows[0].uuid, name: 'TD010 Tour', updated_at: 200 },
                stops: [{ uuid: stop.rows[0].uuid, address: 'TD010 Addr', recipient: 'TD010 Recipient', order_index: 0, stop_status: 'ARRIVED', updated_at: 200 }]
            }]);
            assert.equal(res.status, 200, res.text);
            const after = await pool.query('SELECT stop_status FROM stops WHERE id = $1', [stop.rows[0].id]);
            assert.equal(after.rows[0].stop_status, 'ARRIVED', 'legacy name-owned tours must remain syncable');
        } finally {
            await cleanup();
        }
    });
});
