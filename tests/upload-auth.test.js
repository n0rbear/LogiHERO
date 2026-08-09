const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashToken } = require('../src/middleware/requireDeviceAuth');

const DRIVER_A_UUID = '11111111-1111-4111-8111-111111111111';
const DRIVER_B_UUID = '22222222-2222-4222-8222-222222222222';
const COMPANY_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STOP_A_UUID = '33333333-3333-4333-8333-333333333333';
const STOP_B_UUID = '44444444-4444-4444-8444-444444444444';
const TOUR_A_UUID = '55555555-5555-4555-8555-555555555555';
const TOUR_B_UUID = '66666666-6666-4666-8666-666666666666';
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00]).toString('base64');

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

function request(app, { method = 'POST', path: requestPath = '/', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const data = body === undefined ? null : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.address().port,
                method,
                path: requestPath,
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

function listUploadedFiles(uploadDir) {
    return fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).sort() : [];
}

function createApp() {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logihero-upload-auth-'));
    const previousUploadDir = process.env.LOGIHERO_UPLOAD_DIR;
    process.env.LOGIHERO_UPLOAD_DIR = uploadDir;
    clearProjectModules();

    const calls = [];
    const pool = require('../src/database/pool');
    pool.query = async (sql, params = []) => {
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
                        driver_company_uuid: COMPANY_UUID
                    }],
                    rowCount: 1
                };
            }
            if (deviceId === 'device-b' && driverUuid === DRIVER_B_UUID) {
                return {
                    rows: [{
                        device_token_hash: hashToken('secret-b'),
                        is_active: true,
                        driver_active: true,
                        deleted_at: null,
                        driver_name: 'Driver B',
                        driver_company_uuid: COMPANY_UUID
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.startsWith('UPDATE driver_devices SET last_seen_at')) return { rows: [], rowCount: 1 };
        if (sql.includes('UPDATE drivers')) {
            assert.equal(params[2], DRIVER_A_UUID);
            return { rows: [{ uuid: DRIVER_A_UUID }], rowCount: 1 };
        }
        if (sql.includes('FROM stops s') && sql.includes('JOIN tours t')) {
            const stopUuid = params[0];
            if (stopUuid === STOP_A_UUID) {
                return {
                    rows: [{
                        id: 7,
                        stop_uuid: STOP_A_UUID,
                        tour_id: 11,
                        stop_driver_uuid: DRIVER_A_UUID,
                        stop_company_uuid: COMPANY_UUID,
                        tour_uuid: TOUR_A_UUID,
                        tour_driver_uuid: DRIVER_A_UUID,
                        tour_driver_name: 'Driver A',
                        tour_company_uuid: COMPANY_UUID
                    }],
                    rowCount: 1
                };
            }
            if (stopUuid === STOP_B_UUID) {
                return {
                    rows: [{
                        id: 8,
                        stop_uuid: STOP_B_UUID,
                        tour_id: 12,
                        stop_driver_uuid: DRIVER_B_UUID,
                        stop_company_uuid: COMPANY_UUID,
                        tour_uuid: TOUR_B_UUID,
                        tour_driver_uuid: DRIVER_B_UUID,
                        tour_driver_name: 'Driver B',
                        tour_company_uuid: COMPANY_UUID
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        }
        if (sql.includes('UPDATE stops s')) {
            assert.equal(params[2], STOP_A_UUID);
            assert.equal(params[3], DRIVER_A_UUID);
            return { rows: [{ uuid: STOP_A_UUID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    };

    const app = express();
    app.use((req, _res, next) => { req.requestId = 'upload-auth-test'; next(); });
    app.use(express.json({ limit: '2mb' }));
    app.use(require('../src/routes/upload.routes').uploadRoutes);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.publicMessage || 'INTERNAL_ERROR' }));

    function cleanup() {
        if (previousUploadDir === undefined) delete process.env.LOGIHERO_UPLOAD_DIR;
        else process.env.LOGIHERO_UPLOAD_DIR = previousUploadDir;
        fs.rmSync(uploadDir, { recursive: true, force: true });
    }

    return { app, calls, uploadDir, cleanup };
}

test('authenticated driver can upload own profile photo', async () => {
    const ctx = createApp();
    try {
        const res = await request(ctx.app, {
            path: '/api/upload-photo',
            headers: authHeaders(),
            body: { driverName: 'Driver A', uuid: DRIVER_A_UUID, imageBase64: PNG_BASE64 }
        });
        assert.equal(res.status, 200, res.text);
        const body = JSON.parse(res.text);
        assert.match(body.photoUrl, /^\/uploads\/photo_[0-9a-f-]+\.png$/);
        assert.equal(body.photoUrl.includes(DRIVER_A_UUID), false);
        assert.equal(body.photoUrl.includes('Driver'), false);
        assert.equal(listUploadedFiles(ctx.uploadDir).length, 1);
        assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE drivers')), true);
    } finally {
        ctx.cleanup();
    }
});

test('unauthenticated and invalid profile photo uploads are rejected before file or driver update', async () => {
    for (const headers of [{}, authHeaders({ token: 'wrong' })]) {
        const ctx = createApp();
        try {
            const res = await request(ctx.app, {
                path: '/api/upload-photo',
                headers,
                body: { driverName: 'Driver A', uuid: DRIVER_A_UUID, imageBase64: PNG_BASE64 }
            });
            assert.equal(res.status, 401);
            assert.deepEqual(listUploadedFiles(ctx.uploadDir), []);
            assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE drivers')), false);
        } finally {
            ctx.cleanup();
        }
    }
});

test('authenticated Driver A cannot upload Driver B profile photo by changing request identity', async () => {
    const ctx = createApp();
    try {
        const res = await request(ctx.app, {
            path: '/api/upload-photo',
            headers: authHeaders(),
            body: { driverName: 'Driver B', uuid: DRIVER_B_UUID, imageBase64: PNG_BASE64 }
        });
        assert.equal(res.status, 403);
        assert.equal(JSON.parse(res.text).error, 'DRIVER_SCOPE_DENIED');
        assert.deepEqual(listUploadedFiles(ctx.uploadDir), []);
        assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE drivers')), false);
    } finally {
        ctx.cleanup();
    }
});

test('authenticated driver can upload a photo for an owned stop', async () => {
    const ctx = createApp();
    try {
        const res = await request(ctx.app, {
            path: '/api/upload-stop-photo',
            headers: authHeaders(),
            body: { stopUuid: STOP_A_UUID, imageBase64: PNG_BASE64 }
        });
        assert.equal(res.status, 200, res.text);
        const body = JSON.parse(res.text);
        assert.match(body.photoUrl, /^\/uploads\/stop_[0-9a-f-]+\.png$/);
        assert.equal(body.photoUrl.includes(STOP_A_UUID), false);
        assert.equal(listUploadedFiles(ctx.uploadDir).length, 1);
        assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE stops s')), true);
    } finally {
        ctx.cleanup();
    }
});

test('unauthenticated and invalid stop photo uploads are rejected before file or stop update', async () => {
    for (const headers of [{}, authHeaders({ token: 'wrong' })]) {
        const ctx = createApp();
        try {
            const res = await request(ctx.app, {
                path: '/api/upload-stop-photo',
                headers,
                body: { stopUuid: STOP_A_UUID, imageBase64: PNG_BASE64 }
            });
            assert.equal(res.status, 401);
            assert.deepEqual(listUploadedFiles(ctx.uploadDir), []);
            assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE stops s')), false);
        } finally {
            ctx.cleanup();
        }
    }
});

test('authenticated Driver A cannot upload photo for Driver B stop', async () => {
    const ctx = createApp();
    try {
        const res = await request(ctx.app, {
            path: '/api/upload-stop-photo',
            headers: authHeaders(),
            body: { stopUuid: STOP_B_UUID, imageBase64: PNG_BASE64 }
        });
        assert.equal(res.status, 403);
        assert.equal(JSON.parse(res.text).error, 'DRIVER_SCOPE_DENIED');
        assert.deepEqual(listUploadedFiles(ctx.uploadDir), []);
        assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE stops s')), false);
    } finally {
        ctx.cleanup();
    }
});

test('changing stop request driver or tour identifiers cannot bypass ownership', async () => {
    const attempts = [
        { stopUuid: STOP_A_UUID, driverName: 'Driver B', imageBase64: PNG_BASE64 },
        { stopUuid: STOP_A_UUID, tourUuid: TOUR_B_UUID, imageBase64: PNG_BASE64 },
        { stopUuid: STOP_A_UUID, tourId: 12, imageBase64: PNG_BASE64 }
    ];
    for (const body of attempts) {
        const ctx = createApp();
        try {
            const res = await request(ctx.app, { path: '/api/upload-stop-photo', headers: authHeaders(), body });
            assert.equal(res.status, 403, res.text);
            assert.deepEqual(listUploadedFiles(ctx.uploadDir), []);
            assert.equal(ctx.calls.some(call => call.sql.includes('UPDATE stops s')), false);
        } finally {
            ctx.cleanup();
        }
    }
});
