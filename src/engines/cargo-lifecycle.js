// Single source of truth for the cargo rules more than one endpoint has to agree on: which
// cargo blocks a stop from completing, and which status changes a driver may make. Shared by
// the dedicated cargo/stop routes and the legacy mobile bulk tour sync so the two cannot drift.

// The transitions the dedicated driver endpoints allow, keyed by target status. Mirrors the
// pickup / deliver / report-damage / report-missing routes exactly. Statuses a driver may
// never set directly (IN_TRANSIT, CANCELLED, REJECTED, anything unknown) are unreachable
// because they are not keys here.
const DRIVER_TRANSITIONS = {
    PICKED_UP: ['PLANNED', 'READY_FOR_PICKUP'],
    DELIVERED: ['PICKED_UP', 'IN_TRANSIT'],
    DAMAGED: ['PICKED_UP', 'IN_TRANSIT', 'PLANNED', 'READY_FOR_PICKUP'],
    MISSING: ['PICKED_UP', 'IN_TRANSIT', 'PLANNED', 'READY_FOR_PICKUP']
};

function isLegalDriverTransition(fromStatus, toStatus) {
    if (!toStatus || toStatus === fromStatus) return true;
    return (DRIVER_TRANSITIONS[toStatus] || []).includes(fromStatus);
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

module.exports = { checkCargoBlocking, DRIVER_TRANSITIONS, isLegalDriverTransition };
