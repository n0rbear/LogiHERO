const crypto = require('node:crypto');
const pool = require('../database/pool');

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
}

async function requireDeviceAuth(req, res, next) {
    const deviceId = req.headers['x-device-id'];
    const token = req.headers['x-device-token'];
    const driverUuid = req.headers['x-driver-uuid'] || req.body?.driverUuid || req.body?.driver_uuid || req.query?.driverUuid || req.query?.driver_uuid;

    if (!deviceId || !token || !driverUuid) {
        console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=auth_failed result=401 reason=missing`);
        return res.status(401).json({ error: 'Device authentication required.' });
    }

    try {
        const result = await pool.query(
            `SELECT dd.*, d.is_active AS driver_active
             FROM driver_devices dd
             JOIN drivers d ON d.uuid = dd.driver_uuid
             WHERE dd.device_id = $1 AND dd.driver_uuid = $2
             LIMIT 1`,
            [deviceId, driverUuid]
        );
        const row = result.rows[0];
        if (!row || !row.device_token_hash || !safeEqual(hashToken(token), row.device_token_hash)) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=auth_failed result=401 reason=invalid`);
            return res.status(401).json({ error: 'Device authentication failed.' });
        }
        if (!row.is_active || row.deleted_at || !row.driver_active) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=device_disabled result=403`);
            return res.status(403).json({ error: 'Device is not active.' });
        }
        req.deviceAuth = { deviceId, driverUuid, driverName: row.driver_name || null };
        await pool.query('UPDATE driver_devices SET last_seen_at = $1 WHERE device_id = $2', [Date.now(), deviceId]);
        return next();
    } catch (error) {
        return next(error);
    }
}

function generateDeviceToken() {
    return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
    requireDeviceAuth,
    hashToken,
    generateDeviceToken
};
