const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function useEnv() {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    process.env.READ_ONLY_ADMIN_TOKEN = 'test-read-only-token';
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://logihero:test@localhost:5432/logihero_test';
    delete process.env.RENDER;
    delete process.env.RENDER_SERVICE_ID;
}

function request(app, { method = 'GET', path = '/', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method,
                path,
                headers: {
                    ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
                    ...headers
                }
            }, (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { text += chunk; });
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, text })));
            });
            req.on('error', (error) => server.close(() => reject(error)));
            if (data) req.write(data);
            req.end();
        });
    });
}

function createApp(handler) {
    useEnv();
    clearProjectModules();
    const pool = require('../src/database/pool');
    pool.query = async (sql, params = []) => handler(sql, params);
    pool.connect = async () => ({
        query: async (sql, params = []) => handler(sql, params),
        release: () => {}
    });
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/admin', require('../src/routes/admin.routes'));
    app.use(require('../src/routes/cargo.routes'));
    app.use(require('../src/routes/tour-core.routes'));
    app.use(require('../src/routes/hotel.routes').hotelManagementRoutes);
    return app;
}

const auth = { authorization: 'Bearer test-admin-token' };
const readOnlyAuth = { authorization: 'Bearer test-read-only-token' };

const cargoRow = {
    cargo_id: 7,
    cargo_uuid: '33333333-3333-4333-8333-333333333333',
    cargo_tour_id: 9,
    cargo_pickup_stop_id: 21,
    cargo_delivery_stop_id: 22,
    cargo_pickup_stop_uuid: '44444444-4444-4444-8444-444444444444',
    cargo_delivery_stop_uuid: '55555555-5555-4555-8555-555555555555',
    cargo_type: 'MACHINE',
    cargo_name: '<Excavator>',
    cargo_description: '<Heavy machine>',
    cargo_quantity: 1,
    cargo_unit: 'pcs',
    cargo_serial_number: 'SN-<123>',
    cargo_external_reference: 'CAT-320',
    cargo_customer_reference: 'CUST-1',
    cargo_weight_kg: 1200,
    cargo_length_cm: 320,
    cargo_width_cm: 120,
    cargo_height_cm: 180,
    cargo_status: 'PLANNED',
    cargo_notes: '<note>',
    cargo_driver_name: 'Driver',
    cargo_created_at: Date.now() - 1000,
    cargo_updated_at: Date.now(),
    cargo_deleted_at: null,
    cargo_sync_state: 'SYNCED',
    cargo_revision: 2,
    tour_id: 9,
    tour_name: '<Tour>',
    tour_driver_name: 'Driver',
    pickup_stop_id: 21,
    pickup_order_index: 0,
    pickup_label: '<Pickup>',
    pickup_address: 'Pickup street',
    delivery_stop_id: 22,
    delivery_order_index: 1,
    delivery_label: '<Delivery>',
    delivery_address: 'Delivery street'
};

function rowsForCargoPage(sql) {
    if (sql.includes('FROM cargo c')) {
        assert.match(sql, /c\.status AS cargo_status/);
        assert.match(sql, /c\.id AS cargo_id/);
        assert.match(sql, /c\.uuid::TEXT AS cargo_uuid/);
        assert.match(sql, /c\.tour_id AS cargo_tour_id/);
        assert.match(sql, /c\.pickup_stop_id AS cargo_pickup_stop_id/);
        assert.match(sql, /c\.delivery_stop_id AS cargo_delivery_stop_id/);
        assert.match(sql, /c\.updated_at DESC/);
        return { rows: [cargoRow] };
    }
    if (sql.includes('FROM tours t')) return { rows: [{ id: 9, name: '<Tour>', driver_name: 'Driver' }] };
    if (sql.includes('FROM stops s')) {
        return {
            rows: [
                { id: 21, uuid: '44444444-4444-4444-8444-444444444444', tour_id: 9, order_index: 0, stop_type: 'PICKUP', label: '<Pickup>', address_full: 'Pickup street', city: 'Budapest', stop_status: 'PENDING' },
                { id: 22, uuid: '55555555-5555-4555-8555-555555555555', tour_id: 9, order_index: 1, stop_type: 'DELIVERY', label: '<Delivery>', address_full: 'Delivery street', city: 'Budapest', stop_status: 'PENDING' }
            ]
        };
    }
    return { rows: [] };
}

test('Admin cargo page renders real list, filters, detail hooks and escaped machine fields', async () => {
    const app = createApp(async (sql) => rowsForCargoPage(sql));
    const res = await request(app, { path: '/admin/cargo', headers: auth });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /modul fejleszt/);
    assert.match(res.text, /cargo-search/);
    assert.match(res.text, /cargo-tour-filter/);
    assert.match(res.text, /cargo-status-filter/);
    assert.match(res.text, /cargo-type-filter/);
    assert.match(res.text, /cargo-issue-filter/);
    assert.match(res.text, /Create Cargo/);
    assert.match(res.text, /SN-\\u003c123>/);
    assert.match(res.text, /\\u003cExcavator>/);
    assert.match(res.text, /Standalone|All issue states|Machine|MACHINE/i);
});

test('Read-only admin can view cargo but direct cargo writes are denied', async () => {
    const app = createApp(async (sql) => rowsForCargoPage(sql));
    const page = await request(app, { path: '/admin/cargo', headers: readOnlyAuth });
    assert.equal(page.status, 200);
    assert.match(page.text, /Read-only admin/);
    assert.doesNotMatch(page.text, />\+ Create Cargo</);

    const create = await request(app, {
        method: 'POST',
        path: '/api/tours/9/cargo',
        headers: readOnlyAuth,
        body: { name: 'Cargo', type: 'MACHINE', quantity: 1 }
    });
    assert.equal(create.status, 403);

    const update = await request(app, {
        method: 'PATCH',
        path: '/api/cargo/7',
        headers: readOnlyAuth,
        body: { name: 'Cargo' }
    });
    assert.equal(update.status, 403);

    const deleted = await request(app, { method: 'DELETE', path: '/api/cargo/7', headers: readOnlyAuth, body: {} });
    assert.equal(deleted.status, 403);

    const resolved = await request(app, { method: 'POST', path: '/api/cargo/7/resolve', headers: readOnlyAuth, body: { status: 'PLANNED', reason: 'test' } });
    assert.equal(resolved.status, 403);
});

test('Admin cargo create validates tour, stops, serial and sync metadata', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT id FROM tours WHERE id')) return { rows: [{ id: 9 }], rowCount: 1 };
        if (sql.includes('SELECT id, tour_id, order_index FROM stops')) return { rows: [{ id: 21, tour_id: 9, order_index: 0 }, { id: 22, tour_id: 9, order_index: 1 }], rowCount: 2 };
        if (sql.includes('SELECT id FROM cargo WHERE tour_id')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT c.id, t.name as tour_name')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO cargo_events')) return { rows: [], rowCount: 1 };
        if (sql.includes('INSERT INTO cargo ')) {
            assert.match(sql, /sync_state, revision/);
            assert.equal(params[0], '9');
            assert.equal(params[3], 'MACHINE');
            assert.equal(params[6], 2);
            return { rows: [{ id: 8, uuid: '66666666-6666-4666-8666-666666666666', tour_id: 9, name: params[4], status: params[15], type: params[3], quantity: params[6], updated_at: params[18], sync_state: 'SYNCED', revision: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    });
    const res = await request(app, {
        method: 'POST',
        path: '/api/tours/9/cargo',
        headers: auth,
        body: { name: 'Machine', type: 'MACHINE', quantity: 2, serial_number: 'SN-001', pickup_stop_id: 21, delivery_stop_id: 22, weight_kg: 20 }
    });
    assert.equal(res.status, 201, res.text);
    const insert = calls.find(c => c.sql.includes('INSERT INTO cargo'));
    assert.ok(insert);
});

test('Admin cargo rejects invalid create data and cross-tour stops', async () => {
    const app = createApp(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT id FROM tours WHERE id')) return { rows: [{ id: 9 }], rowCount: 1 };
        if (sql.includes('SELECT id, tour_id, order_index FROM stops')) return { rows: [{ id: 21, tour_id: 99, order_index: 0 }, { id: 22, tour_id: 9, order_index: 1 }], rowCount: 2 };
        return { rows: [], rowCount: 0 };
    });
    const badQuantity = await request(app, { method: 'POST', path: '/api/tours/9/cargo', headers: auth, body: { name: 'Cargo', quantity: 0 } });
    assert.equal(badQuantity.status, 400);
    assert.match(badQuantity.text, /INVALID_QUANTITY/);

    const crossTour = await request(app, { method: 'POST', path: '/api/tours/9/cargo', headers: auth, body: { name: 'Cargo', pickup_stop_id: 21, delivery_stop_id: 22 } });
    assert.equal(crossTour.status, 400);
    assert.match(crossTour.text, /PICKUP_STOP_MISMATCH/);
});

test('Admin cargo update, status change and soft delete preserve events and tombstone semantics', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT * FROM cargo WHERE id')) return { rows: [{ id: 7, tour_id: 9, status: 'PLANNED', serial_number: 'OLD' }], rowCount: 1 };
        if (sql.includes('SELECT id, tour_id, order_index FROM stops')) return { rows: [{ id: 21, tour_id: 9, order_index: 0 }, { id: 22, tour_id: 9, order_index: 1 }], rowCount: 2 };
        if (sql.includes('SELECT id FROM cargo WHERE tour_id')) return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT c.id, t.name as tour_name')) return { rows: [], rowCount: 0 };
        if (sql.includes('UPDATE cargo SET') && sql.includes('revision = COALESCE')) return { rows: [{ id: 7, status: params[12] || 'PLANNED', updated_at: params[16], revision: 3, sync_state: 'SYNCED' }], rowCount: 1 };
        if (sql.includes('SELECT status FROM cargo WHERE id')) return { rows: [{ status: 'PLANNED' }], rowCount: 1 };
        if (sql.includes('UPDATE cargo SET deleted_at')) return { rows: [], rowCount: 1 };
        if (sql.includes('INSERT INTO cargo_events')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const update = await request(app, { method: 'PATCH', path: '/api/cargo/7', headers: auth, body: { name: 'Updated', status: 'READY_FOR_PICKUP', pickup_stop_id: 21, delivery_stop_id: 22 } });
    assert.equal(update.status, 200);
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO cargo_events') && c.params.includes('READY_FOR_PICKUP')));

    const deleted = await request(app, { method: 'DELETE', path: '/api/cargo/7', headers: auth, body: {} });
    assert.equal(deleted.status, 200);
    const softDelete = calls.find(c => c.sql.includes('UPDATE cargo SET deleted_at'));
    assert.ok(softDelete);
    assert.match(softDelete.sql, /sync_state = 'DELETED'/);
    assert.doesNotMatch(softDelete.sql, /^DELETE FROM cargo/i);
});

test('Admin cargo rejects invalid status transitions without override', async () => {
    const app = createApp(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT * FROM cargo WHERE id')) return { rows: [{ id: 7, tour_id: 9, status: 'PLANNED', serial_number: null }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const res = await request(app, { method: 'PATCH', path: '/api/cargo/7', headers: auth, body: { status: 'DELIVERED' } });
    assert.equal(res.status, 400);
    assert.match(res.text, /INVALID_TRANSITION_PLANNED_TO_DELIVERED/);
});

test('Admin cargo protected delete rejects in-transit records', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('SELECT status FROM cargo WHERE id')) return { rows: [{ status: 'IN_TRANSIT' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    const res = await request(app, { method: 'DELETE', path: '/api/cargo/7', headers: auth, body: {} });
    assert.equal(res.status, 409);
    assert.match(res.text, /CARGO_ALREADY_IN_TRANSIT/);
});

test('Hotel and Tour admin regressions still render after cargo module changes', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM drivers')) return { rows: [{ name: 'Driver' }] };
        if (sql.includes('FROM hotels h')) return { rows: [] };
        if (sql.includes('SELECT t.id, t.name, t.driver_name')) return { rows: [{ id: 9, name: 'Tour', driver_name: 'Driver' }] };
        if (sql.includes('FROM tours')) return { rows: [{ id: 9, name: 'Tour', driver_name: 'Driver', tour_status: 'PLANNED', planned_distance_km: 1, planned_duration_seconds: 60 }] };
        if (sql.includes('FROM stops s')) return { rows: [] };
        if (sql.includes('FROM stops')) return { rows: [] };
        return { rows: [] };
    });
    const hotels = await request(app, { path: '/admin/hotels', headers: auth });
    assert.equal(hotels.status, 200);
    assert.match(hotels.text, /hotel-search/);
    const tours = await request(app, { path: '/admin/tours', headers: auth });
    assert.equal(tours.status, 200);
    assert.match(tours.text, /tourSearch/);
});
