const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

function request(app, { method = 'GET', path = '/', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method,
                path,
                headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }
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

test('rate limiter returns structured 429 and retry-after', async () => {
    const { rateLimit, clearRateLimits } = require('../src/middleware/rate-limit');
    clearRateLimits();
    const app = express();
    app.get('/limited', rateLimit({ name: 'test', windowMs: 60_000, max: 1, key: () => 'client' }), (_req, res) => res.json({ ok: true }));

    assert.equal((await request(app, { path: '/limited' })).status, 200);
    const blocked = await request(app, { path: '/limited' });
    assert.equal(blocked.status, 429);
    assert.equal(JSON.parse(blocked.text).error, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    clearRateLimits();
});
