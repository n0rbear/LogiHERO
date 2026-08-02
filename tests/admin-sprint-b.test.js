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
const readOnlyAuth = { authorization: 'Bearer test-read-only-token' };

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
        if (sql.includes('FROM hotels')) return { rows: [{ id: 3, uuid: HOTEL_UUID, source: 'hotel', driver_name: '<Driver>', name: '<Hotel>', address: '<Address>', city: 'Budapest', latitude: 47.5, longitude: 19.04, status: 'PLANNED', tour_id: 9, tour_name: '<Tour>', updated_at: Date.now() }] };
        if (sql.includes('FROM tours')) return { rows: [{ id: 9, name: '<Tour>', driver_name: '<Driver>' }] };
        return { rows: [] };
    });
    const res = await request(app, { path: '/admin/hotels', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /hotel-search/);
    assert.match(res.text, /hotel-map/);
    assert.match(res.text, /hotel-tour/);
    assert.match(res.text, /Linked tour/);
    assert.match(res.text, /Standalone\/manual hotel/);
    assert.match(res.text, /openHotelModal/);
    assert.match(res.text, /\\u003cHotel>/);
});

test('Hotel admin query qualifies joined status columns for filter variants', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM drivers')) return { rows: [{ name: 'Driver' }] };
        if (sql.includes('FROM tours')) return { rows: [{ id: 9, name: 'Tour', driver_name: 'Driver' }] };
        if (sql.includes('FROM hotels h')) {
            if (/check_out_date,\s*status,/i.test(sql)) {
                throw new Error('column reference "status" is ambiguous');
            }
            return {
                rows: [
                    { id: 3, uuid: HOTEL_UUID, source: 'hotel', driver_name: 'Driver', name: 'Hotel', address: 'Address', city: 'Budapest', latitude: 47.5, longitude: 19.04, status: 'PLANNED', tour_id: 9, tour_name: 'Tour', updated_at: Date.now() },
                    { id: 4, uuid: '11111111-1111-4111-8111-111111111111', source: 'hotel', driver_name: 'Driver', name: 'Standalone Hotel', address: 'Address', city: 'Budapest', latitude: 47.6, longitude: 19.05, status: 'CONFIRMED', tour_id: null, tour_name: null, updated_at: Date.now() },
                    { id: 5, uuid: '22222222-2222-4222-8222-222222222222', source: 'stop', driver_name: null, name: 'Tour Stop Hotel', address: 'Address', city: 'Budapest', latitude: 47.7, longitude: 19.06, status: 'BOOKED', tour_id: 9, tour_name: 'Tour', updated_at: Date.now() }
                ]
            };
        }
        return { rows: [] };
    });
    const res = await request(app, { path: '/admin/hotels', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /hotel-status/);
    assert.match(res.text, /hotel-driver/);
    assert.match(res.text, /hotel-tour/);
    assert.match(res.text, /Standalone\/manual hotel/);
    assert.match(res.text, /Linked tour/);
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

test('Hotel update preserves existing tour ownership when tour_id is omitted', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('UPDATE hotels SET')) return { rows: [{ id: 3, uuid: HOTEL_UUID, tour_id: 7, timestamp: Date.now() }] };
        return { rows: [] };
    });
    const res = await request(app, {
        method: 'POST',
        path: '/admin/save-hotel-record',
        headers: auth,
        body: { id: 3, name: 'Hotel', driver_name: 'Driver', address_line_1: 'Address', status: 'PLANNED' }
    });
    assert.equal(res.status, 200);
    const update = calls.find(c => c.sql.includes('UPDATE hotels SET'));
    assert.ok(update);
    assert.equal(update.sql.includes('tour_id=$17'), false);
    assert.match(update.sql, /WHERE id = \$17/);
});

test('Hotel tour ownership validation rejects malformed and unknown tour IDs', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('SELECT id FROM tours')) return { rows: [] };
        return { rows: [] };
    });
    const malformed = await request(app, { method: 'POST', path: '/admin/save-hotel-record', headers: auth, body: { id: 3, name: 'Hotel', tour_id: 'abc' } });
    assert.equal(malformed.status, 400);
    const unknown = await request(app, { method: 'POST', path: '/admin/save-hotel-record', headers: auth, body: { id: 3, name: 'Hotel', tour_id: '999' } });
    assert.equal(unknown.status, 404);
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
    assert.match(res.text, /admin-map-tile/);
    assert.match(res.text, /admin-map-route-polyline/);
    assert.match(res.text, /tile\.openstreetmap\.org/);
    assert.match(res.text, /tour-route-diagnostics/);
    assert.match(res.text, /route-recalc-button/);
    assert.match(res.text, /\/api\/tours\/' \+ id \+ '\/hotels/);
    assert.match(res.text, /dedupeHotelsForTour/);
    assert.match(res.text, /hotelPopupHtml/);
    assert.match(res.text, /Open in Google Maps/);
    assert.match(res.text, /Try Street View/);
    assert.match(res.text, /rel="noopener noreferrer"/);
    assert.match(res.text, /markerType: 'hotel'/);
    assert.match(res.text, /dispatcher-stop-table/);
    assert.match(res.text, /Dispatcher stop table/);
    assert.match(res.text, /Save changes/);
    assert.match(res.text, /Add stop/);
    assert.match(res.text, /data-move="up"/);
    assert.match(res.text, /data-delete-stop/);
    assert.match(res.text, /saveDispatcherChanges/);
    assert.match(res.text, /cancelDispatcherChanges/);
    assert.match(res.text, /persistStopOrder/);
    assert.match(res.text, /recalculateSelectedRoute/);
});

test('Tour admin hides write capability for read-only admins', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const res = await request(app, { path: '/admin/tours', headers: readOnlyAuth });
    assert.equal(res.status, 200);
    assert.match(res.text, /const canWriteTour = false/);
    assert.match(res.text, /Read-only table/);
    assert.doesNotMatch(res.text, /READ_ONLY users may write/i);
});

test('Tour core write routes reject READ_ONLY direct requests', async () => {
    const app = createApp(async () => ({ rows: [] }));
    const routes = [
        { method: 'PATCH', path: '/api/tours/1', body: { name: 'Blocked' } },
        { method: 'POST', path: '/api/tours/1/stops', body: { recipient: 'Blocked' } },
        { method: 'PATCH', path: '/api/tours/1/stops/2', body: { latitude: 47.5, longitude: 19.04 } },
        { method: 'DELETE', path: '/api/tours/1/stops/2' },
        { method: 'POST', path: '/api/tours/1/stops/reorder', body: { orderedStopIds: [2] } },
        { method: 'POST', path: '/api/tours/1/recalculate-route', body: {} }
    ];
    for (const route of routes) {
        const res = await request(app, { ...route, headers: readOnlyAuth });
        assert.equal(res.status, 403, route.path);
    }
});

test('Tour dispatcher table renders escaped inline editing surface and batch workflow', async () => {
    const app = createApp(async (sql) => {
        if (sql.includes('FROM tours')) {
            return { rows: [{ id: 1, name: '<Tour>', driver_name: '<Driver>', tour_status: 'PLANNED', planned_distance_km: 12, planned_duration_seconds: 600 }] };
        }
        if (sql.includes('FROM stops')) {
            return { rows: [{
                id: 2,
                order_index: 0,
                stop_type: 'PICKUP',
                company: '<Company>',
                address: '<Address>',
                address_full: '<Full>',
                city: '<City>',
                country: '<Country>',
                latitude: 47.5,
                longitude: 19.04,
                stop_status: 'PENDING',
                notes: '<Notes>'
            }] };
        }
        return { rows: [] };
    });
    const res = await request(app, { path: '/admin/tours', headers: auth });
    assert.equal(res.status, 200);
    assert.match(res.text, /data-field="company"/);
    assert.match(res.text, /data-field="address"/);
    assert.match(res.text, /data-field="city"/);
    assert.match(res.text, /data-field="country"/);
    assert.match(res.text, /data-field="latitude"/);
    assert.match(res.text, /data-field="longitude"/);
    assert.match(res.text, /data-field="notes"/);
    assert.match(res.text, /data-field="stop_status"/);
    assert.match(res.text, /collectStopPayload/);
    assert.match(res.text, /Stop table saved/);
    assert.match(res.text, /No unsaved changes/);
    assert.match(res.text, /row\(s\) with unsaved changes/);
    assert.doesNotMatch(res.text, /saveStopCoordinates/);
});

test('Tour stop add, edit, reorder, delete, and recalculate use existing APIs', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('SELECT COALESCE(MAX(order_index)')) return { rows: [{ next: 1 }] };
        if (sql.includes('FROM tours t') || sql.includes('SELECT * FROM tours WHERE id')) return { rows: [{ id: 1, name: 'Tour', driver_name: 'Driver', tour_status: 'PLANNED', terminal_mode: 'NONE' }] };
        if (sql.includes('SELECT * FROM stops WHERE tour_id')) {
            return { rows: [
                { id: 2, order_index: 0, latitude: 47.5, longitude: 19.04, stop_status: 'PENDING' },
                { id: 3, order_index: 1, latitude: 48.0, longitude: 20.0, stop_status: 'PENDING' }
            ] };
        }
        if (sql.includes('SELECT * FROM cargo')) return { rows: [] };
        if (sql.includes('SELECT latitude, longitude, speed')) return { rows: [] };
        if (sql.includes('INSERT INTO stops')) return { rows: [{ id: 4, tour_id: 1, stop_type: 'PICKUP' }] };
        if (sql.includes('UPDATE stops SET recipient=COALESCE')) return { rows: [{ id: 2, tour_id: 1 }] };
        if (sql.includes('UPDATE stops SET deleted_at')) return { rows: [{ id: 3 }] };
        if (sql.includes('UPDATE stops SET order_index')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT c.id, c.name')) return { rows: [] };
        if (sql.includes('UPDATE tours SET planned_distance_km')) return { rows: [], rowCount: 1 };
        if (sql.includes('UPDATE stops SET segment_distance_km')) return { rows: [], rowCount: 1 };
        if (sql.includes('UPDATE tours SET next_stop_id')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    });

    const edit = await request(app, { method: 'PATCH', path: '/api/tours/1/stops/2', headers: auth, body: { company: 'Updated', address: 'Address', city: 'City', country: 'HU', latitude: '47.5', longitude: '19.04', arrival_time: 1785357000000, actual_departure_time: 1785360600000, notes: 'Note', stop_status: 'PENDING' } });
    assert.equal(edit.status, 200);

    const add = await request(app, { method: 'POST', path: '/api/tours/1/stops', headers: auth, body: { stop_type: 'PICKUP', company: 'New', address: 'Address', city: 'City' } });
    assert.equal(add.status, 201);

    const reorder = await request(app, { method: 'POST', path: '/api/tours/1/stops/reorder', headers: auth, body: { orderedStopIds: [3, 2] } });
    assert.equal(reorder.status, 200);

    const deleted = await request(app, { method: 'DELETE', path: '/api/tours/1/stops/3', headers: auth });
    assert.equal(deleted.status, 200);

    const recalc = await request(app, { method: 'POST', path: '/api/tours/1/recalculate-route', headers: auth, body: {} });
    assert.equal(recalc.status, 200);

    assert.ok(calls.some(c => c.sql.includes('INSERT INTO stops')));
    assert.ok(calls.some(c => c.sql.includes('UPDATE stops SET recipient=COALESCE') && c.sql.includes('arrival_time=COALESCE') && c.params.includes(1785357000000) && c.params.includes(1785360600000)));
    assert.ok(calls.some(c => c.sql.includes('UPDATE stops SET order_index')));
    assert.ok(calls.some(c => c.sql.includes('UPDATE stops SET deleted_at')));
    assert.ok(calls.some(c => c.sql.includes('UPDATE tours SET planned_distance_km')));
});

test('Tour terminal UI and API validation use virtual route-only model', async () => {
    const calls = [];
    const app = createApp(async (sql, params) => {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FROM tours t')) {
            return { rows: [{
                id: 1,
                name: 'Tour',
                driver_name: 'Driver',
                driver_uuid: '11111111-1111-4111-8111-111111111111',
                tour_status: 'PLANNED',
                terminal_mode: 'DRIVER_HOME',
                driver_home_lat: params && params[0] === '2' ? null : 47.5,
                driver_home_lng: params && params[0] === '2' ? null : 19.04,
                depot_lat: 47.49,
                depot_lng: 19.03
            }] };
        }
        if (sql.includes('FROM tours')) return { rows: [{ id: 1, name: 'Tour', driver_name: 'Driver', tour_status: 'PLANNED', terminal_mode: 'DRIVER_HOME' }] };
        if (sql.includes('FROM stops')) return { rows: [{ id: 2, order_index: 0, latitude: 47.6, longitude: 19.2, stop_status: 'PENDING' }] };
        if (sql.includes('FROM cargo')) return { rows: [] };
        if (sql.includes('SELECT latitude, longitude, speed')) return { rows: [] };
        if (sql.includes('UPDATE tours SET name=COALESCE')) return { rows: [{ id: Number(params.at(-1)), terminal_mode: params[9] }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    });

    const page = await request(app, { path: '/admin/tours', headers: auth });
    assert.equal(page.status, 200);
    assert.match(page.text, /Tour terminal/);
    assert.match(page.text, /name="terminal_mode"/);
    assert.match(page.text, /Driver home\/base/);
    assert.match(page.text, /terminal-marker/);

    const saved = await request(app, { method: 'PATCH', path: '/api/tours/1', headers: auth, body: { terminal_mode: 'DRIVER_HOME' } });
    assert.equal(saved.status, 200);
    const savedBody = JSON.parse(saved.text);
    assert.equal(savedBody.resolvedTerminal.mode, 'DRIVER_HOME');
    assert.equal(savedBody.resolvedTerminal.diagnostic, 'OK');

    const invalid = await request(app, { method: 'PATCH', path: '/api/tours/1', headers: auth, body: { terminal_mode: 'CUSTOM' } });
    assert.equal(invalid.status, 400);
    assert.equal(JSON.parse(invalid.text).error, 'INVALID_TERMINAL_MODE');

    const unresolved = await request(app, { method: 'PATCH', path: '/api/tours/2', headers: auth, body: { terminal_mode: 'DRIVER_HOME' } });
    assert.equal(unresolved.status, 400);
    assert.equal(JSON.parse(unresolved.text).error, 'DRIVER_HOME_COORDINATES_MISSING');

    assert.ok(calls.some(c => c.sql.includes('terminal_mode=COALESCE')));
    assert.ok(!calls.some(c => c.sql.includes('INSERT INTO stops') && c.params?.includes('DRIVER_HOME')));
});
