const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const COMPANY_A_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

function adminHeaders() {
    return { 'x-admin-token': 'admin-secret' };
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
                res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, text })));
            });
            req.on('error', error => server.close(() => reject(error)));
            if (data) req.write(data);
            req.end();
        });
    });
}

function createApp() {
    const previousAdminToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = 'admin-secret';
    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];

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
        if (sql.includes('FROM live_updates lu')) {
            return {
                rows: [{
                    driver_name: params[0],
                    latitude: 47.1,
                    longitude: 19.2,
                    speed: 42,
                    status: 'Driving',
                    current_tour: 'Tour A',
                    timestamp: 1000,
                    driver_photo: '/uploads/a.jpg',
                    license_plate: 'ABC-123'
                }],
                rowCount: 1
            };
        }
        if (sql.includes('FROM work_times') && sql.includes('date = $2')) {
            return { rows: [{ type: 'Vezetés', start_time: 0, end_time: 1000 }], rowCount: 1 };
        }
        if (sql.includes('FROM work_times') && sql.includes('date LIKE')) {
            return { rows: [{ type: 'Vezetés', start_time: 0, end_time: 1000, date: new Date().toISOString().split('T')[0] }], rowCount: 1 };
        }
        if (sql.includes('SUM(amount)')) return { rows: [{ total: 12, count: 1 }], rowCount: 1 };
        if (sql.includes('COUNT(*)::INT AS count FROM tours')) return { rows: [{ count: 2 }], rowCount: 1 };
        if (sql.includes('latitude, longitude, speed, timestamp FROM live_updates')) {
            return { rows: [{ latitude: 47.1, longitude: 19.2, speed: 42, timestamp: 1000 }], rowCount: 1 };
        }
        if (sql.includes('DISTINCT ON (all_drivers.driver_name)')) {
            return {
                rows: [
                    { driver_name: 'Driver A', driver_photo: '/a.jpg', status: 'Driving', license_plate: 'ABC-123', timestamp: 1000 },
                    { driver_name: 'Driver B', driver_photo: '/b.jpg', status: 'Rest', license_plate: 'XYZ-999', timestamp: 1000 }
                ],
                rowCount: 2
            };
        }
        if (sql.includes('SELECT DISTINCT driver_name')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM live_updates WHERE driver_name = $1')) return { rows: [{ driver_name: params[0], status: 'Driving' }], rowCount: 1 };
        if (sql.includes('FROM drivers WHERE name = $1')) return { rows: [{ name: params[0], is_active: true }], rowCount: 1 };
        if (sql.includes('FROM costs')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM chat_messages')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM tours WHERE driver_name = $1')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM hotels')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
    }

    pool.query = handler;

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'dashboard-auth-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/fleet.routes'));
    app.use(require('../src/routes/history.routes'));
    app.use(require('../src/routes/stats.routes'));
    app.use(require('../src/routes/driver.routes').driverReadRoutes);
    app.use(require('../src/routes/driver-dashboard.routes')({
        escapeHtml: (value) => String(value ?? '').replace(/[&<>"']/g, ''),
        escapeJsString: (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

    return {
        app,
        calls,
        restoreEnv: () => {
            if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
            else process.env.ADMIN_TOKEN = previousAdminToken;
        }
    };
}

test('driver dashboard page is private admin/internal, not public by name', async () => {
    const fixture = createApp();
    try {
        const publicPage = await request(fixture.app, { path: '/driver/Driver%20A' });
        assert.equal(publicPage.status, 401);

        const adminPage = await request(fixture.app, { path: '/driver/Driver%20A', headers: adminHeaders() });
        assert.equal(adminPage.status, 200, adminPage.text);
    } finally {
        fixture.restoreEnv();
    }
});

test('live status, history and stats reject unauthenticated and cross-driver by-name access', async () => {
    const fixture = createApp();
    try {
        assert.equal((await request(fixture.app, { path: '/api/live-status/Driver%20A' })).status, 401);
        assert.equal((await request(fixture.app, { path: '/api/live-status/Driver%20B', headers: authHeaders() })).status, 403);
        assert.equal((await request(fixture.app, { path: '/api/get-history/Driver%20B/2026-08-09', headers: authHeaders() })).status, 403);
        assert.equal((await request(fixture.app, { path: '/api/stats/Driver%20B', headers: authHeaders() })).status, 403);

        const ownLive = await request(fixture.app, { path: '/api/live-status/Driver%20A', headers: authHeaders() });
        assert.equal(ownLive.status, 200, ownLive.text);
        const ownLiveBody = JSON.parse(ownLive.text);
        assert.equal(ownLiveBody.driver_name, 'Driver A');
        assert.equal(ownLiveBody.id, undefined);
        assert.equal(ownLiveBody.device_id, undefined);

        assert.equal((await request(fixture.app, { path: '/api/get-history/Driver%20A/2026-08-09', headers: authHeaders() })).status, 200);
        assert.equal((await request(fixture.app, { path: '/api/stats/Driver%20A', headers: authHeaders() })).status, 200);
    } finally {
        fixture.restoreEnv();
    }
});

test('fleet-wide driver inventory is admin-only and not exposed to ordinary device auth', async () => {
    const fixture = createApp();
    try {
        assert.equal((await request(fixture.app, { path: '/api/fleet-status' })).status, 401);
        assert.equal((await request(fixture.app, { path: '/api/fleet-status', headers: authHeaders() })).status, 401);
        const adminFleet = await request(fixture.app, { path: '/api/fleet-status', headers: adminHeaders() });
        assert.equal(adminFleet.status, 200, adminFleet.text);
        assert.equal(JSON.parse(adminFleet.text).length, 2);

        assert.equal((await request(fixture.app, { path: '/api/all-drivers', headers: authHeaders() })).status, 401);
        const adminDrivers = await request(fixture.app, { path: '/api/all-drivers', headers: adminHeaders() });
        assert.equal(adminDrivers.status, 200, adminDrivers.text);
    } finally {
        fixture.restoreEnv();
    }
});
