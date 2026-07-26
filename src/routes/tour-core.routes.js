const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const ndp = require('../integrations/ndp-client');
const TourCore = require('../engines/tour-core-engine');

function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeStopPayload(body) {
    const addressFull = textOrNull(body.address_full) || textOrNull(body.addressFull) || [body.street, body.house_number || body.houseNumber, body.postal_code || body.postalCode, body.city, body.country].filter(Boolean).join(' ');
    return {
        uuid: textOrNull(body.uuid),
        recipient: textOrNull(body.recipient),
        company: textOrNull(body.company),
        address: addressFull || textOrNull(body.address),
        street: textOrNull(body.street),
        house_number: textOrNull(body.house_number || body.houseNumber),
        postal_code: textOrNull(body.postal_code || body.postalCode),
        city: textOrNull(body.city),
        country: textOrNull(body.country),
        address_full: addressFull || textOrNull(body.address),
        contact_name: textOrNull(body.contact_name || body.contactName),
        phone_number: textOrNull(body.phone_number || body.phoneNumber),
        time_window: textOrNull(body.time_window || body.timeWindow),
        stop_date: numberOrNull(body.stop_date || body.stopDate),
        notes: textOrNull(body.notes),
        order_index: Number.isInteger(Number(body.order_index ?? body.orderIndex)) ? Number(body.order_index ?? body.orderIndex) : null,
        latitude: numberOrNull(body.latitude),
        longitude: numberOrNull(body.longitude),
        stop_type: textOrNull(body.stop_type || body.stopType) || 'DELIVERY',
        stop_status: textOrNull(body.stop_status || body.stopStatus) || null
    };
}

async function getTourWithStops(client, id) {
    const tourRes = await client.query('SELECT * FROM tours WHERE id = $1 AND deleted_at IS NULL', [id]);
    const tour = tourRes.rows[0];
    if (!tour) return null;
    const stopsRes = await client.query('SELECT * FROM stops WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY order_index ASC, id ASC', [id]);
    const cargoRes = await client.query('SELECT * FROM cargo WHERE tour_id = $1 AND deleted_at IS NULL', [id]);
    return { tour, stops: stopsRes.rows.map(TourCore.normalizeStop), cargo: cargoRes.rows };
}

async function checkCargoBlocking(client, tourId, stopId = null) {
    const query = stopId
        ? `SELECT id, name, serial_number, status, pickup_stop_id, delivery_stop_id
           FROM cargo WHERE tour_id = $1 AND deleted_at IS NULL AND (pickup_stop_id = $2 OR delivery_stop_id = $2)`
        : `SELECT id, name, serial_number, status, pickup_stop_id, delivery_stop_id
           FROM cargo WHERE tour_id = $1 AND deleted_at IS NULL`;

    const res = await client.query(query, stopId ? [tourId, stopId] : [tourId]);
    const blocking = [];

    for (const c of res.rows) {
        if (stopId) {
            if (c.pickup_stop_id === stopId && ['PLANNED', 'READY_FOR_PICKUP'].includes(c.status)) {
                blocking.push({ ...c, requiredAction: 'PICKUP_REQUIRED' });
            } else if (c.delivery_stop_id === stopId && ['PICKED_UP', 'IN_TRANSIT'].includes(c.status)) {
                blocking.push({ ...c, requiredAction: 'DELIVERY_REQUIRED' });
            }
        } else {
            // General tour blocking
            if (['PLANNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DAMAGED', 'MISSING'].includes(c.status)) {
                blocking.push({ ...c, requiredAction: 'UNRESOLVED_CARGO' });
            }
        }
    }
    return blocking;
}

async function latestLocation(client, tour) {
    const location = await client.query(
        'SELECT latitude, longitude, speed, status, timestamp FROM live_updates WHERE driver_name = $1 ORDER BY timestamp DESC LIMIT 1',
        [tour.driver_name]
    );
    return location.rows[0] || null;
}

async function persistRoute(client, tourId, route) {
    await client.query(
        `UPDATE tours SET planned_distance_km=$1, planned_duration_seconds=$2, route_polyline=$3::jsonb,
         route_status=$4, route_error=$5, route_calculated_at=$6, updated_at=$6 WHERE id=$7`,
        [route.planned_distance_km, route.planned_duration_seconds, route.route_polyline, route.route_status, route.route_error, route.route_calculated_at, tourId]
    );
    for (const stop of route.stops) {
        await client.query(
            `UPDATE stops SET segment_distance_km=$1, segment_duration_seconds=$2,
             cumulative_distance_km=$3, cumulative_duration_seconds=$4, route_warning=$5 WHERE id=$6`,
            [stop.segment_distance_km, stop.segment_duration_seconds, stop.cumulative_distance_km, stop.cumulative_duration_seconds, route.warnings.join(','), stop.id]
        );
    }
}

async function refreshProgress(client, tourId, traceId) {
    const data = await getTourWithStops(client, tourId);
    if (!data) return null;
    const live = await latestLocation(client, data.tour);
    const progress = TourCore.calculateProgress(data.tour, data.stops, live);

    let newStatus = data.tour.tour_status;
    if (newStatus === 'PLANNED' && (data.stops.some(s => s.is_completed || s.stop_status === 'ARRIVED'))) {
        newStatus = 'IN_PROGRESS';
        if (traceId) {
            await ndp.trackEvent({
                traceId,
                eventType: 'tour_started',
                title: 'Tour started',
                component: 'backend',
                payload: { tourId: String(tourId) }
            });
        }
    } else if (newStatus === 'IN_PROGRESS' && data.stops.every(s => s.is_completed || s.stop_status === 'SKIPPED')) {
        const blockingCargo = await checkCargoBlocking(client, tourId);
        const { blocking: blockingHotels } = await HotelEngine.checkTourCompletionBlockedByHotels(client, tourId);

        if (blockingCargo.length === 0 && blockingHotels.length === 0) {
            newStatus = 'COMPLETED';
            if (traceId) {
                await ndp.trackEvent({
                    traceId,
                    eventType: 'tour_completed',
                    title: 'Tour completed',
                    component: 'backend',
                    payload: { tourId: String(tourId) }
                });
            }
        } else {
            console.log(`[TOUR] completion blocked for ${tourId} by ${blockingCargo.length} cargo items and ${blockingHotels.length} hotels`);
        }
    }

    await client.query(
        `UPDATE tours SET next_stop_id=$1, remaining_distance_km=$2, remaining_duration_seconds=$3,
         completed_distance_km=$4, last_driver_lat=COALESCE($5,last_driver_lat),
         last_driver_lng=COALESCE($6,last_driver_lng), last_driver_location_at=COALESCE($7,last_driver_location_at),
         tour_status=$8
         WHERE id=$9`,
        [
            progress.nextStop?.id || null,
            progress.remainingDistance,
            progress.remainingDuration,
            progress.completedDistance,
            live?.latitude || null,
            live?.longitude || null,
            live?.timestamp || null,
            newStatus,
            tourId
        ]
    );
    return { ...progress, status: newStatus };
}

async function recalculateTour(client, tourId, traceId, reason = 'manual') {
    const data = await getTourWithStops(client, tourId);
    if (!data) return null;
    const route = await TourCore.calculateTourRoute(data.tour, data.stops);
    await persistRoute(client, tourId, route);
    const progress = await refreshProgress(client, tourId, traceId);
    await ndp.trackEvent({
        traceId,
        eventType: route.route_status === 'OK' ? 'tour_route_calculated' : 'tour_route_calculation_failed',
        title: 'Tour route recalculated',
        component: 'route',
        payload: {
            tourId: String(tourId),
            reason,
            routeStatus: route.route_status,
            stopCount: String(data.stops.length),
            warnings: route.warnings.join(',')
        }
    });
    return { route, progress };
}

const HotelEngine = require('../engines/hotel-engine');
const tourCoreRoutes = express.Router();

tourCoreRoutes.get('/api/tours', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM tours
             WHERE deleted_at IS NULL
             ORDER BY id DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('[TOUR] list failed:', error.message);
        res.status(500).json({ error: 'Tour list failed.' });
    }
});

tourCoreRoutes.get('/api/tours/:id', async (req, res) => {
    try {
        const data = await getTourWithStops(pool, req.params.id);
        if (!data) return res.sendStatus(404);
        const progress = TourCore.calculateProgress(data.tour, data.stops, await latestLocation(pool, data.tour));
        const blockingCargo = await checkCargoBlocking(pool, req.params.id);
        res.json({ ...data, progress, blockingCargo });
    } catch (error) {
        res.status(500).json({ error: 'Tour read failed.' });
    }
});

tourCoreRoutes.post('/api/tours', requireAdmin, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const client = await pool.connect();
    try {
        const now = Date.now();
        const body = req.body || {};
        await client.query('BEGIN');
        const created = await client.query(
            `INSERT INTO tours (driver_name, name, customer, date, notes, is_closed, is_current, depot_name,
             depot_address_full, depot_lat, depot_lng, return_depot_name, return_depot_address_full,
             return_depot_lat, return_depot_lng, vehicle, trailer, planned_start_at, planned_end_at,
             tour_status, updated_at)
             VALUES ($1,$2,$3,$4,$5,false,false,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             RETURNING *`,
            [
                textOrNull(body.driver_name || body.driverName),
                textOrNull(body.name) || `Tura ${now}`,
                textOrNull(body.customer),
                numberOrNull(body.date) || now,
                textOrNull(body.notes),
                textOrNull(body.depot_name || body.depotName),
                textOrNull(body.depot_address_full || body.depotAddressFull),
                numberOrNull(body.depot_lat || body.depotLat),
                numberOrNull(body.depot_lng || body.depotLng),
                textOrNull(body.return_depot_name || body.returnDepotName),
                textOrNull(body.return_depot_address_full || body.returnDepotAddressFull),
                numberOrNull(body.return_depot_lat || body.returnDepotLat),
                numberOrNull(body.return_depot_lng || body.returnDepotLng),
                textOrNull(body.vehicle),
                textOrNull(body.trailer),
                numberOrNull(body.planned_start_at || body.plannedStartAt),
                numberOrNull(body.planned_end_at || body.plannedEndAt),
                textOrNull(body.tour_status || body.status) || 'PLANNED',
                now
            ]
        );
        await client.query('COMMIT');
        await ndp.trackEvent({ traceId, eventType: 'tour_created', title: 'Tour created', component: 'backend', payload: { tourId: String(created.rows[0].id) } });
        res.status(201).json(created.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Tour create failed.' });
    } finally {
        client.release();
    }
});

tourCoreRoutes.patch('/api/tours/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const now = Date.now();
        const body = req.body || {};
        await client.query('BEGIN');

        if (body.tour_status === 'COMPLETED' || body.status === 'COMPLETED' || body.is_closed) {
            const blockingCargo = await checkCargoBlocking(client, req.params.id);
            const { blocking: blockingHotels, warnings: hotelWarnings } = await HotelEngine.checkTourCompletionBlockedByHotels(client, req.params.id);

            if ((blockingCargo.length > 0 || blockingHotels.length > 0) && !body.override_reason) {
                await client.query('ROLLBACK');

                if (blockingHotels.length > 0) {
                    await ndp.trackEvent({
                        traceId: ndp.getTraceId(req),
                        eventType: 'tour_completion_blocked_by_hotel',
                        title: 'Tour completion blocked by hotel',
                        payload: { tourId: req.params.id, blockingCount: String(blockingHotels.length) }
                    });
                }

                return res.status(409).json({
                    error: 'TOUR_COMPLETION_BLOCKED',
                    message: 'Cannot close tour with unresolved items',
                    blockingCargo,
                    blockingHotels,
                    hotelWarnings
                });
            }
            if (body.override_reason) {
                await ndp.trackEvent({
                    traceId: ndp.getTraceId(req),
                    eventType: 'tour_completion_overridden',
                    title: 'Tour completion overridden',
                    payload: { tourId: req.params.id, reason: body.override_reason }
                });
            }
        }

        const updated = await client.query(
            `UPDATE tours SET name=COALESCE($1,name), driver_name=COALESCE($2,driver_name), vehicle=COALESCE($3,vehicle),
             trailer=COALESCE($4,trailer), notes=COALESCE($5,notes), tour_status=COALESCE($6,tour_status),
             planned_start_at=COALESCE($7,planned_start_at), planned_end_at=COALESCE($8,planned_end_at),
             is_closed=COALESCE($9,is_closed), updated_at=$10
             WHERE id=$11 AND deleted_at IS NULL RETURNING *`,
            [textOrNull(body.name), textOrNull(body.driver_name || body.driverName), textOrNull(body.vehicle), textOrNull(body.trailer), textOrNull(body.notes), textOrNull(body.tour_status || body.status), numberOrNull(body.planned_start_at || body.plannedStartAt), numberOrNull(body.planned_end_at || body.plannedEndAt), body.is_closed, now, req.params.id]
        );
        if (!updated.rows[0]) {
            await client.query('ROLLBACK');
            return res.sendStatus(404);
        }
        await client.query('COMMIT');
        await ndp.trackEvent({ traceId: ndp.getTraceId(req), eventType: 'tour_updated', title: 'Tour updated', component: 'backend', payload: { tourId: String(req.params.id) } });
        res.json(updated.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
});

tourCoreRoutes.get('/api/tours/:id/stops', async (req, res) => {
    const data = await getTourWithStops(pool, req.params.id);
    if (!data) return res.sendStatus(404);
    res.json(data.stops);
});

tourCoreRoutes.post('/api/tours/:id/stops', requireAdmin, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const payload = sanitizeStopPayload(req.body || {});
        const nextOrder = payload.order_index ?? Number((await client.query('SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM stops WHERE tour_id=$1 AND deleted_at IS NULL', [req.params.id])).rows[0].next);
        const inserted = await client.query(
            `INSERT INTO stops (tour_id, recipient, company, address, street, house_number, postal_code, city, country, address_full,
             contact_name, phone_number, time_window, stop_date, notes, order_index, latitude, longitude, stop_type, stop_status, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
            [req.params.id, payload.recipient, payload.company, payload.address, payload.street, payload.house_number, payload.postal_code, payload.city, payload.country, payload.address_full, payload.contact_name, payload.phone_number, payload.time_window, payload.stop_date, payload.notes, nextOrder, payload.latitude, payload.longitude, payload.stop_type, payload.stop_status || 'PENDING', Date.now()]
        );
        await recalculateTour(client, req.params.id, traceId, 'stop_created');
        await client.query('COMMIT');
        await ndp.trackEvent({ traceId, eventType: 'stop_created', title: 'Stop created', component: 'backend', payload: { tourId: String(req.params.id), stopId: String(inserted.rows[0].id) } });
        res.status(201).json(inserted.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Stop create failed.' });
    } finally {
        client.release();
    }
});

tourCoreRoutes.patch('/api/tours/:id/stops/:stopId', requireAdmin, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const client = await pool.connect();
    try {
        const payload = sanitizeStopPayload(req.body || {});
        await client.query('BEGIN');
        const updated = await client.query(
            `UPDATE stops SET recipient=COALESCE($1,recipient), company=COALESCE($2,company), address=COALESCE($3,address),
             street=COALESCE($4,street), house_number=COALESCE($5,house_number), postal_code=COALESCE($6,postal_code),
             city=COALESCE($7,city), country=COALESCE($8,country), address_full=COALESCE($9,address_full),
             contact_name=COALESCE($10,contact_name), phone_number=COALESCE($11,phone_number),
             time_window=COALESCE($12,time_window), stop_date=COALESCE($13,stop_date), notes=COALESCE($14,notes),
             latitude=COALESCE($15,latitude), longitude=COALESCE($16,longitude), stop_type=COALESCE($17,stop_type),
             stop_status=COALESCE($18,stop_status), updated_at=$19
             WHERE id=$20 AND tour_id=$21 AND deleted_at IS NULL RETURNING *`,
            [payload.recipient, payload.company, payload.address, payload.street, payload.house_number, payload.postal_code, payload.city, payload.country, payload.address_full, payload.contact_name, payload.phone_number, payload.time_window, payload.stop_date, payload.notes, payload.latitude, payload.longitude, payload.stop_type, payload.stop_status, Date.now(), req.params.stopId, req.params.id]
        );
        if (!updated.rows[0]) {
            await client.query('ROLLBACK');
            return res.sendStatus(404);
        }
        await recalculateTour(client, req.params.id, traceId, 'stop_updated');
        await client.query('COMMIT');
        await ndp.trackEvent({ traceId, eventType: 'stop_updated', title: 'Stop updated', component: 'backend', payload: { tourId: String(req.params.id), stopId: String(req.params.stopId) } });
        res.json(updated.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Stop update failed.' });
    } finally {
        client.release();
    }
});

tourCoreRoutes.delete('/api/tours/:id/stops/:stopId', requireAdmin, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const deleted = await client.query(
            `UPDATE stops SET deleted_at=$1, updated_at=$1 WHERE id=$2 AND tour_id=$3
             AND COALESCE(stop_status, CASE WHEN is_completed THEN 'COMPLETED' ELSE 'PENDING' END) NOT IN ('COMPLETED','SKIPPED')
             RETURNING id`,
            [Date.now(), req.params.stopId, req.params.id]
        );
        if (!deleted.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Closed stops cannot be deleted.' });
        }
        await recalculateTour(client, req.params.id, traceId, 'stop_deleted');
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Stop delete failed.' });
    } finally {
        client.release();
    }
});

tourCoreRoutes.post('/api/tours/:id/stops/reorder', requireAdmin, async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const orderedIds = Array.isArray(req.body?.orderedStopIds) ? req.body.orderedStopIds.map(Number).filter(Number.isFinite) : [];
    if (!orderedIds.length) return res.status(400).json({ error: 'orderedStopIds is required.' });
    const client = await pool.connect();
    try {
        const now = Date.now();
        await client.query('BEGIN');

        // Update indices first
        for (let index = 0; index < orderedIds.length; index += 1) {
            await client.query('UPDATE stops SET order_index=$1, updated_at=$2 WHERE id=$3 AND tour_id=$4 AND deleted_at IS NULL', [index, now, orderedIds[index], req.params.id]);
        }

        // Validate Cargo sequence
        const cargo = await client.query(
            `SELECT c.id, c.name, s1.order_index as pickup_idx, s2.order_index as delivery_idx
             FROM cargo c
             JOIN stops s1 ON c.pickup_stop_id = s1.id
             JOIN stops s2 ON c.delivery_stop_id = s2.id
             WHERE c.tour_id = $1 AND c.deleted_at IS NULL`,
            [req.params.id]
        );

        const conflicts = cargo.rows.filter(c => c.delivery_idx < c.pickup_idx);
        if (conflicts.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'STOP_REORDER_CARGO_CONFLICT',
                message: 'Stop order conflicts with cargo pickup/delivery sequence',
                conflicts
            });
        }

        await recalculateTour(client, req.params.id, traceId, 'stop_reordered');
        await client.query('COMMIT');
        await ndp.trackEvent({ traceId, eventType: 'stop_reordered', title: 'Stops reordered', component: 'backend', payload: { tourId: String(req.params.id), stopCount: String(orderedIds.length) } });
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
});

tourCoreRoutes.post('/api/tours/:id/recalculate-route', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await recalculateTour(client, req.params.id, ndp.getTraceId(req), 'manual');
        if (!result) {
            await client.query('ROLLBACK');
            return res.sendStatus(404);
        }
        await client.query('COMMIT');
        res.json(result);
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(502).json({ error: 'Route calculation failed.' });
    } finally {
        client.release();
    }
});

tourCoreRoutes.get('/api/tours/:id/route', async (req, res) => {
    const data = await getTourWithStops(pool, req.params.id);
    if (!data) return res.sendStatus(404);
    res.json({
        tourId: data.tour.id,
        status: data.tour.route_status,
        polyline: data.tour.route_polyline,
        plannedDistance: numberOrNull(data.tour.planned_distance_km),
        plannedDuration: numberOrNull(data.tour.planned_duration_seconds),
        calculatedAt: numberOrNull(data.tour.route_calculated_at),
        error: data.tour.route_error,
        stops: data.stops
    });
});

tourCoreRoutes.get('/api/tours/:id/progress', async (req, res) => {
    try {
        const data = await getTourWithStops(pool, req.params.id);
        if (!data) return res.sendStatus(404);
        const progress = TourCore.calculateProgress(data.tour, data.stops, await latestLocation(pool, data.tour));
        const blockingCargo = await checkCargoBlocking(pool, req.params.id);
        res.json({ ...progress, blockingCargo });
    } catch (error) {
        res.status(500).json({ error: 'Progress read failed.' });
    }
});

tourCoreRoutes.post('/api/tours/:id/location', async (req, res) => {
    const traceId = ndp.getTraceId(req);
    const data = await getTourWithStops(pool, req.params.id);
    if (!data) return res.sendStatus(404);
    if (textOrNull(req.body?.driverName) && req.body.driverName !== data.tour.driver_name) return res.sendStatus(403);
    const lat = numberOrNull(req.body?.latitude);
    const lng = numberOrNull(req.body?.longitude);
    if (lat === null || lng === null) return res.status(400).json({ error: 'latitude and longitude are required.' });
    const timestamp = numberOrNull(req.body?.timestamp) || Date.now();
    await pool.query(
        `INSERT INTO live_updates (driver_name, latitude, longitude, speed, status, current_tour, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [data.tour.driver_name, lat, lng, numberOrNull(req.body?.speed) || 0, textOrNull(req.body?.status) || 'Vezetes', data.tour.name, timestamp]
    );
    const progress = await refreshProgress(pool, req.params.id, traceId);
    await ndp.trackEvent({ traceId, eventType: 'driver_location_updated', title: 'Driver location updated', component: 'location', payload: { tourId: String(req.params.id), stale: String(progress?.locationStale || false) } });
    res.json(progress);
});

async function markStop(req, res, status) {
    const traceId = ndp.getTraceId(req);
    const now = Date.now();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (status === 'COMPLETED') {
            const blocking = await checkCargoBlocking(client, req.params.id, Number(req.params.stopId));
            if (blocking.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: 'STOP_COMPLETION_BLOCKED_BY_CARGO',
                    message: 'Pending cargo actions at this stop',
                    blockingCargo: blocking.map(c => ({
                        id: c.id, name: c.name, status: c.status, action: c.requiredAction,
                        serialMasked: c.serial_number ? c.serial_number.slice(0, 3) + '***' : null
                    }))
                });
            }
        }

        const result = await client.query(
            `UPDATE stops SET stop_status=$1, is_completed=$2, arrival_time=COALESCE(arrival_time,$3),
             actual_departure_time=CASE WHEN $1='COMPLETED' THEN $3 ELSE actual_departure_time END, updated_at=$3
             WHERE id=$4 AND tour_id=$5 AND deleted_at IS NULL RETURNING *`,
            [status, status === 'COMPLETED', now, req.params.stopId, req.params.id]
        );
        if (!result.rows[0]) {
            await client.query('ROLLBACK');
            return res.sendStatus(404);
        }
        const progress = await refreshProgress(client, req.params.id, traceId);
        await client.query('COMMIT');

        await ndp.trackEvent({ traceId, eventType: status === 'COMPLETED' ? 'stop_completed' : 'stop_arrived', title: `Stop ${status.toLowerCase()}`, component: 'backend', payload: { tourId: String(req.params.id), stopId: String(req.params.stopId) } });
        res.json({ stop: result.rows[0], progress });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
}

tourCoreRoutes.post('/api/tours/:id/stops/:stopId/arrive', async (req, res) => markStop(req, res, 'ARRIVED'));
tourCoreRoutes.post('/api/tours/:id/stops/:stopId/complete', async (req, res) => markStop(req, res, 'COMPLETED'));

const renderAdminLayout = require('../utils/admin-layout');

tourCoreRoutes.get('/admin/tours', requireAdmin, async (req, res) => {
    const styles = `
        main.tour-main { display: grid; grid-template-columns: 360px 1fr; gap: 24px; height: calc(100vh - 160px); }
        .tour-sidebar { overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
        #tour-map { height: 100%; min-height: 400px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
        .tour-item { background: white; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; cursor: pointer; transition: 0.2s; }
        .tour-item:hover { border-color: var(--color-sidebar-active); box-shadow: var(--shadow-md); }
        .tour-status-text { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
        .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .metric-item { background: #f8f9fa; padding: 12px; border-radius: 8px; border: 1px solid #eee; }
        .metric-label { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; }
        .metric-value { font-size: 16px; font-weight: 700; margin-top: 4px; }
    `;

    const content = `
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
        <main class="tour-main">
            <div class="tour-sidebar">
                <div class="card" style="padding:16px;">
                    <input type="text" id="tourSearch" placeholder="Túra v. szállítmány keresés..." oninput="searchTours()" style="width:100%;">
                </div>
                <div id="tours-list-container" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:12px;">Betöltés...</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:24px;">
                <div class="card" id="tour-details-card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:20px;">
                        <h3 id="tour-title" style="margin:0;">Válassz túrát</h3>
                        <div id="tour-cargo-summary"></div>
                    </div>
                    <div id="tour-metrics" class="metric-grid"></div>
                    <div id="tour-warnings"></div>
                    <p id="tour-next-stop" style="font-weight:600;"></p>
                </div>
                <div id="tour-map"></div>
                <div id="tour-stops-list"></div>
            </div>
        </main>
    `;

    const scripts = `
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('tour-map').setView([47.5, 19.04], 7);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' }).addTo(map);
            let layer = L.layerGroup().addTo(map);

            let allTours = [];
            async function loadTours() {
                try {
                    const r = await fetch('/api/tours');
                    allTours = await r.json();
                    renderTours(allTours);
                } catch(e) { console.error(e); }
            }

            function renderTours(tours) {
                const container = document.getElementById('tours-list-container');
                const isTestData = (name) => {
                    const n = (name || '').toLowerCase();
                    return n.includes('test') || n.includes('demo') || n.includes('qa') || n.includes('pilot') || n.includes('ismeretlen');
                };
                container.innerHTML = tours.map(t => \`
                    <div class="tour-item \${isTestData(t.name) || isTestData(t.driver_name) ? 'test-data-row' : ''}" onclick="openTour(\${t.id})">
                        <div style="font-weight:600;">\${esc(t.name)}</div>
                        <div class="tour-status-text">\${esc(t.driver_name || 'Nincs sofőr')} | \${esc(t.tour_status || 'PLANNED')}</div>
                    </div>
                \`).join('') || '<p style="text-align:center; color:var(--color-text-muted);">Nincs túra.</p>';
            }

            function searchTours() {
                const q = document.getElementById('tourSearch').value.toLowerCase();
                const filtered = allTours.filter(t => t.name.toLowerCase().includes(q) || (t.driver_name || '').toLowerCase().includes(q));
                renderTours(filtered);
            }

            const km = v => Number(v || 0).toFixed(1) + ' km';
            const min = s => Math.round(Number(s || 0) / 60) + ' perc';

            async function openTour(id) {
                document.getElementById('tour-details-card').style.display = 'block';
                const r = await fetch('/api/tours/' + id);
                const d = await r.json();
                const route = await (await fetch('/api/tours/' + id + '/route')).json();

                layer.clearLayers();
                document.getElementById('tour-title').textContent = d.tour.name;

                const p = d.progress || {};
                const cargo = d.cargo || [];

                document.getElementById('tour-cargo-summary').innerHTML = \`
                    <div style="display:flex; gap:8px;">
                        <span class="badge" style="background:#eee;">📦 \${cargo.length}</span>
                        <span class="badge" style="background:#e8f5e9; color:#2e7d32;">✅ \${cargo.filter(c => c.status === 'DELIVERED').length}</span>
                        <span class="badge" style="background:#ffebee; color:#c62828;">⚠️ \${cargo.filter(c => ['DAMAGED','MISSING','REJECTED'].includes(c.status)).length}</span>
                    </div>
                \`;

                let warnHtml = '';
                if (d.stops.some(s => !s.is_completed && (!s.latitude || !s.longitude || Math.abs(s.latitude) < 0.0001))) {
                    warnHtml += '<div style="color:var(--color-error); background:rgba(231,76,60,0.1); padding:8px; border-radius:4px; margin-bottom:8px; font-size:12px;">⚠️ <b>Hiányzó koordináta!</b> Az útvonal pontatlan lehet.</div>';
                }
                document.getElementById('tour-warnings').innerHTML = warnHtml;

                document.getElementById('tour-metrics').innerHTML = \`
                    <div class="metric-item"><div class="metric-label">Tervezett</div><div class="metric-value">\${km(p.plannedDistance)}</div></div>
                    <div class="metric-item"><div class="metric-label">Hátralévő</div><div class="metric-value">\${km(p.remainingDistance)}</div></div>
                    <div class="metric-item"><div class="metric-label">Következőig</div><div class="metric-value">\${km(p.distanceToNextStop)}</div></div>
                    <div class="metric-item"><div class="metric-label">Idő hátra</div><div class="metric-value">\${min(p.remainingDuration)}</div></div>
                \`;

                const ns = p.nextStop;
                document.getElementById('tour-next-stop').innerHTML = ns ? '📍 Következő: ' + esc(ns.recipient || ns.company || 'Megálló') : '🏁 Nincs több aktív megálló';

                const bounds = [];
                if (route.polyline && route.polyline.coordinates) {
                    const latlngs = route.polyline.coordinates.map(c => [c[1], c[0]]);
                    L.polyline(latlngs, { color: 'var(--color-brand)', weight: 5 }).addTo(layer);
                    bounds.push(...latlngs);
                }

                d.stops.forEach((s, i) => {
                    if (s.latitude && s.longitude && Math.abs(s.latitude) > 0.0001) {
                        const label = (s.stop_status === 'COMPLETED' ? '✓' : s.stop_status === 'PROBLEM' ? '!' : String(i + 1));
                        const icon = L.divIcon({ html: '<div style="background:#fff;border:2px solid var(--color-brand);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;">' + label + '</div>', iconSize: [24, 24] });
                        L.marker([s.latitude, s.longitude], { icon }).addTo(layer).bindPopup('<b>' + esc(s.recipient || s.company || 'Megálló') + '</b><br>' + esc(s.stop_status || 'PENDING'));
                        bounds.push([s.latitude, s.longitude]);
                    }
                });

                if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
            }

            loadTours();
        </script>
    `;

    res.send(renderAdminLayout({ title: 'Túrák', content, activeMenu: 'tours', styles, scripts, csrfToken: req.adminCsrfToken }));
});

module.exports = tourCoreRoutes;
