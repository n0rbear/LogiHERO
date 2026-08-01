const OSM_TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

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
                function lonToX(lon, zoom) {
                    return Math.floor(((lon + 180) / 360) * (2 ** zoom));
                }
                function latToY(lat, zoom) {
                    const rad = lat * Math.PI / 180;
                    return Math.floor((1 - Math.log(Math.tan(rad) + (1 / Math.cos(rad))) / Math.PI) / 2 * (2 ** zoom));
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
                    el.innerHTML = '<div class="admin-map-tiles" aria-hidden="true"></div><svg class="admin-map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div class="admin-map-markers"></div><div class="admin-map-empty">No drawable coordinates.</div>';
                }
                function drawTiles(map) {
                    const tileRoot = map.el.querySelector('.admin-map-tiles');
                    if (!tileRoot) return;
                    tileRoot.innerHTML = tileUrls(map.bounds, map.zoom).map((url, i) => '<img class="admin-map-tile" src="' + url + '" alt="" loading="lazy" style="left:' + ((i % 3) * 33.3333) + '%;top:' + (Math.floor(i / 3) * 33.3333) + '%;">').join('');
                }
                function refreshMap(map) {
                    const activePoints = map.points.length ? map.points : [[47.5, 19.04]];
                    map.bounds = padded(boundsFor(activePoints));
                    drawTiles(map);
                    map.layers.forEach(layer => layer.redraw && layer.redraw());
                    map.el.classList.toggle('admin-map-has-data', map.points.length > 0);
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
                            setView(center, zoom) {
                                this.zoom = Number(zoom || this.zoom || 7);
                                if (valid(center && center[0], center && center[1])) this.points = [[Number(center[0]), Number(center[1])]];
                                refreshMap(this);
                                return this;
                            },
                            fitBounds(bounds) {
                                const points = Array.isArray(bounds) ? bounds : [];
                                points.forEach(point => addPoint(this, point));
                                refreshMap(this);
                                return this;
                            },
                            invalidateSize() {
                                refreshMap(this);
                                return this;
                            }
                        };
                        if (el) {
                            ensureMapShell(el);
                            setTimeout(() => refreshMap(map), 0);
                            window.addEventListener('resize', () => map.invalidateSize(), { passive: true });
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
                                    this.map.el.querySelector('.admin-map-overlay').innerHTML = '';
                                    this.map.el.querySelector('.admin-map-markers').innerHTML = '';
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
                        marker.className = 'admin-map-marker';
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
                                    const pos = project(latlng, layer.map.bounds);
                                    if (pos) {
                                        marker.style.left = pos.x + '%';
                                        marker.style.top = pos.y + '%';
                                    }
                                };
                                this.remove = () => marker.remove();
                                layer.track(this);
                                refreshMap(layer.map);
                                return this;
                            },
                            bindPopup(html) {
                                marker.title = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim();
                                return this;
                            }
                        };
                    },
                    divIcon(options) {
                        return { html: options && options.html ? String(options.html) : '' };
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
                                    const d = this.latlngs.map((point, i) => {
                                        const pos = project(point, layer.map.bounds);
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
        }
        .admin-map-tiles,
        .admin-map-overlay,
        .admin-map-markers {
            position: absolute;
            inset: 0;
        }
        .admin-map-tiles {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            grid-template-rows: repeat(3, 1fr);
            opacity: .98;
            background:
                linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px),
                linear-gradient(0deg, rgba(255,255,255,.4) 1px, transparent 1px);
            background-size: 48px 48px;
        }
        .admin-map-tile {
            position: absolute;
            width: 33.3334%;
            height: 33.3334%;
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
    isDrawableCoordinate,
    normalizeLineStringCoordinates,
    projectLatLngToPercent,
    renderAdminMapScript,
    renderAdminMapStyles,
    tileUrlsForBounds
};
