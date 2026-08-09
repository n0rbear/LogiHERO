const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { isAdminRequest, requireAdminOrDeviceAuth, requireOwnDriverName } = require('../utils/mobile-scope');

const fleetRoutes = express.Router();

fleetRoutes.get('/api/live-status/:name', requireAdminOrDeviceAuth, async (req, res) => {
    try {
        const name = req.params.name;
        if (!isAdminRequest(req)) {
            const denied = requireOwnDriverName(req, res, name);
            if (denied) return denied;
        }
        const updateRes = await pool.query(`
            SELECT lu.driver_name, lu.latitude, lu.longitude, lu.speed, lu.status, lu.current_tour, lu.next_stop,
                   lu.next_lat, lu.next_lng, lu.next_stop_dist, lu.next_stop_duration,
                   lu.tour_remaining_dist, lu.tour_remaining_duration, lu.depot_name, lu.depot_lat, lu.depot_lng,
                   lu.timestamp, lu.include_rests, lu.next_break_in_seconds,
                   d.photo_url as driver_photo, COALESCE(d.license_plate, lu.license_plate) as license_plate
            FROM live_updates lu
            LEFT JOIN drivers d ON d.name = lu.driver_name
            WHERE lu.driver_name = $1
            ORDER BY lu.timestamp DESC
            LIMIT 1
        `, [name]);

        const update = updateRes.rows[0] || {};

        const today = new Date().toISOString().split('T')[0];
        const work = (await pool.query('SELECT * FROM work_times WHERE driver_name = $1 AND date = $2', [name, today])).rows;
        const drivingTodaySec = work
            .filter(w => w.type === 'Vezetés')
            .reduce((sum, w) => sum + (Number(w.end_time || Date.now()) - Number(w.start_time)) / 1000, 0);

        res.json({ ...update, drivingTodaySec });
    } catch (e) { res.status(500).send(e.message); }
});

fleetRoutes.get('/api/fleet-status', requireAdmin, async (req, res) => {
    try {
        const drivers = await pool.query(`
            SELECT DISTINCT ON (all_drivers.driver_name)
                all_drivers.driver_name,
                d.photo_url as driver_photo,
                all_drivers.status,
                COALESCE(d.license_plate, all_drivers.license_plate) as license_plate,
                all_drivers.timestamp
            FROM (
                SELECT driver_name, status, license_plate, timestamp::BIGINT, 1 as source_rank FROM live_updates
                UNION ALL
                SELECT driver_name, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp, 2 as source_rank FROM tours WHERE deleted_at IS NULL
                UNION ALL
                SELECT name as driver_name, 'Új sofőr' as status, license_plate, COALESCE(profile_updated_at, created_at, 0)::BIGINT as timestamp, 3 as source_rank FROM drivers WHERE is_active = true
            ) AS all_drivers
            LEFT JOIN drivers d ON d.name = all_drivers.driver_name
            ORDER BY all_drivers.driver_name, all_drivers.source_rank ASC, all_drivers.timestamp DESC
        `);
        res.json(drivers.rows);
    } catch (e) { res.status(500).send(e.message); }
});

module.exports = fleetRoutes;
