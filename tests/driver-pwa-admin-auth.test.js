const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.ADMIN_TOKEN = 'driver-auth-full-admin';
process.env.READ_ONLY_ADMIN_TOKEN = 'driver-auth-read-only';
process.env.NODE_ENV = 'development';
delete process.env.RENDER;
delete process.env.RENDER_SERVICE_ID;

const pool = require('../src/database/pool');
const driverPwaAdminRoutes = require('../src/routes/driver-pwa-admin.routes');
const { clearRateLimits } = require('../src/middleware/rate-limit');

const DRIVER_UUID = '11111111-1111-4111-8111-111111111111';

async function withAdminServer(work) {
    const calls = [];
    const query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('UPDATE driver_accounts SET password_hash')) {
            return { rows: [{ uuid: '22222222-2222-4222-8222-222222222222', username: 'driver.one', is_active: true, must_change_password: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
    };
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = query;
    pool.connect = async () => ({ query, release: () => {} });
    const app = express();
    app.use(express.json());
    app.use('/admin', driverPwaAdminRoutes);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        await work(`http://127.0.0.1:${server.address().port}`, calls);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        clearRateLimits();
    }
}

function resetRequest(baseUrl, token) {
    return fetch(`${baseUrl}/admin/drivers/${DRIVER_UUID}/web-account/reset-password`, {
        method: 'POST',
        redirect: 'manual',
        headers: { authorization: token ? `Bearer ${token}` : '', accept: 'application/json', 'content-type': 'application/json' },
        body: '{}'
    });
}

test('driver credential reset is admin-only and READ_ONLY admins cannot mutate it', async () => {
    await withAdminServer(async (baseUrl, calls) => {
        const anonymous = await resetRequest(baseUrl);
        assert.equal(anonymous.status, 401);
        const readOnly = await resetRequest(baseUrl, 'driver-auth-read-only');
        assert.equal(readOnly.status, 403);
        assert.equal(calls.length, 0);
    });
});

test('FULL_ADMIN reset stores only Argon2id hash and returns temporary password once', async () => {
    await withAdminServer(async (baseUrl, calls) => {
        const response = await resetRequest(baseUrl, 'driver-auth-full-admin');
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.match(body.temporaryPassword, /^.{12,}$/);
        assert.equal(Object.hasOwn(body, 'passwordHash'), false);
        const passwordUpdate = calls.find((call) => call.sql.includes('UPDATE driver_accounts SET password_hash'));
        assert.match(passwordUpdate.params[0], /^\$argon2id\$/);
        assert.equal(passwordUpdate.params.some((param) => param === body.temporaryPassword), false);
        assert.ok(calls.some((call) => call.sql.includes("revoke_reason = 'admin_password_reset'")));
    });
});
