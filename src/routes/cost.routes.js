const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const ndp = require('../integrations/ndp-client');

const costReadRoutes = express.Router();
const costManagementRoutes = express.Router();

costReadRoutes.get('/api/get-costs/:driverName', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM costs WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY timestamp DESC', [req.params.driverName]);
        res.json(result.rows.map(r => ({
            ...r,
            driverName: r.driver_name,
            photoPath: r.photo_path,
            timestamp: Number(r.timestamp),
            createdAt: Number(r.created_at || r.timestamp || 0),
            updatedAt: Number(r.updated_at || r.timestamp || 0),
            deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
            syncState: r.sync_state || 'SYNCED',
            revision: Number(r.revision || 1)
        })));
    } catch (e) { res.status(500).send(e.message); }
});

costManagementRoutes.post('/api/sync-costs', async (req, res) => {
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
            const now = Date.now();
            await client.query(`INSERT INTO costs (uuid, driver_name, amount, currency, category, notes, mileage, photo_path, status, timestamp, created_at, updated_at, deleted_at, sync_state, revision)
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'Rogzitve'), $10, $11, $11, $12, 'SYNCED', 1)
                ON CONFLICT (uuid) DO UPDATE SET
                    driver_name = EXCLUDED.driver_name,
                    amount = EXCLUDED.amount,
                    currency = EXCLUDED.currency,
                    category = EXCLUDED.category,
                    notes = EXCLUDED.notes,
                    mileage = EXCLUDED.mileage,
                    photo_path = EXCLUDED.photo_path,
                    status = EXCLUDED.status,
                    timestamp = EXCLUDED.timestamp,
                    deleted_at = EXCLUDED.deleted_at,
                    updated_at = EXCLUDED.updated_at,
                    sync_state = 'SYNCED',
                    revision = COALESCE(costs.revision, 1) + 1`,
                [c.uuid || null, c.driverName, c.amount, c.currency, c.category, c.notes, c.mileage, c.photoPath || c.photo_path || null, c.status || null, c.timestamp, now, c.deletedAt || c.deleted_at || null]);
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
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

costManagementRoutes.get('/api/cost-status/:driverName', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, uuid, status, timestamp, amount, revision, updated_at FROM costs WHERE driver_name = $1 AND deleted_at IS NULL ORDER BY timestamp DESC',
            [req.params.driverName]
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
        res.status(500).send(e.message);
    }
});

costManagementRoutes.post('/admin/update-cost-status', requireAdmin, async (req, res) => {
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

costManagementRoutes.post('/admin/save-cost', requireAdmin, async (req, res) => {
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
