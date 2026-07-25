const test = require('node:test');
const assert = require('node:assert/strict');
const TourCore = require('../src/engines/tour-core-engine');

const tour = {
    id: 42,
    name: 'Sprint demo',
    tour_status: 'IN_PROGRESS',
    depot_lat: 47.4979,
    depot_lng: 19.0402,
    return_depot_lat: 47.4979,
    return_depot_lng: 19.0402
};

test('next stop skips completed and skipped stops', () => {
    const stops = [
        { id: 1, order_index: 0, stop_status: 'COMPLETED', is_completed: true },
        { id: 2, order_index: 1, stop_status: 'SKIPPED', is_completed: false },
        { id: 3, order_index: 2, stop_status: 'PENDING', is_completed: false }
    ];

    const next = TourCore.getNextStop(stops);

    assert.equal(next.id, 3);
});

test('route calculation falls back to straight-line estimate without OSRM', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error('network timeout');
    };

    try {
        const result = await TourCore.calculateTourRoute(tour, [
            { id: 1, order_index: 0, latitude: 47.5316, longitude: 19.0513, stop_status: 'PENDING' },
            { id: 2, order_index: 1, latitude: 47.6875, longitude: 17.6504, stop_status: 'PENDING' }
        ]);

        assert.equal(result.route_status, 'WARNING');
        assert.ok(result.planned_distance_km > 100);
        assert.ok(result.planned_duration_seconds > 0);
        assert.equal(result.stops[0].segment_distance_km > 0, true);
        assert.match(result.route_polyline, /LineString/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('progress uses fresh driver location for distance to next stop', () => {
    const progress = TourCore.calculateProgress(
        { ...tour, planned_distance_km: 200, planned_duration_seconds: 12000 },
        [
            { id: 1, order_index: 0, stop_status: 'COMPLETED', is_completed: true, segment_distance_km: 25, segment_duration_seconds: 1800 },
            { id: 2, order_index: 1, stop_status: 'PENDING', is_completed: false, latitude: 47.5, longitude: 19.05, segment_distance_km: 80, segment_duration_seconds: 4800 },
            { id: 3, order_index: 2, stop_status: 'PENDING', is_completed: false, latitude: 47.7, longitude: 18.9, segment_distance_km: 95, segment_duration_seconds: 5400 }
        ],
        { latitude: 47.49, longitude: 19.04, timestamp: Date.now() }
    );

    assert.equal(progress.nextStop.id, 2);
    assert.ok(progress.distanceToNextStop < 5);
    assert.ok(progress.remainingDistance < 105);
    assert.equal(progress.completedDistance, 25);
    assert.equal(progress.locationStale, false);
});

test('progress marks old GPS data as stale', () => {
    const progress = TourCore.calculateProgress(
        tour,
        [{ id: 1, order_index: 0, stop_status: 'PENDING', latitude: 47.5, longitude: 19.05, segment_distance_km: 12 }],
        { latitude: 47.49, longitude: 19.04, timestamp: Date.now() - (60 * 60 * 1000) }
    );

    assert.equal(progress.locationStale, true);
    assert.equal(progress.distanceToNextStop, 12);
});
