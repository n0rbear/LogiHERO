const express = require('express');
const pool = require('../database/pool');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { ensureTourUuidOwned, requireOwnDriverName } = require('../utils/mobile-scope');

const currentTourRoutes = express.Router();

currentTourRoutes.post('/api/set-current-tour', requireDeviceAuth, async (req, res) => {
    const { driverName, tourUuid } = req.body;
    console.log(`[TRACE-TOUR] Endpoint: /api/set-current-tour | Driver: ${driverName} | TourUUID: ${tourUuid}`);
    try {
        const denied = requireOwnDriverName(req, res, driverName);
        if (denied) return denied;
        if (tourUuid && !(await ensureTourUuidOwned(pool, req, tourUuid))) return res.status(403).json({ error: 'TOUR_SCOPE_DENIED' });
        await pool.query('SELECT set_current_tour($1, $2)', [req.deviceAuth.driverName, tourUuid]);
        res.sendStatus(200);
    } catch (e) {
        console.error(`[TRACE-TOUR] Error in set-current-tour: ${e.message}`);
        res.status(500).json({ error: 'CURRENT_TOUR_UPDATE_FAILED' });
    }
});

module.exports = currentTourRoutes;
