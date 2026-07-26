const test = require('node:test');
const assert = require('node:assert/strict');

function clearProjectModules() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('\\src\\') || key.includes('/src/')) delete require.cache[key];
    }
}

test('device auth accepts active device token and rejects missing or stale credentials', async () => {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const { hashToken, requireDeviceAuth } = require('../src/middleware/requireDeviceAuth');
    pool.query = async (_sql, params) => {
        if (params[0] !== 'device-a' || params[1] !== '11111111-1111-4111-8111-111111111111') return { rows: [] };
        return { rows: [{ device_token_hash: hashToken('secret'), is_active: true, driver_active: true, deleted_at: null }] };
    };
    const goodReq = { headers: { 'x-device-id': 'device-a', 'x-device-token': 'secret', 'x-driver-uuid': '11111111-1111-4111-8111-111111111111' }, requestId: 'test' };
    let nextCalled = false;
    await requireDeviceAuth(goodReq, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    let status = 0;
    let body = null;
    await requireDeviceAuth({ headers: {}, requestId: 'test' }, { status: (code) => { status = code; return { json(value) { body = value; } }; } }, () => {});
    assert.equal(status, 401);
    assert.equal(body.credentialState, 'MISSING');
});

test('device auth returns specific states for disabled device, disabled driver and rotated token', async () => {
    clearProjectModules();
    const pool = require('../src/database/pool');
    const { hashToken, requireDeviceAuth } = require('../src/middleware/requireDeviceAuth');
    pool.query = async (_sql, params) => {
        if (params[0] === 'disabled-device') return { rows: [{ device_token_hash: hashToken('secret'), is_active: false, driver_active: true, deleted_at: null }] };
        if (params[0] === 'disabled-driver') return { rows: [{ device_token_hash: hashToken('secret'), is_active: true, driver_active: false, deleted_at: null }] };
        if (params[0] === 'rotated-device') return { rows: [{ device_token_hash: hashToken('new-secret'), is_active: true, driver_active: true, deleted_at: null }] };
        return { rows: [] };
    };

    async function probe(deviceId, token) {
        let status = 0;
        let body = null;
        await requireDeviceAuth(
            { headers: { 'x-device-id': deviceId, 'x-device-token': token, 'x-driver-uuid': '11111111-1111-4111-8111-111111111111' }, requestId: 'test' },
            { status: (code) => { status = code; return { json(value) { body = value; } }; } },
            () => {}
        );
        return { status, body };
    }

    assert.deepEqual(await probe('disabled-device', 'secret'), { status: 403, body: { error: 'DEVICE_DISABLED', credentialState: 'DEVICE_DISABLED' } });
    assert.deepEqual(await probe('disabled-driver', 'secret'), { status: 403, body: { error: 'DRIVER_DISABLED', credentialState: 'DRIVER_DISABLED' } });
    assert.deepEqual(await probe('rotated-device', 'old-secret'), { status: 401, body: { error: 'DEVICE_CREDENTIAL_INVALID', credentialState: 'INVALID' } });

    let nextCalled = false;
    await requireDeviceAuth(
        { headers: { 'x-device-id': 'rotated-device', 'x-device-token': 'new-secret', 'x-driver-uuid': '11111111-1111-4111-8111-111111111111' }, requestId: 'test' },
        {},
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, true);
});
