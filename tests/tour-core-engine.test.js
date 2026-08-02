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

test('terminal resolution supports driver home, depot and legacy none', () => {
    assert.equal(TourCore.resolveTerminal({ terminal_mode: 'NONE' }).diagnostic, 'TERMINAL_NOT_CONFIGURED');
    assert.deepEqual(TourCore.resolveTerminal({ terminal_mode: 'DRIVER_HOME', driver_home_lat: 47.5, driver_home_lng: 19.04 }).point, {
        kind: 'DRIVER_HOME',
        latitude: 47.5,
        longitude: 19.04
    });
    assert.equal(TourCore.resolveTerminal({ terminal_mode: 'DRIVER_HOME' }).diagnostic, 'DRIVER_HOME_COORDINATES_MISSING');
    assert.deepEqual(TourCore.resolveTerminal({ terminal_mode: 'DEPOT', return_depot_lat: 48.1, return_depot_lng: 18.2 }).point, {
        kind: 'RETURN_DEPOT',
        latitude: 48.1,
        longitude: 18.2
    });
    assert.equal(TourCore.resolveTerminal({ terminal_mode: 'DEPOT' }).diagnostic, 'DEPOT_COORDINATES_MISSING');
    assert.equal(TourCore.resolveTerminal({ terminal_mode: 'CUSTOM' }).diagnostic, 'INVALID_TERMINAL_MODE');
});

test('virtual terminal appends to route points and prevents near duplicates', async () => {
    const originalFetch = global.fetch;
    global.fetch = undefined;
    try {
        const baseTour = { id: 1, terminal_mode: 'DRIVER_HOME', driver_home_lat: 47.6, driver_home_lng: 19.2 };
        const result = await TourCore.calculateTourRoute(baseTour, [
            { id: 1, order_index: 0, latitude: 47.5, longitude: 19.04, stop_status: 'PENDING' }
        ]);

        assert.equal(result.points.at(-1).kind, 'DRIVER_HOME');
        assert.equal(result.terminal.included, true);
        assert.ok(result.planned_distance_km > 0);

        const duplicate = await TourCore.calculateTourRoute(
            { ...baseTour, driver_home_lat: 47.5002, driver_home_lng: 19.0402 },
            [{ id: 1, order_index: 0, latitude: 47.5, longitude: 19.04, stop_status: 'PENDING' }]
        );
        assert.equal(duplicate.points.filter(p => p.kind === 'DRIVER_HOME').length, 0);
        assert.equal(duplicate.terminal.diagnostic, 'TERMINAL_DUPLICATE_OMITTED');

        const distinct = await TourCore.calculateTourRoute(
            { ...baseTour, driver_home_lat: 47.502, driver_home_lng: 19.042 },
            [{ id: 1, order_index: 0, latitude: 47.5, longitude: 19.04, stop_status: 'PENDING' }]
        );
        assert.equal(distinct.points.at(-1).kind, 'DRIVER_HOME');
    } finally {
        global.fetch = originalFetch;
    }
});

test('route without terminal stays legacy compatible', async () => {
    const originalFetch = global.fetch;
    global.fetch = undefined;
    try {
        const result = await TourCore.calculateTourRoute({ id: 2, terminal_mode: 'NONE' }, [
            { id: 1, order_index: 0, latitude: 47.5, longitude: 19.04, stop_status: 'PENDING' },
            { id: 2, order_index: 1, latitude: 47.6, longitude: 19.2, stop_status: 'PENDING' }
        ]);

        assert.equal(result.terminal.mode, 'NONE');
        assert.equal(result.points.length, 2);
        assert.equal(result.points.every(p => p.kind === 'STOP'), true);
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
