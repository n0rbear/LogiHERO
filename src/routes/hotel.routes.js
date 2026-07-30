const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAdminWrite } = require('../middleware/requireAdmin');
const HotelEngine = require('../engines/hotel-engine');
const ndp = require('../integrations/ndp-client');

const hotelManagementRoutes = express.Router();
const hotelReadRoutes = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_HOTEL_STATUSES = new Set(['PLANNED', 'BOOKED', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'PROBLEM']);
const textOrNull = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const numberOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

function sanitizeHotel(body) {
    const lat = numberOrNull(body.latitude);
    const lng = numberOrNull(body.longitude);
    return {
        tourId: body.tourId || body.tour_id || null,
        stopId: body.stopId || body.stop_id || null,
        driverId: body.driverId || body.driver_id || null,
        driverName: body.driverName || body.driver_name || null,
        name: textOrNull(body.name) || '',
        addressLine1: textOrNull(body.addressLine1 || body.address_line_1 || body.address) || '',
        addressLine2: body.addressLine2 || body.address_line_2 || null,
        postalCode: body.postalCode || body.postal_code || null,
        city: body.city || '',
        country: body.country || null,
        latitude: lat !== null && lng !== null && HotelEngine.isValidCoordinate(lat, lng) ? lat : null,
        longitude: lat !== null && lng !== null && HotelEngine.isValidCoordinate(lat, lng) ? lng : null,
        phone: body.phone || body.phoneNumber || body.phone_number || null,
        bookingNumber: body.bookingNumber || body.booking_number || '',
        bookingProvider: body.bookingProvider || body.booking_provider || null,
        checkInDate: body.checkInDate || body.check_in_date || null,
        checkInTime: body.checkInTime || body.check_in_time || null,
        checkOutDate: body.checkOutDate || body.check_out_date || null,
        checkOutTime: body.checkOutTime || body.check_out_time || null,
        numberOfNights: body.numberOfNights || body.number_of_nights || null,
        numberOfRooms: body.numberOfRooms || body.number_of_rooms || null,
        status: VALID_HOTEL_STATUSES.has(body.status) ? body.status : HotelEngine.HOTEL_STATUSES.PLANNED,
        notes: body.notes || null,
        streetViewUrl: body.streetViewUrl || body.street_view_url || null,
        externalMapUrl: body.externalMapUrl || body.external_map_url || null,
        contactName: body.contactName || body.contact_name || null,
        email: body.email || null,
        reservationName: body.reservationName || body.reservation_name || null,
        breakfastIncluded: body.breakfastIncluded || body.breakfast_included || false,
        parkingIncluded: body.parkingIncluded || body.parking_included || false,
        lateCheckIn: body.lateCheckIn || body.late_check_in || false,
        roomType: body.roomType || body.room_type || null,
        roomNumber: body.roomNumber || body.room_number || null,
        entryCode: body.entryCode || body.entry_code || null
    };
}

// ==========================================
// TOUR-LINKED HOTEL ENDPOINTS
// ==========================================

hotelReadRoutes.get('/api/tours/:tourId/hotels', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM hotels WHERE tour_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
            [req.params.tourId]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.post('/api/tours/:tourId/hotels', requireAdmin, async (req, res) => {
    const h = sanitizeHotel(req.body);
    const now = Date.now();
    try {
        const result = await pool.query(
            `INSERT INTO hotels (uuid, tour_id, stop_id, driver_id, driver_name, name, address_line_1, address_line_2, postal_code, city, country, latitude, longitude, phone, booking_number, booking_provider, check_in_date, check_in_time, check_out_date, check_out_time, number_of_nights, number_of_rooms, status, notes, street_view_url, external_map_url, contact_name, email, reservation_name, breakfast_included, parking_included, late_check_in, room_type, room_number, entry_code, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $35)
             RETURNING *`,
            [req.params.tourId, h.stopId, h.driverId, h.driverName, h.name, h.addressLine1, h.addressLine2, h.postalCode, h.city, h.country, h.latitude, h.longitude, h.phone, h.bookingNumber, h.bookingProvider, h.checkInDate, h.checkInTime, h.checkOutDate, h.checkOutTime, h.numberOfNights, h.numberOfRooms, h.status, h.notes, h.streetViewUrl, h.externalMapUrl, h.contactName, h.email, h.reservationName, h.breakfastIncluded, h.parkingIncluded, h.lateCheckIn, h.roomType, h.roomNumber, h.entryCode, now]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelReadRoutes.get('/api/hotels/:hotelId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hotels WHERE id = $1', [req.params.hotelId]);
        if (!result.rows[0]) return res.sendStatus(404);
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.patch('/api/hotels/:hotelId', requireAdmin, async (req, res) => {
    const h = sanitizeHotel(req.body);
    try {
        const result = await pool.query(
            `UPDATE hotels SET
                stop_id = COALESCE($1, stop_id), driver_id = COALESCE($2, driver_id), driver_name = COALESCE($3, driver_name),
                name = COALESCE($4, name), address_line_1 = COALESCE($5, address_line_1), address_line_2 = COALESCE($6, address_line_2),
                postal_code = COALESCE($7, postal_code), city = COALESCE($8, city), country = COALESCE($9, country),
                latitude = COALESCE($10, latitude), longitude = COALESCE($11, longitude), phone = COALESCE($12, phone),
                booking_number = COALESCE($13, booking_number), booking_provider = COALESCE($14, booking_provider),
                check_in_date = COALESCE($15, check_in_date), check_in_time = COALESCE($16, check_in_time),
                check_out_date = COALESCE($17, check_out_date), check_out_time = COALESCE($18, check_out_time),
                number_of_nights = COALESCE($19, number_of_nights), number_of_rooms = COALESCE($20, number_of_rooms),
                notes = COALESCE($21, notes), street_view_url = COALESCE($22, street_view_url),
                external_map_url = COALESCE($23, external_map_url), contact_name = COALESCE($24, contact_name),
                email = COALESCE($25, email), reservation_name = COALESCE($26, reservation_name),
                breakfast_included = COALESCE($27, breakfast_included), parking_included = COALESCE($28, parking_included),
                late_check_in = COALESCE($29, late_check_in), room_type = COALESCE($30, room_type),
                room_number = COALESCE($31, room_number), entry_code = COALESCE($32, entry_code),
                updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
             WHERE id = $33 RETURNING *`,
            [h.stopId, h.driverId, h.driverName, h.name, h.addressLine1, h.addressLine2, h.postalCode, h.city, h.country, h.latitude, h.longitude, h.phone, h.bookingNumber, h.bookingProvider, h.checkInDate, h.checkInTime, h.checkOutDate, h.checkOutTime, h.numberOfNights, h.numberOfRooms, h.notes, h.streetViewUrl, h.externalMapUrl, h.contactName, h.email, h.reservationName, h.breakfastIncluded, h.parkingIncluded, h.lateCheckIn, h.roomType, h.roomNumber, h.entryCode, req.params.hotelId]
        );
        if (!result.rows[0]) return res.sendStatus(404);
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelManagementRoutes.delete('/api/hotels/:hotelId', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE hotels SET deleted_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT WHERE id = $1 RETURNING id',
            [req.params.hotelId]
        );
        if (!result.rows[0]) return res.sendStatus(404);
        res.json({ success: true });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ==========================================
// STATUS TRANSITION ENDPOINTS
// ==========================================

async function handleStatusChange(req, res, status) {
    const { reason, clientEventId, isOverride } = req.body;
    try {
        const hotel = await HotelEngine.transitionHotelStatus(pool, req.params.hotelId, status, {
            actorType: req.user ? 'ADMIN' : 'DRIVER',
            actorId: req.user ? req.user.email : (req.body.driverName || 'unknown'),
            reason,
            clientEventId,
            isOverride
        });
        res.json(hotel);
    } catch (e) {
        if (e.message === 'HOTEL_NOT_FOUND') return res.sendStatus(404);
        if (['CANNOT_TRANSITION_FROM_TERMINAL_STATE', 'OVERRIDE_REASON_REQUIRED'].includes(e.message)) {
            return res.status(400).send(e.message);
        }
        res.status(500).send(e.message);
    }
}

hotelManagementRoutes.post('/api/hotels/:hotelId/confirm', async (req, res) => handleStatusChange(req, res, HotelEngine.HOTEL_STATUSES.CONFIRMED));
hotelManagementRoutes.post('/api/hotels/:hotelId/check-in', async (req, res) => handleStatusChange(req, res, HotelEngine.HOTEL_STATUSES.CHECKED_IN));
hotelManagementRoutes.post('/api/hotels/:hotelId/check-out', async (req, res) => handleStatusChange(req, res, HotelEngine.HOTEL_STATUSES.CHECKED_OUT));
hotelManagementRoutes.post('/api/hotels/:hotelId/cancel', async (req, res) => handleStatusChange(req, res, HotelEngine.HOTEL_STATUSES.CANCELLED));
hotelManagementRoutes.post('/api/hotels/:hotelId/report-problem', async (req, res) => handleStatusChange(req, res, HotelEngine.HOTEL_STATUSES.PROBLEM));

// ==========================================
// LEGACY & ADMIN ENDPOINTS (UPDATED)
// ==========================================

hotelManagementRoutes.post('/admin/save-hotel-record', requireAdmin, requireAdminWrite, async (req, res) => {
    const { source, id, uuid } = req.body;
    const h = sanitizeHotel(req.body);
    const now = Date.now();
    if (!h.name) return res.status(400).json({ error: 'A hotelnév kötelező.' });
    if (uuid && !UUID_RE.test(uuid)) return res.status(400).json({ error: 'Hibás hotel UUID.' });
    if (id && !Number.isFinite(Number(id))) return res.status(400).json({ error: 'Hibás hotel ID.' });
    try {
        if (source === 'stop') {
            const result = await pool.query(
                `UPDATE stops SET recipient=$1, address_full=$2, room_number=$3, entry_code=$4, booking_number=$5,
                    phone_number=$6, email=$7, notes=$8, latitude=$9, longitude=$10, stop_status=$11, stop_date=$12, updated_at=$13, sync_state='SYNCED', revision=COALESCE(revision,1)+1
                 WHERE ${uuid ? 'uuid::text = $14' : 'id = $14'}
                 RETURNING 'stop'::TEXT as source, id, uuid::TEXT, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address,
                    room_number, entry_code, booking_number, phone_number, email, notes, latitude, longitude, stop_status AS status, updated_at::BIGINT as timestamp`,
                [h.name, h.addressLine1, h.roomNumber, h.entryCode, h.bookingNumber, h.phone, h.email, h.notes, h.latitude, h.longitude, h.status, h.checkInDate, now, uuid || id]
            );
            if (!result.rows[0]) return res.status(404).json({ error: 'Hotel stop nem található.' });
            return res.json({ ...result.rows[0], timestamp: Number(result.rows[0].timestamp || now) });
        }

        if (id || uuid) {
            const result = await pool.query(
                `UPDATE hotels SET name=$1, driver_name=$2, address_line_1=$3, city=$4, latitude=$5, longitude=$6,
                    room_number=$7, entry_code=$8, booking_number=$9, phone=$10, email=$11, notes=$12,
                    check_in_date=$13, check_out_date=$14, status=$15, updated_at=$16, sync_state='SYNCED', revision=COALESCE(revision,1)+1
                 WHERE ${uuid ? 'uuid::text = $17' : 'id = $17'}
                 RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address_line_1 as address, room_number, entry_code,
                    booking_number, phone as phone_number, email, notes, latitude, longitude, status, updated_at as timestamp`,
                [h.name, h.driverName, h.addressLine1, h.city, h.latitude, h.longitude, h.roomNumber, h.entryCode, h.bookingNumber, h.phone, h.email, h.notes, h.checkInDate, h.checkOutDate, h.status, now, uuid || id]
            );
            if (!result.rows[0]) return res.status(404).json({ error: 'Hotel nem található.' });
            return res.json({ ...result.rows[0], timestamp: Number(result.rows[0].timestamp || now) });
        }

        const result = await pool.query(
            `INSERT INTO hotels (uuid, tour_id, driver_name, name, address_line_1, city, latitude, longitude, room_number,
                entry_code, booking_number, phone, email, notes, check_in_date, check_out_date, status, created_at, updated_at, sync_state, revision)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, 'SYNCED', 1)
             RETURNING 'hotel'::TEXT as source, id, uuid::TEXT, name, address_line_1 as address, room_number, entry_code,
                booking_number, phone as phone_number, email, notes, latitude, longitude, status, updated_at as timestamp`,
            [h.tourId, h.driverName, h.name, h.addressLine1, h.city, h.latitude, h.longitude, h.roomNumber, h.entryCode, h.bookingNumber, h.phone, h.email, h.notes, h.checkInDate, h.checkOutDate, h.status, now]
        );
        res.json({ ...result.rows[0], timestamp: Number(result.rows[0].timestamp || now) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

hotelManagementRoutes.post('/api/sync-hotels', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const h of (req.body || [])) {
            const driverName = h.driverName || h.driver_name;
            if (!driverName || !h.name) continue;

            const sanitized = sanitizeHotel(h);

            await client.query(`
                INSERT INTO hotels (
                    uuid, tour_id, stop_id, driver_id, driver_name, name, address_line_1, address_line_2, postal_code, city, country,
                    latitude, longitude, phone, booking_number, booking_provider, check_in_date, check_in_time, check_out_date, check_out_time,
                    number_of_nights, number_of_rooms, status, notes, street_view_url, external_map_url, contact_name, email, reservation_name,
                    breakfast_included, parking_included, late_check_in, room_type, room_number, entry_code, updated_at
                )
                VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
                ON CONFLICT (uuid) DO UPDATE SET
                    tour_id = EXCLUDED.tour_id,
                    stop_id = EXCLUDED.stop_id,
                    driver_name = EXCLUDED.driver_name,
                    name = EXCLUDED.name,
                    address_line_1 = EXCLUDED.address_line_1,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                WHERE hotels.updated_at IS NULL OR EXCLUDED.updated_at >= hotels.updated_at`,
                [
                    h.uuid || null, sanitized.tourId, sanitized.stopId, sanitized.driverId, sanitized.driverName, sanitized.name, sanitized.addressLine1, sanitized.addressLine2, sanitized.postalCode, sanitized.city, sanitized.country,
                    sanitized.latitude, sanitized.longitude, sanitized.phone, sanitized.bookingNumber, sanitized.bookingProvider, sanitized.checkInDate, sanitized.checkInTime, sanitized.checkOutDate, sanitized.checkOutTime,
                    sanitized.numberOfNights, sanitized.numberOfRooms, sanitized.status, sanitized.notes, sanitized.streetViewUrl, sanitized.externalMapUrl, sanitized.contactName, sanitized.email, sanitized.reservationName,
                    sanitized.breakfastIncluded, sanitized.parkingIncluded, sanitized.lateCheckIn, sanitized.roomType, sanitized.roomNumber, sanitized.entryCode, h.updated_at || Date.now()
                ]
            );
        }
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-HOTELS-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

hotelReadRoutes.get('/api/get-hotels/:driverName', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, driver_name::TEXT, name::TEXT, address_line_1::TEXT as address, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone::TEXT as phone_number, email::TEXT, notes::TEXT, updated_at::BIGINT as timestamp, status::TEXT
             FROM hotels
             WHERE driver_name = $1 AND deleted_at IS NULL
             UNION ALL
             SELECT 'stop'::TEXT as source, id::INT, uuid::TEXT, $1::TEXT as driver_name, COALESCE(recipient, address_full)::TEXT as name, address_full::TEXT as address, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone_number::TEXT, email::TEXT, notes::TEXT, COALESCE(arrival_time::BIGINT, (SELECT date::BIGINT FROM tours WHERE id = tour_id))::BIGINT as timestamp, stop_status::TEXT as status
             FROM stops
             WHERE tour_id IN (SELECT id FROM tours WHERE driver_name = $1 AND deleted_at IS NULL)
               AND deleted_at IS NULL AND stop_type = 'HOTEL'
             ORDER BY timestamp DESC`,
            [req.params.driverName]
        );
        res.json(result.rows.map(h => ({ ...h, timestamp: Number(h.timestamp || Date.now()) })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

hotelReadRoutes.get('/api/get-manual-hotels/:driverName', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 'hotel'::TEXT as source, id::INT, uuid::TEXT, driver_name::TEXT, name::TEXT, address_line_1::TEXT as address, room_number::TEXT, entry_code::TEXT, booking_number::TEXT, phone::TEXT as phone_number, email::TEXT, notes::TEXT, updated_at::BIGINT as timestamp, status::TEXT
             FROM hotels
             WHERE driver_name = $1 AND tour_id IS NULL AND deleted_at IS NULL
             ORDER BY updated_at DESC`,
            [req.params.driverName]
        );
        res.json(result.rows.map(h => ({ ...h, timestamp: Number(h.timestamp || Date.now()) })));
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = {
    hotelManagementRoutes,
    hotelReadRoutes
};
