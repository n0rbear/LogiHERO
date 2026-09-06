const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAdminWrite } = require('../middleware/requireAdmin');
const ndp = require('../integrations/ndp-client');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { ensureExistingUuidOwned, requireOwnDriverName } = require('../utils/mobile-scope');

const costReadRoutes = express.Router();
const costManagementRoutes = express.Router();

costReadRoutes.get('/api/get-costs/:driverName', requireDeviceAuth, async (req, res) => {
    try {
        const denied = requireOwnDriverName(req, res, req.params.driverName);
        if (denied) return denied;
        const result = await pool.query(
            `SELECT uuid, driver_name, amount, currency, category, notes, mileage, photo_path, status, timestamp,
                    created_at, updated_at, deleted_at, sync_state, revision
             FROM costs
             WHERE (driver_uuid = $1::uuid OR (driver_uuid IS NULL AND driver_name = $2))
               AND ($3::uuid IS NULL OR company_uuid IS NULL OR company_uuid = $3::uuid)
               AND deleted_at IS NULL
             ORDER BY timestamp DESC`,
            [req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid || null]
        );
        res.json(result.rows.map(r => ({
            uuid: r.uuid,
            amount: Number(r.amount),
            currency: r.currency,
            category: r.category,
            notes: r.notes,
            mileage: r.mileage === null || r.mileage === undefined ? null : Number(r.mileage),
            status: r.status,
            driverName: r.driver_name,
            photoPath: r.photo_path,
            timestamp: Number(r.timestamp),
            createdAt: Number(r.created_at || r.timestamp || 0),
            updatedAt: Number(r.updated_at || r.timestamp || 0),
            deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
            syncState: r.sync_state || 'SYNCED',
            revision: Number(r.revision || 1)
        })));
    } catch (e) { res.status(500).json({ error: 'COST_READ_FAILED' }); }
});

costManagementRoutes.post('/api/sync-costs', requireDeviceAuth, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
        await ndp.trackEvent({
            traceId,
            eventType: 'BACKEND_REQUEST_RECEIVED',
            title: 'Cost sync request received',
            component: 'sync',
            payload: {
                endpoint: 'api/sync-costs',
                itemCount: Array.isArray(req.body) ? req.body.length : 0
            }
        });
        await client.query('BEGIN');
        for (const c of req.body) {
            const denied = requireOwnDriverName(req, res, c.driverName || c.driver_name);
            if (denied) {
                await client.query('ROLLBACK');
                return denied;
            }
            if (!(await ensureExistingUuidOwned(client, req, 'costs', c.uuid))) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'COST_SCOPE_DENIED' });
            }
            const now = Date.now();
            await client.query(`INSERT INTO costs (uuid, company_uuid, driver_uuid, driver_name, amount, currency, category, notes, mileage, photo_path, status, timestamp, created_at, updated_at, deleted_at, sync_state, revision)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, 'Rogzitve', $11, $12, $12, $13, 'SYNCED', 1)
                ON CONFLICT (uuid) DO UPDATE SET
                    company_uuid = COALESCE(costs.company_uuid, EXCLUDED.company_uuid),
                    driver_uuid = COALESCE(costs.driver_uuid, EXCLUDED.driver_uuid),
                    amount = EXCLUDED.amount,
                    currency = EXCLUDED.currency,
                    category = EXCLUDED.category,
                    notes = EXCLUDED.notes,
                    mileage = EXCLUDED.mileage,
                    photo_path = EXCLUDED.photo_path,
                    timestamp = EXCLUDED.timestamp,
                    deleted_at = EXCLUDED.deleted_at,
                    updated_at = EXCLUDED.updated_at,
                    sync_state = 'SYNCED',
                    revision = COALESCE(costs.revision, 1) + 1`,
                [c.uuid || null, req.deviceAuth.companyUuid || null, req.deviceAuth.driverUuid, req.deviceAuth.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.photoPath || c.photo_path || null, c.timestamp, now, c.deletedAt || c.deleted_at || null]);
        }
        await client.query('COMMIT');
        await ndp.trackEvent({
            traceId,
            eventType: 'DATABASE_OPERATION_SUCCEEDED',
            source: 'DATABASE',
            title: 'Cost sync database operation succeeded',
            component: 'database',
            payload: {
                operation: 'upsert',
                entity: 'costs',
                status: 'success',
                durationMs: Date.now() - startedAt,
                affectedRecords: Array.isArray(req.body) ? req.body.length : 0
            }
        });
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-COSTS-ERROR] ${e.message}`);
        res.status(500).json({ error: 'COST_SYNC_FAILED' });
    } finally {
        client.release();
    }
});

costManagementRoutes.get('/api/cost-status/:driverName', requireDeviceAuth, async (req, res) => {
    try {
        const denied = requireOwnDriverName(req, res, req.params.driverName);
        if (denied) return denied;
        const result = await pool.query(
            `SELECT id, uuid, status, timestamp, amount, revision, updated_at
             FROM costs
             WHERE (driver_uuid = $1::uuid OR (driver_uuid IS NULL AND driver_name = $2))
               AND ($3::uuid IS NULL OR company_uuid IS NULL OR company_uuid = $3::uuid)
               AND deleted_at IS NULL
             ORDER BY timestamp DESC`,
            [req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid || null]
        );
        res.json(result.rows.map(r => ({
            id: r.id,
            uuid: r.uuid,
            status: r.status,
            timestamp: Number(r.timestamp),
            amount: Number(r.amount),
            revision: Number(r.revision || 1),
            updatedAt: Number(r.updated_at || r.timestamp || 0)
        })));
    } catch (e) {
        res.status(500).json({ error: 'COST_STATUS_READ_FAILED' });
    }
});

costManagementRoutes.post('/admin/update-cost-status', requireAdmin, requireAdminWrite, async (req, res) => {
    const { uuid, id, status } = req.body;
    const allowed = new Set(['Rogzitve', 'Bekuldve', 'Elfogadva', 'Kifizetve', 'Rögzítve', 'Beküldve']);
    if (!status || (!uuid && !id)) return res.sendStatus(400);
    if (!allowed.has(status)) return res.status(400).send('Invalid status');
    try {
        const now = Date.now();
        if (uuid) {
            await pool.query('UPDATE costs SET status = $1, updated_at = $2, sync_state = $3, revision = COALESCE(revision,1)+1 WHERE uuid::text = $4', [status, now, 'SYNCED', uuid]);
        } else {
            await pool.query('UPDATE costs SET status = $1, updated_at = $2, sync_state = $3, revision = COALESCE(revision,1)+1 WHERE id = $4', [status, now, 'SYNCED', id]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

costManagementRoutes.post('/admin/save-cost', requireAdmin, requireAdminWrite, async (req, res) => {
    const { driverName, amount, currency, category, notes, mileage, timestamp } = req.body;
    const parsedAmount = Number(amount);
    const parsedMileage = mileage === '' || mileage === null || mileage === undefined ? null : Number(mileage);
    const costTimestamp = Number(timestamp || Date.now());
    if (!driverName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.sendStatus(400);
    try {
        const driverRes = await pool.query('SELECT company_uuid, uuid FROM drivers WHERE name = $1 LIMIT 1', [driverName]);
        const driver = driverRes.rows[0] || {};
        const result = await pool.query(
            `INSERT INTO costs (company_uuid, driver_uuid, uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp, created_at, updated_at, sync_state, revision)
             VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, 'Rogzitve', $9, $9, $9, 'SYNCED', 1)
             RETURNING id, uuid, driver_name, amount, currency, category, notes, mileage, status, timestamp, revision, updated_at`,
            [
                driver.company_uuid || null,
                driver.uuid || null,
                driverName,
                parsedAmount,
                currency || 'EUR',
                category || 'Egyeb',
                notes || '',
                Number.isFinite(parsedMileage) ? parsedMileage : null,
                costTimestamp
            ]
        );
        const row = result.rows[0];
        res.json({ ...row, amount: Number(row.amount), timestamp: Number(row.timestamp), revision: Number(row.revision || 1), updatedAt: Number(row.updated_at || row.timestamp) });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = {
    costReadRoutes,
    costManagementRoutes
};
