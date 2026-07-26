const pool = require('../database/pool');
const ndp = require('../integrations/ndp-client');

const HOTEL_STATUSES = {
    PLANNED: 'PLANNED',
    BOOKED: 'BOOKED',
    CONFIRMED: 'CONFIRMED',
    CHECKED_IN: 'CHECKED_IN',
    CHECKED_OUT: 'CHECKED_OUT',
    CANCELLED: 'CANCELLED',
    PROBLEM: 'PROBLEM'
};

const TERMINAL_STATUSES = new Set([HOTEL_STATUSES.CHECKED_OUT, HOTEL_STATUSES.CANCELLED]);

function toNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (Math.abs(parsed) < 0.000001) return null; // Invalid 0/0.0
    return parsed;
}

function isValidCoordinate(lat, lng) {
    return toNumber(lat) !== null && toNumber(lng) !== null;
}

async function logHotelEvent(client, { hotelId, eventType, fromStatus, toStatus, actorType, actorId, reason, clientEventId, metadata }) {
    try {
        await client.query(
            `INSERT INTO hotel_events (hotel_id, event_type, from_status, to_status, actor_type, actor_id, reason, client_event_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (client_event_id) DO NOTHING`,
            [hotelId, eventType, fromStatus, toStatus, actorType, actorId, reason, clientEventId, metadata ? JSON.stringify(metadata) : null]
        );
    } catch (e) {
        console.error(`[HOTEL-EVENT-LOG-ERROR] ${e.message}`);
    }
}

async function transitionHotelStatus(client, hotelId, toStatus, { actorType, actorId, reason, clientEventId, isOverride = false }) {
    const hotelRes = await client.query('SELECT status, tour_id FROM hotels WHERE id = $1', [hotelId]);
    const hotel = hotelRes.rows[0];
    if (!hotel) throw new Error('HOTEL_NOT_FOUND');

    const fromStatus = hotel.status;
    if (fromStatus === toStatus) return hotel;

    // Terminal state protection
    if (TERMINAL_STATUSES.has(fromStatus) && !isOverride) {
        throw new Error('CANNOT_TRANSITION_FROM_TERMINAL_STATE');
    }

    if (isOverride && !reason) {
        throw new Error('OVERRIDE_REASON_REQUIRED');
    }

    const updated = await client.query(
        'UPDATE hotels SET status = $1, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT WHERE id = $2 RETURNING *',
        [toStatus, hotelId]
    );

    await logHotelEvent(client, {
        hotelId,
        eventType: isOverride ? 'STATUS_OVERRIDDEN' : toStatus,
        fromStatus,
        toStatus,
        actorType,
        actorId,
        reason,
        clientEventId,
        metadata: { isOverride }
    });

    // NDP tracking (PII-free)
    await ndp.trackEvent({
        traceId: clientEventId || `hotel-status-${hotelId}-${Date.now()}`,
        eventType: `hotel_${toStatus.toLowerCase()}`,
        title: `Hotel status changed to ${toStatus}`,
        component: 'hotel',
        payload: {
            hotelId: String(hotelId),
            tourId: String(hotel.tour_id),
            fromStatus,
            toStatus,
            isOverride
        }
    });

    return updated.rows[0];
}

async function checkTourCompletionBlockedByHotels(client, tourId) {
    const hotels = await client.query(
        `SELECT id, name, status FROM hotels WHERE tour_id = $1 AND deleted_at IS NULL`,
        [tourId]
    );

    const blocking = [];
    const warnings = [];

    for (const h of hotels.rows) {
        if (h.status === HOTEL_STATUSES.CHECKED_IN) {
            blocking.push({ ...h, reason: 'CHECKED_IN_WITHOUT_CHECK_OUT' });
        } else if (h.status === HOTEL_STATUSES.PROBLEM) {
            blocking.push({ ...h, reason: 'UNRESOLVED_PROBLEM' });
        } else if ([HOTEL_STATUSES.PLANNED, HOTEL_STATUSES.BOOKED, HOTEL_STATUSES.CONFIRMED].includes(h.status)) {
            warnings.push({ ...h, reason: 'FUTURE_BOOKING_REMAINING' });
        }
    }

    return { blocking, warnings };
}

module.exports = {
    HOTEL_STATUSES,
    isValidCoordinate,
    transitionHotelStatus,
    checkTourCompletionBlockedByHotels,
    logHotelEvent
};
