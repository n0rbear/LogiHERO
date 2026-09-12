const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
    PASSWORD_MIN_LENGTH,
    generateTemporaryPassword,
    hashPassword,
    normalizeUsername,
    validatePassword,
    validateUsername,
    verifyPassword
} = require('../src/utils/driver-password');
const {
    createDriverSession,
    hashToken,
    loadDriverSession,
    verifySessionCsrf
} = require('../src/utils/driver-session');
const { sameOriginRequest } = require('../src/routes/driver-pwa.routes');
const driverPwaRoutes = require('../src/routes/driver-pwa.routes');
const pool = require('../src/database/pool');
const { clearRateLimits } = require('../src/middleware/rate-limit');

async function withPwaServer(query, work) {
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    pool.query = query;
    pool.connect = async () => { throw new Error('unexpected transaction'); };
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(driverPwaRoutes);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        await work(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        pool.query = originalQuery;
        pool.connect = originalConnect;
        clearRateLimits();
    }
}

function loginRequest(baseUrl, username, password) {
    return fetch(`${baseUrl}/app/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl },
        body: new URLSearchParams({ username, password })
    });
}

test('driver web passwords use Argon2id and reject wrong credentials', async () => {
    const password = 'Correct horse battery staple!';
    const hash = await hashPassword(password);
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, password), true);
    assert.equal(await verifyPassword(hash, 'wrong-password-value'), false);
    assert.equal(hash.includes(password), false);
});

test('driver username and password policy is normalized and bounded', () => {
    assert.equal(normalizeUsername('  Driver.One  '), 'driver.one');
    assert.equal(validateUsername('Driver.One'), 'driver.one');
    assert.equal(validateUsername('ab'), null);
    assert.equal(validateUsername('driver name'), null);
    assert.equal(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH)), true);
    assert.equal(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH - 1)), false);
    const temporary = generateTemporaryPassword();
    assert.equal(validatePassword(temporary), true);
    assert.match(temporary, /^[A-Za-z0-9!@#$%]+$/);
});

test('driver session persists only token hashes and validates the bound CSRF token', async () => {
    const calls = [];
    const db = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [], rowCount: 1 };
        }
    };
    const created = await createDriverSession(db, { account_uuid: '11111111-1111-4111-8111-111111111111', password_version: 4 }, { headers: { 'user-agent': 'test' } }, 1000);
    const insert = calls[0];
    assert.equal(insert.params.includes(created.token), false);
    assert.equal(insert.params.includes(created.csrfToken), false);
    assert.equal(insert.params[1], hashToken(created.token));
    assert.equal(insert.params[2], hashToken(created.csrfToken));
    assert.equal(verifySessionCsrf({ csrf_token_hash: insert.params[2] }, created.csrfToken), true);
    assert.equal(verifySessionCsrf({ csrf_token_hash: insert.params[2] }, 'wrong'), false);
});

test('driver session identity comes from the database, not caller-controlled request fields', async () => {
    const token = 'opaque-browser-session';
    const csrf = 'browser-csrf-token';
    const calls = [];
    const db = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes('FROM driver_web_sessions')) {
                return { rows: [{
                    session_uuid: '10000000-0000-4000-8000-000000000001',
                    csrf_token_hash: hashToken(csrf),
                    account_uuid: '20000000-0000-4000-8000-000000000001',
                    driver_uuid: '30000000-0000-4000-8000-000000000001',
                    driver_name: 'Database Driver',
                    company_uuid: '40000000-0000-4000-8000-000000000001',
                    password_version: 2,
                    must_change_password: false
                }] };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const session = await loadDriverSession(db, {
        headers: { cookie: `driver_session=${token}; driver_csrf=${csrf}` },
        body: { driver_uuid: 'attacker-selected-driver' },
        query: { company_uuid: 'attacker-selected-company' }
    }, 2000);
    assert.equal(calls[0].params[0], hashToken(token));
    assert.equal(session.driver_name, 'Database Driver');
    assert.equal(session.driver_uuid, '30000000-0000-4000-8000-000000000001');
    assert.equal(session.company_uuid, '40000000-0000-4000-8000-000000000001');
    assert.equal(session.csrfToken, csrf);
});

test('login POST accepts only a same-host browser origin', () => {
    const req = (origin, host = 'logihero.example') => ({ headers: { origin }, get: (name) => name === 'host' ? host : undefined });
    assert.equal(sameOriginRequest(req('https://logihero.example')), true);
    assert.equal(sameOriginRequest(req('https://evil.example')), false);
    assert.equal(sameOriginRequest(req(undefined)), false);
});

test('invalid username, invalid password, and disabled account have the same login failure', async () => {
    const validHash = await hashPassword('A-valid-test-password!');
    await withPwaServer(async (_sql, params) => {
        if (params[0] === 'known-driver') return { rows: [{ password_hash: validHash, account_active: true, driver_active: true }] };
        if (params[0] === 'disabled-driver') return { rows: [{ password_hash: validHash, account_active: false, driver_active: true }] };
        return { rows: [] };
    }, async (baseUrl) => {
        const responses = await Promise.all([
            loginRequest(baseUrl, 'missing-driver', 'A-valid-test-password!'),
            loginRequest(baseUrl, 'known-driver', 'A-wrong-test-password!'),
            loginRequest(baseUrl, 'disabled-driver', 'A-valid-test-password!')
        ]);
        for (const response of responses) {
            assert.equal(response.status, 303);
            assert.equal(response.headers.get('location'), '/app/login?error=1');
        }
    });
});

test('anonymous app access is rejected and repeated login attempts are rate limited', async () => {
    await withPwaServer(async () => ({ rows: [] }), async (baseUrl) => {
        const anonymous = await fetch(`${baseUrl}/app`, { redirect: 'manual' });
        assert.equal(anonymous.status, 303);
        assert.equal(anonymous.headers.get('location'), '/app/login');
        for (let attempt = 1; attempt <= 8; attempt += 1) {
            const response = await loginRequest(baseUrl, `missing-${attempt}`, 'A-valid-test-password!');
            assert.equal(response.status, 303);
        }
        const limited = await loginRequest(baseUrl, 'missing-9', 'A-valid-test-password!');
        assert.equal(limited.status, 429);
        assert.equal((await limited.json()).error, 'RATE_LIMITED');
        assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    });
});
