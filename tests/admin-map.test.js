const assert = require('node:assert/strict');
const test = require('node:test');
const {
    boundsForLatLngs,
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
