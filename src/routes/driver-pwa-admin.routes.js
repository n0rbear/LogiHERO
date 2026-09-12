const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAdminWrite } = require('../middleware/requireAdmin');
const { rateLimit } = require('../middleware/rate-limit');
const { generateTemporaryPassword, hashPassword, validateUsername } = require('../utils/driver-password');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adminAuthLimit = rateLimit({ name: 'driver-web-admin-auth', windowMs: 60_000, max: 12 });

function invalidUuid(req, res, next) {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'INVALID_DRIVER_UUID' });
    next();
}

async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

function sendAdminError(error, res, next) {
    if (error.code === '23505') return res.status(409).json({ error: 'USERNAME_UNAVAILABLE' });
    return next(error);
}

router.post('/drivers/:uuid/web-account/provision', requireAdmin, requireAdminWrite, adminAuthLimit, invalidUuid, async (req, res, next) => {
    const usernameNormalized = validateUsername(req.body?.username);
    if (!usernameNormalized) return res.status(400).json({ error: 'INVALID_USERNAME' });
    const temporaryPassword = generateTemporaryPassword();
    try {
        const passwordHash = await hashPassword(temporaryPassword);
        const account = await transaction(async (client) => {
            const driver = (await client.query('SELECT uuid FROM drivers WHERE uuid = $1 FOR UPDATE', [req.params.uuid])).rows[0];
            if (!driver) return null;
            const now = Date.now();
            const saved = (await client.query(
                `INSERT INTO driver_accounts
                    (driver_uuid, username, username_normalized, password_hash, must_change_password, is_active, password_version, created_at, updated_at)
                 VALUES ($1, $2, $2, $3, TRUE, TRUE, 1, $4, $4)
                 ON CONFLICT (driver_uuid) DO UPDATE SET
                    username = EXCLUDED.username,
                    username_normalized = EXCLUDED.username_normalized,
                    password_hash = EXCLUDED.password_hash,
                    must_change_password = TRUE,
                    is_active = driver_accounts.is_active,
                    password_version = driver_accounts.password_version + 1,
                    password_changed_at = NULL,
                    updated_at = EXCLUDED.updated_at
                 RETURNING uuid, username, is_active, must_change_password`,
                [driver.uuid, usernameNormalized, passwordHash, now]
            )).rows[0];
            await client.query("UPDATE driver_web_sessions SET revoked_at = $1, revoke_reason = 'admin_provision' WHERE account_uuid = $2 AND revoked_at IS NULL", [now, saved.uuid]);
            return saved;
        });
        if (!account) return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} actor=admin action=provision driver=${req.params.uuid} result=ok`);
        res.json({ username: account.username, isActive: account.is_active, mustChangePassword: account.must_change_password, temporaryPassword });
    } catch (error) {
        sendAdminError(error, res, next);
    }
});

router.post('/drivers/:uuid/web-account/reset-password', requireAdmin, requireAdminWrite, adminAuthLimit, invalidUuid, async (req, res, next) => {
    const temporaryPassword = generateTemporaryPassword();
    try {
        const passwordHash = await hashPassword(temporaryPassword);
        const account = await transaction(async (client) => {
            const now = Date.now();
            const saved = (await client.query(
                `UPDATE driver_accounts SET password_hash = $1, must_change_password = TRUE,
                    password_version = password_version + 1, password_changed_at = NULL, updated_at = $2
                 WHERE driver_uuid = $3 RETURNING uuid, username, is_active, must_change_password`,
                [passwordHash, now, req.params.uuid]
            )).rows[0];
            if (!saved) return null;
            await client.query("UPDATE driver_web_sessions SET revoked_at = $1, revoke_reason = 'admin_password_reset' WHERE account_uuid = $2 AND revoked_at IS NULL", [now, saved.uuid]);
            return saved;
        });
        if (!account) return res.status(404).json({ error: 'DRIVER_ACCOUNT_NOT_FOUND' });
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} actor=admin action=reset_password driver=${req.params.uuid} result=ok`);
        res.json({ username: account.username, isActive: account.is_active, mustChangePassword: true, temporaryPassword });
    } catch (error) {
        next(error);
    }
});

router.post('/drivers/:uuid/web-account/status', requireAdmin, requireAdminWrite, adminAuthLimit, invalidUuid, async (req, res, next) => {
    if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'INVALID_STATUS' });
    try {
        const account = await transaction(async (client) => {
            const now = Date.now();
            const saved = (await client.query(
                'UPDATE driver_accounts SET is_active = $1, updated_at = $2 WHERE driver_uuid = $3 RETURNING uuid, username, is_active, must_change_password',
                [req.body.isActive, now, req.params.uuid]
            )).rows[0];
            if (!saved) return null;
            if (!req.body.isActive) {
                await client.query("UPDATE driver_web_sessions SET revoked_at = $1, revoke_reason = 'admin_disabled' WHERE account_uuid = $2 AND revoked_at IS NULL", [now, saved.uuid]);
            }
            return saved;
        });
        if (!account) return res.status(404).json({ error: 'DRIVER_ACCOUNT_NOT_FOUND' });
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} actor=admin action=${req.body.isActive ? 'enable' : 'disable'} driver=${req.params.uuid} result=ok`);
        res.json({ username: account.username, isActive: account.is_active, mustChangePassword: account.must_change_password });
    } catch (error) {
        next(error);
    }
});

router.post('/drivers/:uuid/web-account/revoke-sessions', requireAdmin, requireAdminWrite, adminAuthLimit, invalidUuid, async (req, res, next) => {
    try {
        const result = await pool.query(
            `UPDATE driver_web_sessions s SET revoked_at = $1, revoke_reason = 'admin_revoked'
             FROM driver_accounts a
             WHERE s.account_uuid = a.uuid AND a.driver_uuid = $2 AND s.revoked_at IS NULL`,
            [Date.now(), req.params.uuid]
        );
        console.log(`[DRIVER_WEB_AUTH] requestId=${req.requestId || 'unknown'} actor=admin action=revoke_sessions driver=${req.params.uuid} result=ok count=${result.rowCount}`);
        res.json({ revokedSessions: result.rowCount });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
