const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const DRIVER_UUID = '11111111-1111-4111-8111-111111111111';
const HOTEL_UUID = '22222222-2222-4222-8222-222222222222';

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function useEnv() {
    process.env.ADMIN_TOKEN = 'test-admin-token';
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

function mockPool(handler) {
    const pool = require('../src/database/pool');
    pool.query = async (sql, params = []) => handler(sql, params);
    pool.connect = async () => ({
        query: async (sql, params = []) => handler(sql, params),
        release: () => {}
    });
}

function createApp(handler) {
    useEnv();
    clearProjectModules();
    mockPool(handler);
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/admin', require('../src/routes/admin.routes'));
    app.use(require('../src/routes/driver.routes').driverProfileRoutes);
    app.use(require('../src/routes/hotel.routes').hotelManagementRoutes);
    app.use(require('../src/routes/tour-core.routes'));
    return app;
}

const auth = { authorization: 'Bearer test-admin-token' };

test('Driver new page renders a real form instead of a placeholder', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const res = await request(app, { path: '/admin/drivers/new', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /name="name"/);
    assert.match(res.text, /name="whatsapp"/);
    assert.doesNotMatch(res.text, /következő sprintben/i);
});

test('Driver detail validates UUID and returns 404 for missing driver', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const bad = await request(app, { path: '/admin/drivers/not-a-uuid', headers: auth });
    assert.equal(bad.status, 400);
    const missing = await request(app, { path: `/admin/drivers/${DRIVER_UUID}`, headers: auth });
    assert.equal(missing.status, 404);
});

test('Driver detail renders edit form, tours, devices, status, and escaped data', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM drivers WHERE uuid')) return { rows: [{ uuid: DRIVER_UUID, name: '<Driver>', email: 'd@example.com', phone: '1', whatsapp: '2', telegram: '3', license_plate: '<ABC>', is_active: true }] };
        if (sql.includes('FROM tours')) return { rows: [{ id: 7, name: '<Tour>', tour_status: 'PLANNED', date: Date.now(), is_current: true }] };
        if (sql.includes('FROM driver_devices')) return { rows: [{ device_id: 'dev-1', device_name: '<Phone>', is_active: true, last_seen_at: Date.now() }] };
        if (sql.includes('FROM live_updates')) return { rows: [{ status: '<Online>', current_tour: '<Tour>', timestamp: Date.now() }] };
        return { rows: [] };
    });
    const res = await request(app, { path: `/admin/drivers/${DRIVER_UUID}`, headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /&lt;Driver&gt;/);
    assert.match(res.text, /&lt;Tour&gt;/);
    assert.match(res.text, /&lt;Phone&gt;/);
    assert.match(res.text, /Deaktiválás/);
});

test('Driver create, edit, validation, activation code, and deactivate use safe queries', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT name FROM drivers')) return { rows: [{ name: 'Old' }] };
        if (sql.includes('INSERT INTO drivers')) return { rows: [{ uuid: DRIVER_UUID }] };
        if (sql.includes('UPDATE drivers SET name=')) return { rows: [], rowCount: 1 };
        if (sql.includes('UPDATE drivers SET is_active = false')) return { rows: [{ uuid: DRIVER_UUID }] };
        if (sql.includes('SELECT activation_code')) return { rows: [{ activation_code: 'ABC123' }] };
        return { rows: [], rowCount: 1 };
    });
    const invalid = await request(app, { method: 'POST', path: '/admin/save-driver', headers: auth, body: { email: 'bad' } });
    assert.equal(invalid.status, 400);

    const create = await request(app, { method: 'POST', path: '/admin/save-driver', headers: auth, body: { name: 'New', email: 'n@example.com', is_active: true } });
    assert.equal(create.status, 200);
    assert.equal(JSON.parse(create.text).uuid, DRIVER_UUID);

    const edit = await request(app, { method: 'POST', path: '/admin/save-driver', headers: auth, body: { uuid: DRIVER_UUID, name: 'Edit', email: 'e@example.com', is_active: false } });
    assert.equal(edit.status, 200);

    const code = await request(app, { path: `/admin/api/drivers/${DRIVER_UUID}/code`, headers: auth });
    assert.equal(JSON.parse(code.text).code, 'ABC123');

    const deactivate = await request(app, { method: 'POST', path: '/admin/delete-driver', headers: auth, body: { uuid: DRIVER_UUID } });
    assert.equal(deactivate.status, 200);
    assert.ok(calls.some(c => c.sql.includes('UPDATE drivers SET is_active = false')));
    assert.equal(calls.some(c => c.sql.includes('DELETE FROM drivers')), false);
});

test('Driver cookie-based create requires CSRF', async () => {
    const app = createApp(async () => ({ rows: [], rowCount: 1 }));
    const { createAdminSession } = require('../src/utils/admin-session');
    const session = createAdminSession();
    const cookie = `admin_session=${encodeURIComponent(session.id)}`;
    const missing = await request(app, { method: 'POST', path: '/admin/save-driver', headers: { cookie }, body: { name: 'No csrf' } });
    assert.equal(missing.status, 403);
});

test('Hotel page renders list, filters, edit modal, map hooks, and escaped data', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM drivers')) return { rows: [{ name: '<Driver>' }] };
        if (sql.includes('FROM hotels')) return { rows: [{ id: 3, uuid: HOTEL_UUID, source: 'hotel', driver_name: '<Driver>', name: '<Hotel>', address: '<Address>', city: 'Budapest', latitude: 47.5, longitude: 19.04, status: 'PLANNED', updated_at: Date.now() }] };
        return { rows: [] };
    });
    const res = await request(app, { path: '/admin/hotels', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /hotel-search/);
    assert.match(res.text, /hotel-map/);
    assert.match(res.text, /openHotelModal/);
    assert.match(res.text, /\\u003cHotel>/);
});

test('Hotel save validates input and persists rich fields with CSRF-capable route', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('UPDATE hotels SET')) return { rows: [{ id: 3, uuid: HOTEL_UUID, timestamp: Date.now() }] };
        if (sql.includes('INSERT INTO hotels')) return { rows: [{ id: 4, uuid: HOTEL_UUID, timestamp: Date.now() }] };
        return { rows: [] };
    });
    const invalid = await request(app, { method: 'POST', path: '/admin/save-hotel-record', headers: auth, body: { name: '' } });
    assert.equal(invalid.status, 400);
    const saved = await request(app, {
        method: 'POST',
        path: '/admin/save-hotel-record',
        headers: auth,
        body: { id: 3, name: 'Hotel', driver_name: 'Driver', address_line_1: 'Address', latitude: '47.5', longitude: '19.04', status: 'CONFIRMED', check_in_date: '2026-07-26' }
    });
    assert.equal(saved.status, 200);
    assert.ok(calls.some(c => c.sql.includes('latitude=$5') && c.params.includes('CONFIRMED')));
});

test('Hotel cookie save requires CSRF', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const { createAdminSession } = require('../src/utils/admin-session');
    const session = createAdminSession();
    const cookie = `admin_session=${encodeURIComponent(session.id)}`;
    const res = await request(app, { method: 'POST', path: '/admin/save-hotel-record', headers: { cookie }, body: { name: 'Hotel' } });
    assert.equal(res.status, 403);
});

test('Tour admin regression keeps the legacy rich route visible', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const res = await request(app, { path: '/admin/tours', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /tour-details-card/);
    assert.match(res.text, /tour-cargo-summary/);
    assert.match(res.text, /tour-map/);
});
