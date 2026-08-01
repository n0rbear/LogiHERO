const assert = require('node:assert/strict');
const test = require('node:test');
const {
    boundsForLatLngs,
    dedupeTourHotelMarkers,
    googleMapsUrlForLocation,
    googleStreetViewUrlForLocation,
    isDrawableCoordinate,
    normalizeLineStringCoordinates,
    projectLatLngToPercent,
    renderAdminMapScript,
    renderAdminMapStyles,
    tileUrlsForBounds
} = require('../src/utils/admin-map');

test('admin map helpers reject invalid coordinates without coercing to zero', () => {
    assert.equal(isDrawableCoordinate(47.5, 19.04), true);
    assert.equal(isDrawableCoordinate(0, 19.04), false);
    assert.equal(isDrawableCoordinate(47.5, 0), false);
    assert.equal(isDrawableCoordinate(91, 19.04), false);
    assert.equal(isDrawableCoordinate(47.5, 181), false);
    assert.equal(isDrawableCoordinate('not-a-number', 19.04), false);
});

test('admin map helpers decode GeoJSON LineString from longitude-latitude order', () => {
    const latlngs = normalizeLineStringCoordinates({
        type: 'LineString',
        coordinates: [
            [19.04, 47.5],
            [19.06, 47.52],
            ['invalid', 47.53],
            [0, 0]
        ]
    });

    assert.deepEqual(latlngs, [
        [47.5, 19.04],
        [47.52, 19.06]
    ]);
});

test('admin map helpers handle empty, malformed and one-point geometry safely', () => {
    assert.deepEqual(normalizeLineStringCoordinates(null), []);
    assert.deepEqual(normalizeLineStringCoordinates({ type: 'Point', coordinates: [19.04, 47.5] }), []);
    assert.deepEqual(normalizeLineStringCoordinates({ type: 'LineString', coordinates: [[19.04, 47.5]] }), [[47.5, 19.04]]);
    assert.equal(boundsForLatLngs([]), null);
});

test('admin map helpers produce bounded projection and HTTPS OSM tile URLs', () => {
    const bounds = boundsForLatLngs([[47.5, 19.04], [47.7, 19.3]]);
    assert.deepEqual(bounds, { minLat: 47.5, maxLat: 47.7, minLng: 19.04, maxLng: 19.3 });

    const projected = projectLatLngToPercent([47.6, 19.17], bounds);
    assert.ok(projected.x >= 4 && projected.x <= 96);
    assert.ok(projected.y >= 4 && projected.y <= 96);

    const tiles = tileUrlsForBounds(bounds, 7);
    assert.equal(tiles.length, 9);
    assert.ok(tiles.every(url => url.startsWith('https://tile.openstreetmap.org/7/')));
});

test('admin map render output creates tile, marker and route layers without external script dependency', () => {
    const script = renderAdminMapScript();
    const styles = renderAdminMapStyles();

    assert.match(script, /window\.L =/);
    assert.match(script, /admin-map-tile/);
    assert.match(script, /admin-map-route-polyline/);
    assert.match(script, /https:\/\/tile\.openstreetmap\.org/);
    assert.doesNotMatch(script, /unpkg\.com/);
    assert.match(styles, /\.admin-map/);
    assert.match(styles, /\.admin-map-route-polyline/);
});

test('admin map render output includes bounded zoom, drag, resize and fit-route lifecycle', () => {
    const script = renderAdminMapScript();
    const styles = renderAdminMapStyles();

    assert.match(script, /MIN_ZOOM/);
    assert.match(script, /MAX_ZOOM/);
    assert.match(script, /addEventListener\('wheel'/);
    assert.match(script, /passive: false/);
    assert.match(script, /addEventListener\('pointerdown'/);
    assert.match(script, /addEventListener\('pointermove'/);
    assert.match(script, /addEventListener\('mousedown'/);
    assert.match(script, /addEventListener\('mousemove'/);
    assert.match(script, /fitRoute/);
    assert.match(script, /admin-map-fit-route/);
    assert.match(script, /listenersInstalled/);
    assert.match(styles, /touch-action: none/);
    assert.match(styles, /admin-map-dragging/);
});

test('admin map hotel helpers deduplicate linked hotels and HOTEL stops safely', () => {
    const hotels = [
        { id: 1, uuid: 'hotel-a', stop_id: 2, latitude: 47.5, longitude: 19.04 },
        { id: 2, uuid: 'hotel-b', latitude: 47.6, longitude: 19.05 },
        { id: 2, uuid: 'hotel-b', latitude: 47.6, longitude: 19.05 },
        { id: 3, latitude: 0, longitude: 0 }
    ];
    const stops = [
        { id: 2, stop_type: 'HOTEL', latitude: 47.5, longitude: 19.04 },
        { id: 4, stop_type: 'DELIVERY', latitude: 47.6, longitude: 19.05 }
    ];

    assert.deepEqual(dedupeTourHotelMarkers(hotels, stops), [
        { id: 2, uuid: 'hotel-b', latitude: 47.6, longitude: 19.05 }
    ]);
});

test('admin map external links are key-free, encoded and coordinate validated', () => {
    const coordinateMaps = googleMapsUrlForLocation({ latitude: 47.5, longitude: 19.04 });
    const coordinateStreet = googleStreetViewUrlForLocation({ latitude: 47.5, longitude: 19.04 });
    const addressMaps = googleMapsUrlForLocation({ address: 'Main Street 1, Budapest' });

    assert.equal(coordinateMaps, 'https://www.google.com/maps/search/?api=1&query=47.5%2C19.04');
    assert.equal(coordinateStreet, 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=47.5%2C19.04');
    assert.equal(addressMaps, 'https://www.google.com/maps/search/?api=1&query=Main%20Street%201%2C%20Budapest');
    assert.equal(googleMapsUrlForLocation({ latitude: 0, longitude: 0 }), null);
    assert.doesNotMatch(coordinateStreet, /key=/i);
    assert.doesNotMatch(addressMaps, /javascript:/i);
});
