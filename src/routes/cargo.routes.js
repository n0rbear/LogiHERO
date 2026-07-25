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

        // Validation: pickup and delivery stop same tour
        if (b.pickup_stop_id || b.delivery_stop_id) {
            const stops = await client.query(
                'SELECT id, tour_id, order_index FROM stops WHERE id IN ($1, $2)',
                [b.pickup_stop_id || -1, b.delivery_stop_id || -1]
            );
            for (const s of stops.rows) {
                if (String(s.tour_id) !== String(tourId)) {
                    throw new Error('Stop does not belong to this tour');
                }
            }
            const pickup = stops.rows.find(s => s.id === b.pickup_stop_id);
            const delivery = stops.rows.find(s => s.id === b.delivery_stop_id);
            if (pickup && delivery && delivery.order_index < pickup.order_index) {
                throw new Error('Delivery stop cannot be before pickup stop');
            }
        }

        // Duplicate serial number in tour check
        if (b.serial_number) {
            const dup = await client.query(
                'SELECT id FROM cargo WHERE tour_id = $1 AND serial_number = $2 AND deleted_at IS NULL',
                [tourId, b.serial_number]
            );
            if (dup.rowCount > 0) {
                throw new Error('Duplicate serial number in this tour');
            }
        }

        const result = await client.query(
            `INSERT INTO cargo (
                tour_id, pickup_stop_id, delivery_stop_id, type, name, description,
                quantity, unit, serial_number, external_reference, customer_reference,
                weight_kg, length_cm, width_cm, height_cm, status, notes, driver_name,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
            'INSERT INTO cargo_events (cargo_id, event_type, to_status, timestamp) VALUES ($1, $2, $3, $4)',
            [cargo.id, 'CREATED', cargo.status, now]
        );

        await client.query('COMMIT');

        await ndp.trackEvent({
            traceId: ndp.getTraceId(req),
            eventType: 'cargo_created',
            title: 'Cargo created',
            component: 'cargo',
            payload: { tourId, cargoId: String(cargo.id), type: cargo.type }
        });

        res.status(201).json(cargo);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
});

// GET /api/cargo/:cargoId
cargoRoutes.get('/api/cargo/:cargoId', async (req, res) => {
    try {
        const cargo = await pool.query('SELECT * FROM cargo WHERE id = $1', [req.params.cargoId]);
        if (cargo.rowCount === 0) return res.sendStatus(404);
        const events = await pool.query('SELECT * FROM cargo_events WHERE cargo_id = $1 ORDER BY timestamp ASC', [req.params.cargoId]);
        res.json({ ...cargo.rows[0], events: events.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
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
        const existingRes = await client.query('SELECT * FROM cargo WHERE id = $1', [cargoId]);
        if (existingRes.rowCount === 0) throw new Error('Cargo not found');
        const existing = existingRes.rows[0];

        // Terminal status protection
        if (['DELIVERED', 'CANCELLED'].includes(existing.status) && !b.override_reason) {
            throw new Error('Cannot modify cargo in terminal status without override reason');
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
                'INSERT INTO cargo_events (cargo_id, event_type, from_status, to_status, timestamp, reason) VALUES ($1, $2, $3, $4, $5, $6)',
                [cargoId, b.override_reason ? 'STATUS_OVERRIDDEN' : 'UPDATED', existing.status, b.status, now, b.override_reason]
            );
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
});

// DELETE /api/cargo/:cargoId
cargoRoutes.delete('/api/cargo/:cargoId', requireAdmin, async (req, res) => {
    try {
        const { cargoId } = req.params;
        const now = Date.now();
        const existing = await pool.query('SELECT status FROM cargo WHERE id = $1', [cargoId]);
        if (existing.rowCount === 0) return res.sendStatus(404);
        if (existing.rows[0].status !== 'PLANNED' && existing.rows[0].status !== 'READY_FOR_PICKUP') {
            return res.status(400).json({ error: 'Cannot delete cargo that is already picked up or cancelled' });
        }
        await pool.query('UPDATE cargo SET deleted_at = $1, updated_at = $1 WHERE id = $2', [now, cargoId]);
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
        const { stopId, reason, condition, metadata, driverName } = req.body;
        const now = Date.now();

        await client.query('BEGIN');
        const cargoRes = await client.query('SELECT status, tour_id FROM cargo WHERE id = $1', [cargoId]);
        if (cargoRes.rowCount === 0) throw new Error('Cargo not found');
        const cargo = cargoRes.rows[0];

        if (!fromStatuses.includes(cargo.status)) {
            throw new Error(`Invalid transition from ${cargo.status} to ${toStatus}`);
        }

        const updateQuery = eventType === 'PICKED_UP'
            ? 'UPDATE cargo SET status = $1, condition_at_pickup = $2, updated_at = $3 WHERE id = $4 RETURNING *'
            : 'UPDATE cargo SET status = $1, condition_at_delivery = $2, updated_at = $3 WHERE id = $4 RETURNING *';

        const result = await client.query(updateQuery, [toStatus, condition, now, cargoId]);

        await client.query(
            `INSERT INTO cargo_events (cargo_id, event_type, from_status, to_status, actor_type, actor_id, stop_id, timestamp, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [cargoId, eventType, cargo.status, toStatus, 'DRIVER', driverName, stopId, now, reason, metadata]
        );

        await client.query('COMMIT');

        await ndp.trackEvent({
            traceId: ndp.getTraceId(req),
            eventType: eventType.toLowerCase(),
            title: `Cargo ${eventType.toLowerCase().replace('_', ' ')}`,
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
    await transitionCargo(req, res, 'DAMAGED_REPORTED', ['PICKED_UP', 'IN_TRANSIT'], 'DAMAGED');
});

cargoRoutes.post('/api/cargo/:cargoId/report-missing', async (req, res) => {
    await transitionCargo(req, res, 'MISSING_REPORTED', ['PICKED_UP', 'IN_TRANSIT'], 'MISSING');
});

module.exports = cargoRoutes;
