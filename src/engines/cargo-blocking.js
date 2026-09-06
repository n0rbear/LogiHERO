// Single source of truth for "does cargo block completion", shared by the dedicated
// stop-complete endpoint and the legacy mobile bulk tour sync so the two cannot drift.
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

module.exports = { checkCargoBlocking };
