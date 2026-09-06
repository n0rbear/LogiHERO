const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const COMPANY_UUID = '11111111-1111-4111-8111-111111111111';
const DRIVER_UUID = '22222222-2222-4222-8222-222222222222';
const TOUR_UUID = '33333333-3333-4333-8333-333333333333';

const writeRoutes = [
    { name: 'save cost', path: '/admin/save-cost', body: { driverName: 'Driver', amount: 12, currency: 'EUR', category: 'Fuel' } },
    { name: 'update cost status', path: '/admin/update-cost-status', body: { uuid: DRIVER_UUID, status: 'Elfogadva' } },
    { name: 'save tour', path: '/admin/save-tour', body: { driver_name: 'Driver', name: 'Tour', stops: [] } },
    { name: 'delete tour', path: '/admin/delete-tour', body: { id: 7 } },
    { name: 'transfer tour', path: '/admin/transfer-tour', body: { tourId: 7, newDriverName: 'Driver' } },
    { name: 'seed demo', path: '/admin/dev-seed-demo', body: {} },
    { name: 'mint tour', path: '/admin/dev-mint-tour', body: {} },
    { name: 'reset dev database', path: '/admin/dev-reset-database', body: { confirm: 'RESET_DEV_DATABASE' } },
    { name: 'reset demo data', path: '/admin/dev-reset-demo', body: { confirm: 'RESET_DEMO_DATA' } }
];

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function useEnv() {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    process.env.READ_ONLY_ADMIN_TOKEN = 'test-read-only-token';
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://logihero:test@localhost:5432/logihero_test';
    process.env.NDP_INGEST_ENDPOINT = '';
    process.env.NDP_INGEST_KEY = '';
    delete process.env.RENDER;
    delete process.env.RENDER_SERVICE_ID;
}

function request(app, { path, headers = {}, body = {} }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method: 'POST',
                path,
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(data),
                    ...headers
                }
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

function createHarness() {
    useEnv();
    clearProjectModules();

    const calls = [];
    let importCalls = 0;
    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT uuid, is_current FROM tours')) {
            return { rows: [{ uuid: TOUR_UUID, is_current: false }], rowCount: 1 };
        }
        if (sql.includes('SELECT company_uuid, uuid FROM drivers') || sql.includes('SELECT uuid, company_uuid FROM drivers')) {
            return { rows: [{ uuid: DRIVER_UUID, company_uuid: COMPANY_UUID }], rowCount: 1 };
        }
        if (sql.includes('SELECT uuid FROM companies WHERE is_demo')) {
            return { rows: [{ uuid: COMPANY_UUID }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO companies')) {
            return { rows: [{ uuid: COMPANY_UUID, name: 'Demo Company', slug: 'demo-company' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO web_users')) {
            return { rows: [{ uuid: DRIVER_UUID, name: 'Demo User', email: 'demo@example.test', role: 'DISPATCHER' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO drivers')) {
            return { rows: [{ uuid: DRIVER_UUID, name: 'Driver', license_plate: 'TEST-001' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO tours')) {
            return { rows: [{ id: 7, uuid: TOUR_UUID, name: 'Tour' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO costs') && sql.includes('RETURNING')) {
            return {
                rows: [{ id: 1, uuid: DRIVER_UUID, driver_name: 'Driver', amount: '12', currency: 'EUR', category: 'Fuel', status: 'Rogzitve', timestamp: 1, revision: 1, updated_at: 1 }],
                rowCount: 1
            };
        }
        return { rows: [], rowCount: 1 };
    };

    const pool = require('../src/database/pool');
    pool.query = query;
    pool.connect = async () => ({ query, release: () => {} });

    const app = express();
    app.use(express.json());
    const ImportEngine = {
        processTour: async () => {
            importCalls += 1;
            return 7;
        }
    };
    app.use(require('../src/routes/cost.routes').costManagementRoutes);
    app.use(require('../src/routes/admin-save-tour.routes')({ ImportEngine }));
    app.use(require('../src/routes/admin-tour.routes'));
    app.use(require('../src/routes/admin-transfer-tour.routes'));
    app.use(require('../src/routes/dev-seed.routes'));
    app.use(require('../src/routes/dev-reset.routes'));

    return {
        app,
        calls,
        mutationCount: () => calls.length + importCalls,
        resetEvidence: () => {
            calls.length = 0;
            importCalls = 0;
        }
    };
}

test('FULL_ADMIN cookie with valid CSRF reaches every audited admin write route', async () => {
    const harness = createHarness();
    const { createAdminSession } = require('../src/utils/admin-session');
    const session = createAdminSession();
    const headers = {
        cookie: `admin_session=${encodeURIComponent(session.id)}`,
        'x-csrf-token': session.csrfToken
    };

    for (const route of writeRoutes) {
        harness.resetEvidence();
        const response = await request(harness.app, { ...route, headers });
        assert.equal(response.status, 200, route.name);
        assert.ok(harness.mutationCount() > 0, `${route.name} did not reach its handler`);
    }
});

test('READ_ONLY bearer receives 403 before every audited admin write handler', async () => {
    const harness = createHarness();
    const headers = { authorization: 'Bearer test-read-only-token' };

    for (const route of writeRoutes) {
        harness.resetEvidence();
        const response = await request(harness.app, { ...route, headers });
        assert.equal(response.status, 403, route.name);
        assert.equal(harness.mutationCount(), 0, `${route.name} reached a database or import handler`);
    }
});

test('cookie admin without CSRF receives 403 before every audited admin write handler', async () => {
    const harness = createHarness();
    const { createAdminSession } = require('../src/utils/admin-session');
    const session = createAdminSession();
    const headers = { cookie: `admin_session=${encodeURIComponent(session.id)}` };

    for (const route of writeRoutes) {
        harness.resetEvidence();
        const response = await request(harness.app, { ...route, headers });
        assert.equal(response.status, 403, route.name);
        assert.equal(harness.mutationCount(), 0, `${route.name} reached a database or import handler`);
    }
});

test('all unsafe requireAdmin route declarations include requireAdminWrite', () => {
    const routesDir = path.join(__dirname, '..', 'src', 'routes');
    const unguarded = [];

    for (const file of fs.readdirSync(routesDir).filter(name => name.endsWith('.js')).sort()) {
        const lines = fs.readFileSync(path.join(routesDir, file), 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
            if (!/\.(?:post|put|patch|delete)\(/.test(line)) return;
            if (!/\brequireAdmin\b/.test(line)) return;
            if (/['"]\/(?:admin\/)?logout['"]/.test(line)) return;
            if (!/\brequireAdminWrite\b/.test(line)) {
                unguarded.push(`${file}:${index + 1}`);
            }
        });
    }

    assert.deepEqual(unguarded, []);
});
