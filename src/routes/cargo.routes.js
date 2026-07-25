const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const ndp = require('../integrations/ndp-client');

const cargoRoutes = express.Router();

function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSerial(sn) {
    if (!sn) return null;
    return String(sn).trim().toUpperCase().replace(/[-\s]/g, '');
}

async function checkSerial(client, tourId, serialNumber) {
    const norm = normalizeSerial(serialNumber);
    if (!norm) return null;

    // Check same tour (blocking)
    const sameTour = await client.query(
        `SELECT id FROM cargo WHERE tour_id = $1 AND deleted_at IS NULL
         AND UPPER(REPLACE(REPLACE(serial_number, '-', ''), ' ', '')) = $2`,
        [tourId, norm]
    );
    if (sameTour.rowCount > 0) throw new Error('DUPLICATE_SERIAL_IN_TOUR');

    // Check other tours (warning)
    const others = await client.query(
        `SELECT c.id, t.name as tour_name, t.date, c.status
         FROM cargo c
         JOIN tours t ON c.tour_id = t.id
         WHERE c.tour_id != $1 AND c.deleted_at IS NULL
         AND UPPER(REPLACE(REPLACE(c.serial_number, '-', ''), ' ', '')) = $2
         LIMIT 1`,
        [tourId, norm]
    );
    return others.rows[0] || null;
}

async function validateStopLinkage(client, tourId, pickupId, deliveryId) {
    if (!pickupId && !deliveryId) return;
    const stops = await client.query(
        'SELECT id, tour_id, order_index FROM stops WHERE id IN ($1, $2) AND deleted_at IS NULL',
        [pickupId || -1, deliveryId || -1]
    );
    const pickup = stops.rows.find(s => String(s.id) === String(pickupId));
    const delivery = stops.rows.find(s => String(s.id) === String(deliveryId));

    if (pickupId && !pickup) throw new Error('PICKUP_STOP_NOT_FOUND_IN_TOUR');
    if (deliveryId && !delivery) throw new Error('DELIVERY_STOP_NOT_FOUND_IN_TOUR');

    if (pickup && String(pickup.tour_id) !== String(tourId)) throw new Error('PICKUP_STOP_MISMATCH');
    if (delivery && String(delivery.tour_id) !== String(tourId)) throw new Error('DELIVERY_STOP_MISMATCH');

    if (pickup && delivery && delivery.order_index < pickup.order_index) {
        throw new Error('DELIVERY_BEFORE_PICKUP');
    }
}

// GET /api/tours/:tourId/cargo
cargoRoutes.get('/api/tours/:tourId/cargo', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM cargo WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
            [req.params.tourId]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/tours/:tourId/cargo
cargoRoutes.post('/api/tours/:tourId/cargo', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { tourId } = req.params;
        const b = req.body;
        const now = Date.now();

        await client.query('BEGIN');
        await validateStopLinkage(client, tourId, b.pickup_stop_id, b.delivery_stop_id);
        const globalDup = await checkSerial(client, tourId, b.serial_number);

        const result = await client.query(
            `INSERT INTO cargo (
                tour_id, pickup_stop_id, delivery_stop_id, type, name, description,
                quantity, unit, serial_number, external_reference, customer_reference,
                weight_kg, length_cm, width_cm, height_cm, status, notes, driver_name,
                updated_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
            RETURNING *`,
            [
                tourId, b.pickup_stop_id, b.delivery_stop_id, b.type || 'MACHINE', b.name, b.description,
                b.quantity || 1, b.unit || 'pcs', b.serial_number, b.external_reference, b.customer_reference,
                numberOrNull(b.weight_kg), numberOrNull(b.length_cm), numberOrNull(b.width_cm), numberOrNull(b.height_cm),
                b.status || 'PLANNED', b.notes, b.driver_name, now
            ]
        );

        const cargo = result.rows[0];
        await client.query(
            'INSERT INTO cargo_events (cargo_id, event_type, to_status, timestamp, actor_type) VALUES ($1, $2, $3, $4, $5)',
            [cargo.id, 'CREATED', cargo.status, now, 'ADMIN']
        );

        await client.query('COMMIT');
        await ndp.trackEvent({
            traceId: ndp.getTraceId(req),
            eventType: 'cargo_created',
            title: 'Cargo created',
            component: 'cargo',
            payload: { tourId, cargoId: String(cargo.id), type: cargo.type, globalDup: !!globalDup }
        });

        res.status(201).json({ ...cargo, warning: globalDup ? 'SERIAL_EXISTS_ELSEWHERE' : null, previousCargo: globalDup });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(e.message.includes('DUPLICATE') ? 409 : 400).json({ error: e.message });
    } finally {
        client.release();
    }
});

// GET /api/cargo/:cargoId
cargoRoutes.get('/api/cargo/:cargoId', async (req, res) => {
    try {
        const cargo = await pool.query('SELECT * FROM cargo WHERE id = $1 AND deleted_at IS NULL', [req.params.cargoId]);
        if (cargo.rowCount === 0) return res.sendStatus(404);
        const events = await pool.query('SELECT * FROM cargo_events WHERE cargo_id = $1 ORDER BY timestamp ASC', [req.params.cargoId]);
        res.json({ ...cargo.rows[0], events: events.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

cargoRoutes.get('/api/check-serial', requireAdmin, async (req, res) => {
    const { sn, tourId } = req.query;
    if (!sn) return res.status(400).send('Serial number required');
    try {
        const others = await checkSerial(pool, tourId || -1, sn);
        res.json({ exists: !!others, ...others });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// PATCH /api/cargo/:cargoId
cargoRoutes.patch('/api/cargo/:cargoId', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { cargoId } = req.params;
        const b = req.body;
        const now = Date.now();

        await client.query('BEGIN');
        const existingRes = await client.query('SELECT * FROM cargo WHERE id = $1 AND deleted_at IS NULL', [cargoId]);
        if (existingRes.rowCount === 0) throw new Error('CARGO_NOT_FOUND');
        const existing = existingRes.rows[0];

        if (b.pickup_stop_id || b.delivery_stop_id) {
            await validateStopLinkage(client, existing.tour_id, b.pickup_stop_id || existing.pickup_stop_id, b.delivery_stop_id || existing.delivery_stop_id);
        }

        if (b.serial_number && normalizeSerial(b.serial_number) !== normalizeSerial(existing.serial_number)) {
            await checkSerial(client, existing.tour_id, b.serial_number);
        }

        // Terminal status protection
        if (['DELIVERED', 'CANCELLED', 'REJECTED', 'MISSING'].includes(existing.status) && !b.override_reason) {
            throw new Error('STATUS_LOCKED_OVERRIDE_REQUIRED');
        }

        const result = await client.query(
            `UPDATE cargo SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                type = COALESCE($3, type),
                quantity = COALESCE($4, quantity),
                unit = COALESCE($5, unit),
                serial_number = COALESCE($6, serial_number),
                external_reference = COALESCE($7, external_reference),
                customer_reference = COALESCE($8, customer_reference),
                weight_kg = COALESCE($9, weight_kg),
                length_cm = COALESCE($10, length_cm),
                width_cm = COALESCE($11, width_cm),
                height_cm = COALESCE($12, height_cm),
                status = COALESCE($13, status),
                notes = COALESCE($14, notes),
                pickup_stop_id = COALESCE($15, pickup_stop_id),
                delivery_stop_id = COALESCE($16, delivery_stop_id),
                updated_at = $17
            WHERE id = $18 RETURNING *`,
            [
                b.name, b.description, b.type, b.quantity, b.unit, b.serial_number,
                b.external_reference, b.customer_reference, numberOrNull(b.weight_kg),
                numberOrNull(b.length_cm), numberOrNull(b.width_cm), numberOrNull(b.height_cm),
                b.status, b.notes, b.pickup_stop_id, b.delivery_stop_id, now, cargoId
            ]
        );

        if (b.status && b.status !== existing.status) {
            await client.query(
                'INSERT INTO cargo_events (cargo_id, event_type, from_status, to_status, timestamp, reason, actor_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [cargoId, b.override_reason ? 'STATUS_OVERRIDDEN' : 'UPDATED', existing.status, b.status, now, b.override_reason, 'ADMIN']
            );
            if (b.override_reason) {
                await ndp.trackEvent({
                    traceId: ndp.getTraceId(req),
                    eventType: 'cargo_status_overridden',
                    title: 'Cargo status overridden',
                    component: 'cargo',
                    payload: { cargoId, from: existing.status, to: b.status, reason: b.override_reason }
                });
            }
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(e.message.includes('NOT_FOUND') ? 404 : 400).json({ error: e.message });
    } finally {
        client.release();
    }
});

// DELETE /api/cargo/:cargoId
cargoRoutes.delete('/api/cargo/:cargoId', requireAdmin, async (req, res) => {
    try {
        const { cargoId } = req.params;
        const now = Date.now();
        const existing = await pool.query('SELECT status FROM cargo WHERE id = $1 AND deleted_at IS NULL', [cargoId]);
        if (existing.rowCount === 0) return res.sendStatus(404);

        const nonDeletable = ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DAMAGED', 'MISSING', 'REJECTED'];
        if (nonDeletable.includes(existing.rows[0].status)) {
            return res.status(409).json({ error: 'CARGO_ALREADY_IN_TRANSIT', message: `Cargo in status ${existing.rows[0].status} cannot be deleted` });
        }

        await pool.query('UPDATE cargo SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, cargoId]);
        await pool.query('INSERT INTO cargo_events (cargo_id, event_type, timestamp, actor_type) VALUES ($1, $2, $3, $4)', [cargoId, 'DELETED', now, 'ADMIN']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper for status transitions
async function transitionCargo(req, res, eventType, fromStatuses, toStatus) {
    const client = await pool.connect();
    try {
        const { cargoId } = req.params;
        const { stopId, reason, condition, metadata, driverName, clientEventId } = req.body;
        const now = Date.now();

        await client.query('BEGIN');
        if (clientEventId) {
            const dup = await client.query('SELECT cargo_id FROM cargo_events WHERE client_event_id = $1', [clientEventId]);
            if (dup.rowCount > 0) {
                const cargo = await client.query('SELECT * FROM cargo WHERE id = $1', [cargoId]);
                await client.query('ROLLBACK');
                return res.json(cargo.rows[0]);
            }
        }

        const cargoRes = await client.query('SELECT status, tour_id FROM cargo WHERE id = $1 AND deleted_at IS NULL', [cargoId]);
        if (cargoRes.rowCount === 0) throw new Error('CARGO_NOT_FOUND');
        const cargo = cargoRes.rows[0];

        if (!fromStatuses.includes(cargo.status)) {
            throw new Error(`INVALID_TRANSITION_${cargo.status}_TO_${toStatus}`);
        }

        const result = await client.query(
            `UPDATE cargo SET status = $1,
             condition_at_pickup = CASE WHEN $2 = 'PICKED_UP' THEN $3 ELSE condition_at_pickup END,
             condition_at_delivery = CASE WHEN $2 = 'DELIVERED' THEN $3 ELSE condition_at_delivery END,
             updated_at = $4 WHERE id = $5 RETURNING *`,
            [toStatus, eventType, condition, now, cargoId]
        );

        await client.query(
            `INSERT INTO cargo_events (cargo_id, event_type, from_status, to_status, actor_type, actor_id, stop_id, timestamp, reason, metadata, client_event_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [cargoId, eventType, cargo.status, toStatus, 'DRIVER', driverName, stopId, now, reason, metadata, clientEventId]
        );

        await client.query('COMMIT');
        await ndp.trackEvent({
            traceId: ndp.getTraceId(req),
            eventType: eventType.toLowerCase(),
            title: `Cargo ${eventType.toLowerCase()}`,
            component: 'cargo',
            payload: { cargoId: String(cargoId), tourId: String(cargo.tour_id), stopId: String(stopId) }
        });

        res.json(result.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
}

cargoRoutes.post('/api/cargo/:cargoId/pickup', async (req, res) => {
    await transitionCargo(req, res, 'PICKED_UP', ['PLANNED', 'READY_FOR_PICKUP'], 'PICKED_UP');
});

cargoRoutes.post('/api/cargo/:cargoId/deliver', async (req, res) => {
    await transitionCargo(req, res, 'DELIVERED', ['PICKED_UP', 'IN_TRANSIT'], 'DELIVERED');
});

cargoRoutes.post('/api/cargo/:cargoId/report-damage', async (req, res) => {
    await transitionCargo(req, res, 'DAMAGED_REPORTED', ['PICKED_UP', 'IN_TRANSIT', 'PLANNED', 'READY_FOR_PICKUP'], 'DAMAGED');
});

cargoRoutes.post('/api/cargo/:cargoId/report-missing', async (req, res) => {
    await transitionCargo(req, res, 'MISSING_REPORTED', ['PICKED_UP', 'IN_TRANSIT', 'PLANNED', 'READY_FOR_PICKUP'], 'MISSING');
});

// Admin Resolution
cargoRoutes.post('/api/cargo/:cargoId/resolve', requireAdmin, async (req, res) => {
    const { cargoId } = req.params;
    const { status, reason } = req.body;
    if (!status || !reason) return res.status(400).json({ error: 'STATUS_AND_REASON_REQUIRED' });
    try {
        const now = Date.now();
        const existing = await pool.query('SELECT status FROM cargo WHERE id = $1 AND deleted_at IS NULL', [cargoId]);
        if (existing.rowCount === 0) return res.sendStatus(404);

        await pool.query('UPDATE cargo SET status = $1, updated_at = $2 WHERE id = $3', [status, now, cargoId]);
        await pool.query('INSERT INTO cargo_events (cargo_id, event_type, from_status, to_status, timestamp, reason, actor_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [cargoId, 'RESOLVED', existing.rows[0].status, status, now, reason, 'ADMIN']);

        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = cargoRoutes;
