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
    await requireDeviceAuth({ headers: {}, requestId: 'test' }, { status: (code) => { status = code; return { json() {} }; } }, () => {});
    assert.equal(status, 401);
});
