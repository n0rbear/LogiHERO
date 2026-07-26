const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) {
            delete require.cache[key];
        }
    }
}

function useProductionEnv(token = 'test-admin-token') {
    process.env.ADMIN_TOKEN = token;
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
                res.on('end', () => {
                    server.close(() => resolve({ status: res.statusCode, headers: res.headers, text }));
                });
            });
            req.on('error', (error) => server.close(() => reject(error)));
            if (data) req.write(data);
            req.end();
        });
    });
}

function cookieValue(setCookie, name) {
    const line = Array.isArray(setCookie) ? setCookie.find((item) => item.startsWith(`${name}=`)) : setCookie;
    return line?.split(';')[0].split('=').slice(1).join('=');
}

function createProtectedApp() {
    useProductionEnv();
    clearProjectModules();
    const requireAdmin = require('../src/middleware/requireAdmin');
    const app = express();
    app.use(express.json());
    app.get('/admin/page', requireAdmin, (_req, res) => res.send('ok'));
    app.post('/admin/write', requireAdmin, (_req, res) => res.json({ ok: true }));
    app.get('/admin/api/data', requireAdmin, (_req, res) => res.json({ ok: true }));
    return app;
}

test('ADMIN_TOKEN without login page is handled with 503', async () => {
    useProductionEnv('');
    clearProjectModules();
    const app = express();
    app.use(express.json());
    app.use('/admin', require('../src/routes/admin.routes'));

    const res = await request(app, { path: '/admin/login' });
    assert.equal(res.status, 503);
    assert.match(res.text, /ADMIN_TOKEN is not configured/);
});

test('login uses timing-safe helper and creates opaque session cookie', async () => {
    useProductionEnv();
    clearProjectModules();
    const app = express();
    app.use(express.json());
    app.use('/admin', require('../src/routes/admin.routes'));

    const bad = await request(app, { method: 'POST', path: '/admin/login', body: { token: 'wrong' } });
    assert.equal(bad.status, 401);

    const good = await request(app, { method: 'POST', path: '/admin/login', body: { token: 'test-admin-token' } });
    assert.equal(good.status, 200);
    const cookie = cookieValue(good.headers['set-cookie'], 'admin_session');
    assert.ok(cookie);
    assert.notEqual(cookie, 'test-admin-token');
    assert.match(good.headers['set-cookie'][0], /HttpOnly/);
    assert.match(good.headers['set-cookie'][0], /Secure/);
    assert.match(good.headers['set-cookie'][0], /SameSite=Lax/);
    assert.ok(JSON.parse(good.text).csrfToken);

    const { verifyAdminToken } = require('../src/utils/admin-session');
    assert.equal(verifyAdminToken('test-admin-token', 'test-admin-token'), true);
    assert.equal(verifyAdminToken('wrong', 'test-admin-token'), false);
});

test('protected HTML redirects, API returns 401, and query token is rejected', async () => {
    const app = createProtectedApp();

    const html = await request(app, { path: '/admin/page', headers: { accept: 'text/html' } });
    assert.equal(html.status, 302);
    assert.match(html.headers.location, /^\/admin\/login\?redirect=/);

    const api = await request(app, { path: '/admin/api/data', headers: { accept: 'application/json' } });
    assert.equal(api.status, 401);

    const query = await request(app, { path: '/admin/api/data?adminToken=test-admin-token', headers: { accept: 'application/json' } });
    assert.equal(query.status, 401);
});

test('cookie session requires CSRF while bearer token does not', async () => {
    const app = createProtectedApp();
    const { createAdminSession } = require('../src/utils/admin-session');
    const session = createAdminSession();
    const cookie = `admin_session=${encodeURIComponent(session.id)}`;

    const missing = await request(app, { method: 'POST', path: '/admin/write', headers: { cookie }, body: {} });
    assert.equal(missing.status, 403);

    const wrong = await request(app, { method: 'POST', path: '/admin/write', headers: { cookie, 'x-csrf-token': 'wrong' }, body: {} });
    assert.equal(wrong.status, 403);

    const good = await request(app, { method: 'POST', path: '/admin/write', headers: { cookie, 'x-csrf-token': session.csrfToken }, body: {} });
    assert.equal(good.status, 200);

    const bearer = await request(app, { method: 'POST', path: '/admin/write', headers: { authorization: 'Bearer test-admin-token' }, body: {} });
    assert.equal(bearer.status, 200);
});

test('logout destroys the server-side session', async () => {
    useProductionEnv();
    clearProjectModules();
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/admin', require('../src/routes/admin.routes'));

    const login = await request(app, { method: 'POST', path: '/admin/login', body: { token: 'test-admin-token' } });
    const parsed = JSON.parse(login.text);
    const cookie = `admin_session=${cookieValue(login.headers['set-cookie'], 'admin_session')}`;

    const logout = await request(app, {
        method: 'POST',
        path: '/admin/logout',
        headers: { cookie, 'x-csrf-token': parsed.csrfToken },
        body: {}
    });
    assert.equal(logout.status, 302);

    const after = await request(app, { path: '/admin/', headers: { cookie, accept: 'text/html' } });
    assert.equal(after.status, 302);
});

test('session expiry invalidates sessions', () => {
    useProductionEnv();
    clearProjectModules();
    const { createAdminSession, getAdminSession, SESSION_TTL_MS } = require('../src/utils/admin-session');
    const session = createAdminSession(1000);
    assert.ok(getAdminSession(session.id, 1000 + SESSION_TTL_MS - 1));
    assert.equal(getAdminSession(session.id, 1000 + SESSION_TTL_MS + 1), null);
});

test('dashboard and drivers render dynamic data without escapeHtml ReferenceError', async () => {
    useProductionEnv();
    clearProjectModules();
    const pool = require('../src/database/pool');
    pool.query = async (sql) => {
        if (sql.includes('FROM drivers') && sql.includes('ORDER BY name')) {
            return { rows: [{ uuid: 'driver-uuid-123456', name: '<Driver>', is_active: true, license_plate: 'ABC<1>', email: 'a@example.com', phone: '<phone>', photo_url: '' }] };
        }
        if (sql.includes('FROM drivers')) return { rows: [{ name: '<Driver>', is_active: true }] };
        if (sql.includes('FROM live_updates')) return { rows: [{ driver_name: '<Driver>', status: '<Online>', timestamp: Date.now() }] };
        return { rows: [{ count: '1' }] };
    };

    const app = express();
    app.use(express.json());
    app.use('/admin', require('../src/routes/admin.routes'));

    const auth = { authorization: 'Bearer test-admin-token' };
    const dashboard = await request(app, { path: '/admin/', headers: auth });
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /&lt;Driver&gt;/);

    const drivers = await request(app, { path: '/admin/drivers', headers: auth });
    assert.equal(drivers.status, 200);
    assert.match(drivers.text, /&lt;Driver&gt;/);
});

test('/admin/tours is owned by the legacy Tour Core admin route', async () => {
    useProductionEnv();
    clearProjectModules();
    const app = express();
    app.use(express.json());
    app.use('/admin', require('../src/routes/admin.routes'));
    app.use(require('../src/routes/tour-core.routes'));

    const res = await request(app, { path: '/admin/tours', headers: { authorization: 'Bearer test-admin-token' } });
    assert.equal(res.status, 200);
    assert.match(res.text, /tour-details-card/);
    assert.match(res.text, /tour-cargo-summary/);
    assert.doesNotMatch(res.text, /admin-tour-map/);
});

test('/admin/drivers/new is not captured by /admin/drivers/:uuid', async () => {
    useProductionEnv();
    clearProjectModules();
    const app = express();
    app.use(express.json());
    app.use('/admin', require('../src/routes/admin.routes'));

    const res = await request(app, { path: '/admin/drivers/new', headers: { authorization: 'Bearer test-admin-token' } });
    assert.equal(res.status, 200);
    assert.match(res.text, /new|Ăšj|Új/i);
    assert.doesNotMatch(res.text, /Sofőradatlap/);
});
