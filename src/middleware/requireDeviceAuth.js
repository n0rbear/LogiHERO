const crypto = require('node:crypto');
const pool = require('../database/pool');
const { rateLimit } = require('./rate-limit');

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
        return limitedDeviceFailure(req, res, { error: 'DEVICE_CREDENTIAL_MISSING', credentialState: 'MISSING' }, 401);
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
        if (!row) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=auth_failed result=401 reason=reactivation_required`);
            return limitedDeviceFailure(req, res, { error: 'REACTIVATION_REQUIRED', credentialState: 'REACTIVATION_REQUIRED' }, 401);
        }
        if (!row.device_token_hash || !safeEqual(hashToken(token), row.device_token_hash)) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=auth_failed result=401 reason=invalid`);
            return limitedDeviceFailure(req, res, { error: 'DEVICE_CREDENTIAL_INVALID', credentialState: 'INVALID' }, 401);
        }
        if (!row.is_active || row.deleted_at) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=device_disabled result=403`);
            return res.status(403).json({ error: 'DEVICE_DISABLED', credentialState: 'DEVICE_DISABLED' });
        }
        if (!row.driver_active) {
            console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=driver_disabled result=403`);
            return res.status(403).json({ error: 'DRIVER_DISABLED', credentialState: 'DRIVER_DISABLED' });
        }
        req.deviceAuth = { deviceId, driverUuid, driverName: row.driver_name || null };
        await pool.query('UPDATE driver_devices SET last_seen_at = $1 WHERE device_id = $2', [Date.now(), deviceId]);
        return next();
    } catch (error) {
        return next(error);
    }
}

const failedDeviceLimiter = rateLimit({
    name: 'device-auth-failure',
    windowMs: 60_000,
    max: 20,
    key: (req) => `${req.headers['x-device-id'] || req.ip || 'unknown'}`
});

function limitedDeviceFailure(req, res, payload, status) {
    return failedDeviceLimiter(req, {
        setHeader: (...args) => res.setHeader(...args),
        status: (code) => ({
            json: (body) => res.status(code).json(body)
        })
    }, () => res.status(status).json(payload));
}

function generateDeviceToken() {
    return crypto.randomBytes(32).toString('base64url');
}

module.exports = {
    requireDeviceAuth,
    hashToken,
    generateDeviceToken
};
