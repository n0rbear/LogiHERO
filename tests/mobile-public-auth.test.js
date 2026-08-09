const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const DRIVER_B_UUID = '22222222-2222-4222-8222-222222222222';
const COMPANY_A_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function createApp() {
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
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO sync_events')) return { rows: [], rowCount: 1 };

        if (sql.includes('FROM costs') && sql.includes('uuid::text = $1') && sql.includes('LIMIT 1')) {
            if (params[0] === 'foreign-cost') {
                return { rows: [{ driver_uuid: DRIVER_B_UUID, driver_name: 'Driver B', company_uuid: COMPANY_B_UUID }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM hotels h') && sql.includes('h.id = $1')) {
            return String(params[0]) === '10' ? { rows: [{ id: 10 }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM cargo c') && sql.includes('c.id = $1')) {
            return String(params[0]) === '20' ? { rows: [{ id: 20 }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM cargo WHERE id = $1')) {
            return { rows: [{ id: 20, status: 'READY_FOR_PICKUP', tour_id: 7 }], rowCount: 1 };
        }
        if (sql.includes('FROM stops WHERE id = $1')) {
            return String(params[0]) === '30' ? { rows: [{ id: 30 }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE cargo SET')) {
            return { rows: [{ id: 20, status: 'PICKED_UP', tour_id: 7 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO cargo_events')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT * FROM drivers WHERE uuid = $1')) {
            return {
                rows: [{
                    uuid: DRIVER_A_UUID,
                    name: 'Driver A',
                    email: 'a@example.test',
                    phone: '+1',
                    activation_code: 'SECRET',
                    device_token_hash: 'SECRET',
                    is_active: true,
                    profile_updated_at: 5,
                    revision: 2
                }],
                rowCount: 1
            };
        }
        if (sql.includes('INSERT INTO chat_messages')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT uuid, sender, message, timestamp FROM chat_messages')) {
            return { rows: [{ uuid: 'chat-1', sender: 'DRIVER', message: 'hello', timestamp: 1 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO costs')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT id, uuid, status, timestamp, amount')) {
            return { rows: [{ id: 1, uuid: 'cost-1', status: 'Rogzitve', timestamp: 1, amount: 12, revision: 1, updated_at: 1 }], rowCount: 1 };
        }
        if (sql.includes('FROM costs') && sql.includes('ORDER BY timestamp DESC')) {
            return { rows: [{ uuid: 'cost-1', driver_name: 'Driver A', amount: 12, currency: 'EUR', status: 'Rogzitve', timestamp: 1, revision: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    pool.connect = async () => ({ query: handler, release: () => {} });
    pool.query = handler;

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'mobile-public-auth-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/chat.routes'));
    app.use(require('../src/routes/cost.routes').costReadRoutes);
    app.use(require('../src/routes/cost.routes').costManagementRoutes);
    app.use(require('../src/routes/driver.routes').driverProfileRoutes);
    app.use(require('../src/routes/hotel.routes').hotelManagementRoutes);
    app.use(require('../src/routes/cargo.routes'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return { app, calls };
}

test('legacy mobile chat requires authenticated owner scope', async () => {
    const { app, calls } = createApp();
    assert.equal((await request(app, { path: '/api/get-chat/Driver%20A' })).status, 401);
    const denied = await request(app, { path: '/api/get-chat/Driver%20B', headers: authHeaders() });
    assert.equal(denied.status, 403, denied.text);
    const own = await request(app, { path: '/api/get-chat/Driver%20A', headers: authHeaders() });
    assert.equal(own.status, 200, own.text);

    const crossWrite = await request(app, {
        method: 'POST',
        path: '/api/send-chat',
        headers: authHeaders(),
        body: { driverName: 'Driver B', message: 'takeover' }
    });
    assert.equal(crossWrite.status, 403, crossWrite.text);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO chat_messages') && call.params.includes('Driver B')), false);
});

test('legacy cost sync rejects cross-driver updates before mutation and preserves admin-owned status', async () => {
    const { app, calls } = createApp();
    const denied = await request(app, {
        method: 'POST',
        path: '/api/sync-costs',
        headers: authHeaders(),
        body: [{ uuid: 'foreign-cost', driverName: 'Driver A', amount: 99, status: 'Kifizetve', timestamp: 1 }]
    });
    assert.equal(denied.status, 403, denied.text);
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO costs')), false);
    assert.equal(calls.some(call => call.sql === 'ROLLBACK'), true);

    const own = await request(app, {
        method: 'POST',
        path: '/api/sync-costs',
        headers: authHeaders(),
        body: [{ uuid: 'new-cost', driverName: 'Driver A', amount: 12, currency: 'EUR', category: 'Fuel', status: 'Kifizetve', timestamp: 1 }]
    });
    assert.equal(own.status, 200, own.text);
    const insert = calls.find(call => call.sql.includes('INSERT INTO costs'));
    assert.ok(insert);
    assert.equal(insert.sql.includes('status = EXCLUDED.status'), false);
    assert.equal(insert.params.includes('Kifizetve'), false);
});

test('mobile profile reads require own identity and minimize privileged fields', async () => {
    const { app } = createApp();
    const denied = await request(app, { path: `/api/get-profile-by-uuid/${DRIVER_B_UUID}`, headers: authHeaders() });
    assert.equal(denied.status, 403, denied.text);
    const own = await request(app, { path: `/api/get-profile-by-uuid/${DRIVER_A_UUID}`, headers: authHeaders() });
    assert.equal(own.status, 200, own.text);
    const body = JSON.parse(own.text);
    assert.equal(body.uuid, DRIVER_A_UUID);
    assert.equal(body.activation_code, undefined);
    assert.equal(body.activationCode, undefined);
    assert.equal(body.device_token_hash, undefined);
});

test('hotel and cargo driver actions require owned records', async () => {
    const { app, calls } = createApp();
    const foreignHotel = await request(app, {
        method: 'POST',
        path: '/api/hotels/99/check-in',
        headers: authHeaders(),
        body: { driverName: 'Driver A' }
    });
    assert.equal(foreignHotel.status, 403, foreignHotel.text);

    const foreignCargo = await request(app, {
        method: 'POST',
        path: '/api/cargo/99/pickup',
        headers: authHeaders(),
        body: { driverName: 'Driver A', stopId: 30 }
    });
    assert.equal(foreignCargo.status, 403, foreignCargo.text);
    assert.equal(calls.some(call => call.sql.startsWith('UPDATE cargo SET') && String(call.params.at(-1)) === '99'), false);

    const ownCargo = await request(app, {
        method: 'POST',
        path: '/api/cargo/20/pickup',
        headers: authHeaders(),
        body: { driverName: 'Driver B', stopId: 30 }
    });
    assert.equal(ownCargo.status, 200, ownCargo.text);
    const event = calls.find(call => call.sql.includes('INSERT INTO cargo_events'));
    assert.equal(event.params[5], DRIVER_A_UUID);
});
