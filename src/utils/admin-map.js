const OSM_TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const TILE_SIZE = 256;

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isDrawableCoordinate(lat, lng) {
    const latitude = toFiniteNumber(lat);
    const longitude = toFiniteNumber(lng);
    return latitude !== null
        && longitude !== null
        && Math.abs(latitude) <= 90
        && Math.abs(longitude) <= 180
        && Math.abs(latitude) > 0.000001
        && Math.abs(longitude) > 0.000001;
}

function normalizeLineStringCoordinates(polyline) {
    if (!polyline || polyline.type !== 'LineString' || !Array.isArray(polyline.coordinates)) return [];
    return polyline.coordinates
        .map(point => Array.isArray(point) && point.length >= 2 ? [toFiniteNumber(point[1]), toFiniteNumber(point[0])] : null)
        .filter(point => point && isDrawableCoordinate(point[0], point[1]));
}

function boundsForLatLngs(latlngs) {
    const valid = (latlngs || []).filter(point => Array.isArray(point) && isDrawableCoordinate(point[0], point[1]));
    if (!valid.length) return null;
    const lats = valid.map(point => Number(point[0]));
    const lngs = valid.map(point => Number(point[1]));
    return {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs)
    };
}

function projectLatLngToPercent(latlng, bounds) {
    if (!Array.isArray(latlng) || !bounds || !isDrawableCoordinate(latlng[0], latlng[1])) return null;
    const lat = Number(latlng[0]);
    const lng = Number(latlng[1]);
    const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
    const lngSpan = Math.max(0.0001, bounds.maxLng - bounds.minLng);
    const x = 8 + ((lng - bounds.minLng) / lngSpan) * 84;
    const y = 92 - ((lat - bounds.minLat) / latSpan) * 84;
    return {
        x: Math.max(4, Math.min(96, x)),
        y: Math.max(4, Math.min(96, y))
    };
}

function lonToTileX(lon, zoom) {
    return Math.floor(((lon + 180) / 360) * (2 ** zoom));
}

function latToTileY(lat, zoom) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + (1 / Math.cos(rad))) / Math.PI) / 2 * (2 ** zoom));
}

function tileUrlsForBounds(bounds, zoom = 7) {
    if (!bounds) return [];
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    const centerX = lonToTileX(centerLng, zoom);
    const centerY = latToTileY(centerLat, zoom);
    const maxTile = (2 ** zoom) - 1;
    const urls = [];
    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
        for (let x = centerX - 1; x <= centerX + 1; x += 1) {
            if (y >= 0 && y <= maxTile) {
                const wrappedX = ((x % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
                urls.push(OSM_TILE_TEMPLATE.replace('{z}', String(zoom)).replace('{x}', String(wrappedX)).replace('{y}', String(y)));
            }
        }
    }
    return urls;
}

function encodeMapQuery(value) {
    return encodeURIComponent(String(value || '').trim());
}

function googleMapsUrlForLocation({ latitude, longitude, address } = {}) {
    if (isDrawableCoordinate(latitude, longitude)) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeMapQuery(`${Number(latitude)},${Number(longitude)}`)}`;
    }
    if (address && String(address).trim()) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeMapQuery(address)}`;
    }
    return null;
}

function googleStreetViewUrlForLocation({ latitude, longitude, address } = {}) {
    if (isDrawableCoordinate(latitude, longitude)) {
        return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeMapQuery(`${Number(latitude)},${Number(longitude)}`)}`;
    }
    if (address && String(address).trim()) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeMapQuery(address)}`;
    }
    return null;
}

function normalizeRelationKey(value) {
    return value === undefined || value === null || value === '' ? null : String(value);
}

function dedupeTourHotelMarkers(hotels = [], stops = []) {
    const stopHotelKeys = new Set();
    const hotelStopIds = new Set();
    const normalizedStops = (stops || []).filter(stop => String(stop.stop_type || stop.stopType || '').toUpperCase() === 'HOTEL');

    normalizedStops.forEach((stop) => {
        const stopId = normalizeRelationKey(stop.id || stop.stop_id || stop.stopId);
        const stopUuid = normalizeRelationKey(stop.uuid);
        if (stopId) stopHotelKeys.add(`stop-id:${stopId}`);
        if (stopUuid) stopHotelKeys.add(`stop-uuid:${stopUuid}`);
        if (isDrawableCoordinate(stop.latitude, stop.longitude)) {
            stopHotelKeys.add(`coord:${Number(stop.latitude).toFixed(6)},${Number(stop.longitude).toFixed(6)}`);
        }
    });

    const seen = new Set();
    return (hotels || []).filter((hotel) => {
        if (!isDrawableCoordinate(hotel.latitude, hotel.longitude)) return false;
        const hotelId = normalizeRelationKey(hotel.uuid) || normalizeRelationKey(hotel.id);
        const stopId = normalizeRelationKey(hotel.stop_id || hotel.stopId);
        const coordKey = isDrawableCoordinate(hotel.latitude, hotel.longitude)
            ? `coord:${Number(hotel.latitude).toFixed(6)},${Number(hotel.longitude).toFixed(6)}`
            : null;
        const key = hotelId ? `hotel:${hotelId}` : (stopId ? `hotel-stop:${stopId}` : coordKey);
        if (!key || seen.has(key)) return false;
        if (stopId && stopHotelKeys.has(`stop-id:${stopId}`)) {
            hotelStopIds.add(stopId);
            return false;
        }
        if (!stopId && coordKey && stopHotelKeys.has(coordKey)) return false;
        seen.add(key);
        return true;
    });
}

function renderAdminMapScript() {
    return `
        <script>
            (function() {
                const TILE_TEMPLATE = '${OSM_TILE_TEMPLATE}';
                function n(value) {
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? parsed : null;
                }
                function valid(lat, lng) {
                    const la = n(lat), ln = n(lng);
                    return la !== null && ln !== null && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && Math.abs(la) > 0.000001 && Math.abs(ln) > 0.000001;
                }
                function boundsFor(points) {
                    const filtered = (points || []).filter(p => Array.isArray(p) && valid(p[0], p[1]));
                    if (!filtered.length) return null;
                    const lats = filtered.map(p => Number(p[0]));
                    const lngs = filtered.map(p => Number(p[1]));
                    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
                }
                function padded(bounds) {
                    if (!bounds) return { minLat: 45.7, maxLat: 48.7, minLng: 16.1, maxLng: 22.9 };
                    const latPad = Math.max(0.02, (bounds.maxLat - bounds.minLat) * 0.18);
                    const lngPad = Math.max(0.02, (bounds.maxLng - bounds.minLng) * 0.18);
                    return { minLat: bounds.minLat - latPad, maxLat: bounds.maxLat + latPad, minLng: bounds.minLng - lngPad, maxLng: bounds.maxLng + lngPad };
                }
                function project(latlng, bounds) {
                    if (!Array.isArray(latlng) || !bounds || !valid(latlng[0], latlng[1])) return null;
                    const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
                    const lngSpan = Math.max(0.0001, bounds.maxLng - bounds.minLng);
                    return {
                        x: Math.max(4, Math.min(96, 8 + ((Number(latlng[1]) - bounds.minLng) / lngSpan) * 84)),
                        y: Math.max(4, Math.min(96, 92 - ((Number(latlng[0]) - bounds.minLat) / latSpan) * 84))
                    };
                }
                const MIN_ZOOM = ${MIN_ZOOM};
                const MAX_ZOOM = ${MAX_ZOOM};
                const TILE_SIZE = ${TILE_SIZE};
                function clamp(value, min, max) {
                    return Math.max(min, Math.min(max, value));
                }
                function worldSize(zoom) {
                    return TILE_SIZE * (2 ** zoom);
                }
                function lonToWorldX(lon, zoom) {
                    return ((lon + 180) / 360) * worldSize(zoom);
                }
                function latToWorldY(lat, zoom) {
                    const rad = lat * Math.PI / 180;
                    return (1 - Math.log(Math.tan(rad) + (1 / Math.cos(rad))) / Math.PI) / 2 * worldSize(zoom);
                }
                function worldXToLng(x, zoom) {
                    return (x / worldSize(zoom)) * 360 - 180;
                }
                function worldYToLat(y, zoom) {
                    const n = Math.PI - 2 * Math.PI * y / worldSize(zoom);
                    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
                }
                function lonToX(lon, zoom) {
                    return Math.floor(((lon + 180) / 360) * (2 ** zoom));
                }
                function latToY(lat, zoom) {
                    return Math.floor(latToWorldY(lat, zoom) / TILE_SIZE);
                }
                function tileUrls(bounds, zoom) {
                    const b = bounds || { minLat: 45.7, maxLat: 48.7, minLng: 16.1, maxLng: 22.9 };
                    const centerLat = (b.minLat + b.maxLat) / 2;
                    const centerLng = (b.minLng + b.maxLng) / 2;
                    const centerX = lonToX(centerLng, zoom);
                    const centerY = latToY(centerLat, zoom);
                    const max = (2 ** zoom) - 1;
                    const urls = [];
                    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
                        for (let x = centerX - 1; x <= centerX + 1; x += 1) {
                            if (y >= 0 && y <= max) {
                                const wrappedX = ((x % (max + 1)) + (max + 1)) % (max + 1);
                                urls.push(TILE_TEMPLATE.replace('{z}', String(zoom)).replace('{x}', String(wrappedX)).replace('{y}', String(y)));
                            }
                        }
                    }
                    return urls;
                }
                function ensureMapShell(el) {
                    el.classList.add('admin-map', 'admin-map-ready');
                    el.innerHTML = '<div class="admin-map-tiles" aria-hidden="true"></div><svg class="admin-map-overlay" aria-hidden="true"></svg><div class="admin-map-markers"></div><div class="admin-map-popup" hidden></div><button class="admin-map-fit-route" type="button">Fit route</button><div class="admin-map-empty">No drawable coordinates.</div>';
                    el.tabIndex = 0;
                }
                function mapSize(map) {
                    const rect = map.el.getBoundingClientRect();
                    return { width: Math.max(1, rect.width || 1), height: Math.max(1, rect.height || 1) };
                }
                function centerFromBounds(bounds) {
                    const b = bounds || { minLat: 45.7, maxLat: 48.7, minLng: 16.1, maxLng: 22.9 };
                    return [(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2];
                }
                function zoomForBounds(bounds, map, padding) {
                    if (!bounds) return 7;
                    const size = mapSize(map);
                    const pad = Number(padding || 42);
                    const width = Math.max(1, size.width - pad * 2);
                    const height = Math.max(1, size.height - pad * 2);
                    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z -= 1) {
                        const x1 = lonToWorldX(bounds.minLng, z);
                        const x2 = lonToWorldX(bounds.maxLng, z);
                        const y1 = latToWorldY(bounds.maxLat, z);
                        const y2 = latToWorldY(bounds.minLat, z);
                        if (Math.abs(x2 - x1) <= width && Math.abs(y2 - y1) <= height) return z;
                    }
                    return MIN_ZOOM;
                }
                function screenPoint(map, latlng) {
                    if (!valid(latlng && latlng[0], latlng && latlng[1])) return null;
                    const size = mapSize(map);
                    const centerX = lonToWorldX(map.center[1], map.zoom);
                    const centerY = latToWorldY(map.center[0], map.zoom);
                    const x = lonToWorldX(Number(latlng[1]), map.zoom) - centerX + size.width / 2;
                    const y = latToWorldY(Number(latlng[0]), map.zoom) - centerY + size.height / 2;
                    return { x, y };
                }
                function drawTiles(map) {
                    const tileRoot = map.el.querySelector('.admin-map-tiles');
                    if (!tileRoot) return;
                    const size = mapSize(map);
                    const centerX = lonToWorldX(map.center[1], map.zoom);
                    const centerY = latToWorldY(map.center[0], map.zoom);
                    const startX = Math.floor((centerX - size.width / 2) / TILE_SIZE);
                    const endX = Math.floor((centerX + size.width / 2) / TILE_SIZE);
                    const startY = Math.floor((centerY - size.height / 2) / TILE_SIZE);
                    const endY = Math.floor((centerY + size.height / 2) / TILE_SIZE);
                    const max = (2 ** map.zoom) - 1;
                    const tiles = [];
                    for (let y = startY; y <= endY; y += 1) {
                        for (let x = startX; x <= endX; x += 1) {
                            if (y >= 0 && y <= max) {
                                const wrappedX = ((x % (max + 1)) + (max + 1)) % (max + 1);
                                const left = x * TILE_SIZE - centerX + size.width / 2;
                                const top = y * TILE_SIZE - centerY + size.height / 2;
                                const url = TILE_TEMPLATE.replace('{z}', String(map.zoom)).replace('{x}', String(wrappedX)).replace('{y}', String(y));
                                tiles.push('<img class="admin-map-tile" src="' + url + '" alt="" loading="lazy" style="left:' + left.toFixed(1) + 'px;top:' + top.toFixed(1) + 'px;">');
                            }
                        }
                    }
                    tileRoot.innerHTML = tiles.join('');
                }
                function refreshMap(map) {
                    map.el.dataset.zoom = String(map.zoom);
                    map.el.dataset.center = map.center.map(value => Number(value).toFixed(6)).join(',');
                    drawTiles(map);
                    map.layers.forEach(layer => layer.redraw && layer.redraw());
                    map.el.classList.toggle('admin-map-has-data', map.points.length > 0);
                }
                function fitPoints(map, points, options) {
                    const validPoints = (points || []).filter(p => valid(p && p[0], p && p[1]));
                    map.points = validPoints.map(p => [Number(p[0]), Number(p[1])]);
                    map.bounds = padded(boundsFor(validPoints));
                    map.routePoints = validPoints.slice();
                    const center = centerFromBounds(map.bounds);
                    map.center = center;
                    map.zoom = validPoints.length > 1 ? zoomForBounds(map.bounds, map, (options && options.padding && options.padding[0]) || 42) : Math.min(15, Math.max(map.zoom || 13, 13));
                    refreshMap(map);
                }
                function installInteractions(map) {
                    if (map.listenersInstalled || !map.el) return;
                    map.listenersInstalled = true;
                    let dragging = false;
                    let last = null;
                    let moved = false;
                    map.el.querySelector('.admin-map-fit-route').addEventListener('click', function(event) {
                        event.stopPropagation();
                        map.fitRoute();
                    });
                    map.el.addEventListener('wheel', function(event) {
                        event.preventDefault();
                        const rect = map.el.getBoundingClientRect();
                        const size = mapSize(map);
                        const beforeZoom = map.zoom;
                        const nextZoom = clamp(map.zoom + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
                        if (nextZoom === beforeZoom) return;
                        const px = event.clientX - rect.left;
                        const py = event.clientY - rect.top;
                        const beforeWorldX = lonToWorldX(map.center[1], beforeZoom) + px - size.width / 2;
                        const beforeWorldY = latToWorldY(map.center[0], beforeZoom) + py - size.height / 2;
                        const scale = 2 ** (nextZoom - beforeZoom);
                        const afterWorldX = beforeWorldX * scale - px + size.width / 2;
                        const afterWorldY = beforeWorldY * scale - py + size.height / 2;
                        map.zoom = nextZoom;
                        map.center = [worldYToLat(afterWorldY, nextZoom), worldXToLng(afterWorldX, nextZoom)];
                        refreshMap(map);
                    }, { passive: false });
                    function beginDrag(event) {
                        if (event.target.closest('.admin-map-marker, .admin-map-popup, .admin-map-fit-route')) return;
                        dragging = true;
                        moved = false;
                        last = { x: event.clientX, y: event.clientY };
                        map.el.classList.add('admin-map-dragging');
                        if (event.pointerId !== undefined) map.el.setPointerCapture && map.el.setPointerCapture(event.pointerId);
                        event.preventDefault();
                    }
                    function moveDrag(event) {
                        if (!dragging || !last) return;
                        const dx = event.clientX - last.x;
                        const dy = event.clientY - last.y;
                        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
                        const centerX = lonToWorldX(map.center[1], map.zoom) - dx;
                        const centerY = latToWorldY(map.center[0], map.zoom) - dy;
                        map.center = [worldYToLat(centerY, map.zoom), worldXToLng(centerX, map.zoom)];
                        last = { x: event.clientX, y: event.clientY };
                        refreshMap(map);
                    }
                    function endDrag(event) {
                        if (!dragging) return;
                        dragging = false;
                        last = null;
                        map.el.classList.remove('admin-map-dragging');
                        if (event && event.pointerId !== undefined) map.el.releasePointerCapture && map.el.releasePointerCapture(event.pointerId);
                        setTimeout(() => { moved = false; }, 0);
                    }
                    map.el.addEventListener('pointerdown', beginDrag);
                    map.el.addEventListener('pointermove', moveDrag);
                    map.el.addEventListener('pointerup', endDrag);
                    map.el.addEventListener('pointercancel', endDrag);
                    window.addEventListener('pointerup', endDrag);
                    map.el.addEventListener('mousedown', beginDrag);
                    window.addEventListener('mousemove', moveDrag);
                    window.addEventListener('mouseup', endDrag);
                    map.wasDragging = () => moved;
                }
                function addPoint(map, latlng) {
                    if (valid(latlng && latlng[0], latlng && latlng[1])) {
                        map.points.push([Number(latlng[0]), Number(latlng[1])]);
                    }
                }
                window.L = {
                    map(id) {
                        const el = document.getElementById(id);
                        const map = {
                            el,
                            zoom: 7,
                            bounds: null,
                            points: [],
                            layers: [],
                            center: [47.5, 19.04],
                            routePoints: [],
                            setView(center, zoom) {
                                this.zoom = clamp(Number(zoom || this.zoom || 7), MIN_ZOOM, MAX_ZOOM);
                                if (valid(center && center[0], center && center[1])) {
                                    this.center = [Number(center[0]), Number(center[1])];
                                    this.points = [[Number(center[0]), Number(center[1])]];
                                }
                                refreshMap(this);
                                return this;
                            },
                            fitBounds(bounds, options) {
                                const points = Array.isArray(bounds) ? bounds : [];
                                fitPoints(this, points, options);
                                return this;
                            },
                            invalidateSize() {
                                refreshMap(this);
                                return this;
                            },
                            fitRoute() {
                                fitPoints(this, this.routePoints.length ? this.routePoints : this.points, { padding: [42, 42] });
                                return this;
                            }
                        };
                        if (el) {
                            ensureMapShell(el);
                            installInteractions(map);
                            setTimeout(() => refreshMap(map), 0);
                            let resizeTimer = null;
                            window.addEventListener('resize', () => {
                                clearTimeout(resizeTimer);
                                resizeTimer = setTimeout(() => map.invalidateSize(), 80);
                            }, { passive: true });
                        }
                        return map;
                    },
                    tileLayer() {
                        return { addTo(map) { drawTiles(map); return this; } };
                    },
                    layerGroup() {
                        return {
                            items: [],
                            map: null,
                            addTo(map) {
                                    this.map = map;
                                    map.layers.push(this);
                                    return this;
                            },
                            clearLayers() {
                                    this.items.splice(0).forEach(item => item.remove && item.remove());
                                    if (this.map) {
                                        this.map.points = [];
                                        this.map.routePoints = [];
                                        this.map.el.querySelector('.admin-map-overlay').innerHTML = '';
                                        this.map.el.querySelector('.admin-map-markers').innerHTML = '';
                                        const popup = this.map.el.querySelector('.admin-map-popup');
                                        if (popup) { popup.hidden = true; popup.innerHTML = ''; }
                                        refreshMap(this.map);
                                    }
                            },
                            track(item) {
                                this.items.push(item);
                                return item;
                            },
                            redraw() {
                                this.items.forEach(item => item.redraw && item.redraw());
                            }
                        };
                    },
                    marker(latlng, options) {
                        const marker = document.createElement('button');
                        marker.type = 'button';
                        marker.className = 'admin-map-marker' + (options && options.markerType === 'hotel' ? ' hotel-marker' : '') + (options && options.className ? ' ' + String(options.className).replace(/[^a-zA-Z0-9_-]/g, ' ') : '') + (options && options.icon && options.icon.className ? ' ' + String(options.icon.className).replace(/[^a-zA-Z0-9_-]/g, ' ') : '');
                        if (options && options.markerType) marker.dataset.markerType = options.markerType;
                        const iconHtml = options && options.icon && options.icon.html ? String(options.icon.html) : '';
                        if (iconHtml) marker.innerHTML = iconHtml;
                        return {
                            latlng,
                            el: marker,
                            addTo(layer) {
                                if (!layer || !layer.map || !valid(latlng && latlng[0], latlng && latlng[1])) return this;
                                addPoint(layer.map, latlng);
                                layer.map.el.querySelector('.admin-map-markers').appendChild(marker);
                                this.redraw = () => {
                                    const pos = screenPoint(layer.map, latlng);
                                    if (pos) {
                                        marker.style.left = pos.x.toFixed(1) + 'px';
                                        marker.style.top = pos.y.toFixed(1) + 'px';
                                    }
                                };
                                this.remove = () => marker.remove();
                                layer.track(this);
                                refreshMap(layer.map);
                                return this;
                            },
                            bindPopup(html) {
                                marker.title = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
                                marker.addEventListener('click', function(event) {
                                    event.stopPropagation();
                                    const mapEl = marker.closest('.admin-map');
                                    const popup = mapEl && mapEl.querySelector('.admin-map-popup');
                                    if (!popup) return;
                                    popup.innerHTML = String(html || '');
                                    popup.hidden = false;
                                    popup.style.left = marker.style.left;
                                    popup.style.top = marker.style.top;
                                });
                                return this;
                            }
                        };
                    },
                    divIcon(options) {
                        return {
                            html: options && options.html ? String(options.html) : '',
                            className: options && options.className ? String(options.className) : ''
                        };
                    },
                    polyline(latlngs, options) {
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        path.setAttribute('class', 'admin-map-route-polyline');
                        path.setAttribute('fill', 'none');
                        path.setAttribute('stroke', options && options.color ? options.color : '#0d6efd');
                        path.setAttribute('stroke-width', String(options && options.weight ? options.weight : 4));
                        path.setAttribute('stroke-linecap', 'round');
                        path.setAttribute('stroke-linejoin', 'round');
                        return {
                            latlngs: (latlngs || []).filter(p => valid(p && p[0], p && p[1])),
                            path,
                            addTo(layer) {
                                if (!layer || !layer.map || this.latlngs.length < 2) return this;
                                this.latlngs.forEach(point => addPoint(layer.map, point));
                                layer.map.el.querySelector('.admin-map-overlay').appendChild(path);
                                this.redraw = () => {
                                    const size = mapSize(layer.map);
                                    layer.map.el.querySelector('.admin-map-overlay').setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
                                    const d = this.latlngs.map((point, i) => {
                                        const pos = screenPoint(layer.map, point);
                                        return pos ? (i === 0 ? 'M ' : 'L ') + pos.x.toFixed(2) + ' ' + pos.y.toFixed(2) : '';
                                    }).filter(Boolean).join(' ');
                                    path.setAttribute('d', d);
                                };
                                this.remove = () => path.remove();
                                layer.track(this);
                                refreshMap(layer.map);
                                return this;
                            }
                        };
                    }
                };
            })();
        </script>
    `;
}

function renderAdminMapStyles() {
    return `
        .admin-map {
            position: relative;
            overflow: hidden;
            min-height: 360px;
            background: #dfe8ef;
            isolation: isolate;
            cursor: grab;
            user-select: none;
            touch-action: none;
        }
        .admin-map-dragging {
            cursor: grabbing;
        }
        .admin-map-tiles,
        .admin-map-overlay,
        .admin-map-markers {
            position: absolute;
            inset: 0;
        }
        .admin-map-tiles {
            display: block;
            opacity: .98;
            background:
                linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px),
                linear-gradient(0deg, rgba(255,255,255,.4) 1px, transparent 1px);
            background-size: 48px 48px;
            pointer-events: none;
        }
        .admin-map-tile {
            position: absolute;
            width: 256px;
            height: 256px;
            max-width: none;
            object-fit: cover;
        }
        .admin-map-overlay {
            width: 100%;
            height: 100%;
            z-index: 2;
            pointer-events: none;
        }
        .admin-map-route-polyline {
            vector-effect: non-scaling-stroke;
            filter: drop-shadow(0 2px 3px rgba(0,0,0,.25));
        }
        .admin-map-markers {
            z-index: 3;
        }
        .admin-map-marker {
            position: absolute;
            min-width: 24px;
            min-height: 24px;
            border: 0;
            border-radius: 999px;
            background: transparent;
            transform: translate(-50%, -50%);
            cursor: pointer;
            z-index: 2;
        }
        .admin-map-marker.hotel-marker {
            z-index: 3;
        }
        .admin-map-popup {
            position: absolute;
            z-index: 5;
            width: min(280px, calc(100% - 24px));
            max-width: 280px;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            background: rgba(255,255,255,.98);
            box-shadow: 0 10px 30px rgba(0,0,0,.18);
            padding: 12px;
            color: var(--color-text);
            font-size: 13px;
            line-height: 1.35;
            transform: translate(12px, -50%);
            user-select: text;
        }
        .admin-map-popup[hidden] {
            display: none;
        }
        .admin-map-popup h4 {
            margin: 0 0 6px;
            font-size: 14px;
        }
        .admin-map-popup p {
            margin: 4px 0;
        }
        .admin-map-popup-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
        }
        .admin-map-popup-actions a {
            border: 1px solid var(--color-border);
            border-radius: 6px;
            padding: 5px 8px;
            color: var(--color-brand);
            text-decoration: none;
            background: #fff;
            font-weight: 600;
        }
        .admin-map-fit-route {
            position: absolute;
            right: 12px;
            top: 12px;
            z-index: 4;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            background: rgba(255,255,255,.94);
            color: var(--color-text);
            padding: 8px 10px;
            font-weight: 700;
            cursor: pointer;
        }
        .admin-map-empty {
            position: absolute;
            left: 12px;
            bottom: 12px;
            z-index: 4;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            background: rgba(255,255,255,.92);
            color: var(--color-text-muted);
            padding: 8px 10px;
            font-size: 12px;
        }
        .admin-map-has-data .admin-map-empty {
            display: none;
        }
    `;
}

module.exports = {
    OSM_TILE_TEMPLATE,
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
};
