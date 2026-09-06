const express = require('express');
const pool = require('../database/pool');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');

function requireAuthenticatedDriverName(req, res) {
    const authenticatedName = req.deviceAuth?.driverName;
    const requestedName = req.params.driverName;
    if (!authenticatedName || requestedName !== authenticatedName) {
        console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} action=driver_scope_denied result=403 requested=${requestedName || 'n/a'} authenticated=${authenticatedName || 'n/a'}`);
        res.status(403).json({ error: 'DRIVER_SCOPE_DENIED' });
        return null;
    }
    return authenticatedName;
}

const createSyncTourRoutes = ({ ImportEngine }) => {
    const syncTourRoutes = express.Router();

    syncTourRoutes.post('/api/sync-tours/:driverName', requireDeviceAuth, async (req, res, next) => {
        const driverName = requireAuthenticatedDriverName(req, res);
        if (!driverName) return;
        // Server-derived identity only: the payload never decides whose tour this is.
        const owner = {
            driverUuid: req.deviceAuth.driverUuid,
            driverName,
            companyUuid: req.deviceAuth.companyUuid || null
        };
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const item of (req.body || [])) {
                if (!item.tour) continue;
                if (item.tour.deletedAt && item.tour.uuid) {
                    const now = Date.now();
                    // Same ownership rule as every other tour read: driver UUID, falling back
                    // to the name only for legacy rows that predate driver_uuid, plus company.
                    const ownedTour = `SELECT id FROM tours
                         WHERE uuid::text = $2
                           AND (driver_uuid = $3::uuid OR (driver_uuid IS NULL AND driver_name = $4))
                           AND ($5::uuid IS NULL OR company_uuid IS NULL OR company_uuid = $5::uuid)`;
                    const deleteParams = [now, item.tour.uuid, owner.driverUuid, owner.driverName, owner.companyUuid];
                    await client.query(`UPDATE stops SET deleted_at = $1, updated_at = $1 WHERE tour_id IN (${ownedTour})`, deleteParams);
                    await client.query(`UPDATE tours SET deleted_at = $1, updated_at = $1 WHERE id IN (${ownedTour})`, deleteParams);
                    continue;
                }
                await ImportEngine.processTour(client, driverName, item.tour, item.stops || [], { source: 'mobile', cargo: item.cargo || [], owner });
            }
            await client.query('COMMIT');
            res.sendStatus(200);
        } catch (e) { await client.query('ROLLBACK'); next(e); }
        finally { client.release(); }
    });

    return syncTourRoutes;
};

module.exports = createSyncTourRoutes;
