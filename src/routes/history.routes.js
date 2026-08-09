const express = require('express');
const pool = require('../database/pool');
const { isAdminRequest, requireAdminOrDeviceAuth, requireOwnDriverName } = require('../utils/mobile-scope');

const historyRoutes = express.Router();

historyRoutes.get('/api/get-history/:driverName/:date', requireAdminOrDeviceAuth, async (req, res) => {
    try {
        const { driverName, date } = req.params;
        if (!isAdminRequest(req)) {
            const denied = requireOwnDriverName(req, res, driverName);
            if (denied) return denied;
        }
        const startOfDay = new Date(date).getTime();
        if (!Number.isFinite(startOfDay)) return res.status(400).json({ error: 'INVALID_DATE' });
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
        const result = await pool.query(
            'SELECT latitude, longitude, speed, timestamp FROM live_updates WHERE driver_name = $1 AND timestamp >= $2 AND timestamp < $3 ORDER BY timestamp ASC',
            [isAdminRequest(req) ? driverName : req.deviceAuth.driverName, startOfDay, endOfDay]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: 'HISTORY_READ_FAILED' }); }
});

module.exports = historyRoutes;
