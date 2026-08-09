const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_UUID = '11111111-1111-4111-8111-111111111111';
const COMPANY_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVER_SECRET = 'server-side-mistral-secret-for-tests';

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

function authHeaders({ token = 'secret-a', driverUuid = DRIVER_UUID } = {}) {
    return {
        'x-device-id': 'device-a',
        'x-device-token': token,
        'x-driver-uuid': driverUuid
    };
}

function request(app, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method: 'POST',
                path: '/api/ai/chat',
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

function createApp({ apiKey = SERVER_SECRET, fetchImpl } = {}) {
    const oldKey = process.env.MISTRAL_API_KEY;
    const oldUrl = process.env.MISTRAL_API_URL;
    if (apiKey === null) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = apiKey;
    process.env.MISTRAL_API_URL = 'https://mistral.test/v1/chat/completions';

    clearProjectModules();
    const pool = require('../src/database/pool');
    const calls = [];
    pool.query = async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM driver_devices')) {
            const [deviceId, driverUuid] = params;
            if (deviceId === 'device-a' && driverUuid === DRIVER_UUID) {
                return {
                    rows: [{
                        device_token_hash: hashToken('secret-a'),
                        is_active: true,
                        driver_active: true,
                        deleted_at: null,
                        driver_name: 'Driver A',
                        driver_company_uuid: COMPANY_UUID
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    };

    const previousFetch = global.fetch;
    global.fetch = fetchImpl || (async (_url, options) => {
        calls.push({ fetchOptions: options });
        return {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] })
        };
    });

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'ai-route-test'; next(); });
    app.use(express.json());
    app.use(require('../src/routes/ai.routes'));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

    function cleanup() {
        if (oldKey === undefined) delete process.env.MISTRAL_API_KEY;
        else process.env.MISTRAL_API_KEY = oldKey;
        if (oldUrl === undefined) delete process.env.MISTRAL_API_URL;
        else process.env.MISTRAL_API_URL = oldUrl;
        global.fetch = previousFetch;
    }
    return { app, calls, cleanup };
}

test('authenticated device can invoke backend AI operation using server-side Mistral authorization', async () => {
    const ctx = createApp();
    try {
        const res = await request(ctx.app, {
            headers: authHeaders(),
            body: {
                apiKey: 'client-supplied-key-must-be-ignored',
                model: 'mistral-small-latest',
                messages: [{ role: 'user', content: 'Extract JSON.' }]
            }
        });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(JSON.parse(res.text), { content: '{"ok":true}' });
        const fetchCall = ctx.calls.find(call => call.fetchOptions);
        assert.ok(fetchCall);
        assert.equal(fetchCall.fetchOptions.headers.authorization, `Bearer ${SERVER_SECRET}`);
        assert.equal(fetchCall.fetchOptions.body.includes('client-supplied-key'), false);
    } finally {
        ctx.cleanup();
    }
});

test('missing and invalid device authentication are rejected before Mistral fetch', async () => {
    for (const headers of [{}, authHeaders({ token: 'wrong' })]) {
        const ctx = createApp();
        try {
            const res = await request(ctx.app, {
                headers,
                body: { messages: [{ role: 'user', content: 'Hello' }] }
            });
            assert.equal(res.status, 401);
            assert.equal(ctx.calls.some(call => call.fetchOptions), false);
        } finally {
            ctx.cleanup();
        }
    }
});

test('missing server-side Mistral secret fails safely', async () => {
    const ctx = createApp({ apiKey: null });
    try {
        const res = await request(ctx.app, {
            headers: authHeaders(),
            body: { messages: [{ role: 'user', content: 'Hello' }] }
        });
        assert.equal(res.status, 503);
        assert.equal(JSON.parse(res.text).error, 'AI_PROVIDER_UNAVAILABLE');
        assert.equal(ctx.calls.some(call => call.fetchOptions), false);
    } finally {
        ctx.cleanup();
    }
});

test('upstream timeout and error do not leak provider secret', async () => {
    const cases = [
        {
            fetchImpl: async () => {
                const error = new Error('timeout with secret ' + SERVER_SECRET);
                error.name = 'TimeoutError';
                throw error;
            },
            status: 504,
            error: 'AI_PROVIDER_TIMEOUT'
        },
        {
            fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: SERVER_SECRET }) }),
            status: 502,
            error: 'AI_PROVIDER_ERROR'
        }
    ];

    for (const item of cases) {
        const ctx = createApp({ fetchImpl: item.fetchImpl });
        try {
            const res = await request(ctx.app, {
                headers: authHeaders(),
                body: { messages: [{ role: 'user', content: 'Hello' }] }
            });
            assert.equal(res.status, item.status, res.text);
            assert.equal(JSON.parse(res.text).error, item.error);
            assert.equal(res.text.includes(SERVER_SECRET), false);
        } finally {
            ctx.cleanup();
        }
    }
});

test('AI response contains only application content', async () => {
    const ctx = createApp({ fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'provider-id', usage: { total_tokens: 10 }, choices: [{ message: { content: 'answer' } }] })
    }) });
    try {
        const res = await request(ctx.app, {
            headers: authHeaders(),
            body: { messages: [{ role: 'user', content: 'Hello' }] }
        });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(JSON.parse(res.text), { content: 'answer' });
    } finally {
        ctx.cleanup();
    }
});
