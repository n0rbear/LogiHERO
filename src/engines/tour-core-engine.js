const ACTIVE_STOP_STATUSES = new Set(['PENDING', 'NEXT', 'ARRIVED', 'IN_PROGRESS', 'PROBLEM']);
const COMPLETED_STOP_STATUSES = new Set(['COMPLETED', 'SKIPPED']);
const STALE_LOCATION_MS = 15 * 60 * 1000;
const TERMINAL_MODES = new Set(['NONE', 'DEPOT', 'DRIVER_HOME']);
const TERMINAL_DUPLICATE_TOLERANCE_KM = 0.05;

function toNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    // 0 / 0.0 / 0.000000 coordinates are considered invalid
    if (Math.abs(parsed) < 0.000001) return null;
    return parsed;
}

function isValidCoordinate(lat, lng) {
    const nLat = toNumber(lat);
    const nLng = toNumber(lng);
    return nLat !== null && nLng !== null;
}

function haversineKm(a, b) {
    if (!a || !b) return null;
    const lat1 = toNumber(a.latitude ?? a.lat);
    const lon1 = toNumber(a.longitude ?? a.lng);
    const lat2 = toNumber(b.latitude ?? b.lat);
    const lon2 = toNumber(b.longitude ?? b.lng);
    if ([lat1, lon1, lat2, lon2].some(v => v === null)) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function estimateDurationSeconds(distanceKm) {
    if (!Number.isFinite(distanceKm)) return null;
    return Math.round((distanceKm / 62) * 3600);
}

function normalizeTerminalMode(value) {
    const mode = String(value || 'NONE').trim().toUpperCase();
    return TERMINAL_MODES.has(mode) ? mode : null;
}

function resolveTerminal(tour = {}) {
    const mode = normalizeTerminalMode(tour.terminal_mode || tour.terminalMode);
    if (!mode) {
        return { mode: 'INVALID', included: false, duplicate: false, diagnostic: 'INVALID_TERMINAL_MODE', point: null, label: 'Invalid terminal mode' };
    }
    if (mode === 'NONE') {
        return { mode, included: false, duplicate: false, diagnostic: 'TERMINAL_NOT_CONFIGURED', point: null, label: 'No return terminal configured' };
    }
    if (mode === 'DRIVER_HOME') {
        const homeLat = toNumber(tour.driver_home_lat ?? tour.home_lat);
        const homeLng = toNumber(tour.driver_home_lng ?? tour.home_lng);
        const baseLat = toNumber(tour.driver_base_lat ?? tour.base_lat);
        const baseLng = toNumber(tour.driver_base_lng ?? tour.base_lng);
        const latitude = homeLat ?? baseLat;
        const longitude = homeLng ?? baseLng;
        if (latitude === null || longitude === null) {
            return { mode, included: false, duplicate: false, diagnostic: 'DRIVER_HOME_COORDINATES_MISSING', point: null, label: 'Driver home/base unavailable' };
        }
        return {
            mode,
            included: false,
            duplicate: false,
            diagnostic: 'OK',
            point: { kind: 'DRIVER_HOME', latitude, longitude },
            label: 'Driver home/base'
        };
    }
    const latitude = toNumber(tour.return_depot_lat) ?? toNumber(tour.depot_lat);
    const longitude = toNumber(tour.return_depot_lng) ?? toNumber(tour.depot_lng);
    if (latitude === null || longitude === null) {
        return { mode, included: false, duplicate: false, diagnostic: 'DEPOT_COORDINATES_MISSING', point: null, label: 'Depot unavailable' };
    }
    return {
        mode,
        included: false,
        duplicate: false,
        diagnostic: 'OK',
        point: { kind: 'RETURN_DEPOT', latitude, longitude },
        label: tour.return_depot_name || tour.depot_name || 'Return depot'
    };
}

function isDuplicateTerminal(lastPoint, terminalPoint, toleranceKm = TERMINAL_DUPLICATE_TOLERANCE_KM) {
    if (!lastPoint || !terminalPoint) return false;
    const distance = haversineKm(lastPoint, terminalPoint);
    return distance !== null && distance <= toleranceKm;
}

function getStopStatus(stop) {
    if (stop.stop_status) return String(stop.stop_status).toUpperCase();
    if (stop.is_completed) return 'COMPLETED';
    return 'PENDING';
}

function isStopDone(stop) {
    return COMPLETED_STOP_STATUSES.has(getStopStatus(stop));
}

function normalizeStop(stop) {
    const status = getStopStatus(stop);
    return {
        ...stop,
        stop_status: status,
        is_completed: Boolean(stop.is_completed || status === 'COMPLETED'),
        latitude: toNumber(stop.latitude),
        longitude: toNumber(stop.longitude),
        order_index: Number(stop.order_index || 0),
        segment_distance_km: toNumber(stop.segment_distance_km),
        segment_duration_seconds: stop.segment_duration_seconds === null ? null : Number(stop.segment_duration_seconds || 0),
        cumulative_distance_km: toNumber(stop.cumulative_distance_km),
        cumulative_duration_seconds: stop.cumulative_duration_seconds === null ? null : Number(stop.cumulative_duration_seconds || 0)
    };
}

function getNextStop(stops) {
    return stops.find(stop => ACTIVE_STOP_STATUSES.has(getStopStatus(stop)) && !isStopDone(stop)) || null;
}

function addressForStop(stop) {
    return stop.address_full || stop.address || [stop.street, stop.house_number, stop.postal_code, stop.city, stop.country].filter(Boolean).join(' ');
}

function navigationUrl(stop) {
    if (stop?.latitude && stop?.longitude) {
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stop.latitude},${stop.longitude}`)}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressForStop(stop || {}))}`;
}

async function fetchOsrm(points, overview = 'full') {
    if (points.length < 2 || typeof fetch !== 'function') return null;
    const coordinates = points.map(p => `${p.longitude},${p.latitude}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=${overview}&geometries=geojson&steps=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const data = await response.json();
        return data.routes?.[0] || null;
    } finally {
        clearTimeout(timeout);
    }
}

function buildRoutePoints(tour, stops, startOverride) {
    const points = [];
    const startLat = toNumber(startOverride?.latitude) ?? toNumber(tour.depot_lat);
    const startLng = toNumber(startOverride?.longitude) ?? toNumber(tour.depot_lng);
    if (startLat !== null && startLng !== null) points.push({ kind: 'START_DEPOT', latitude: startLat, longitude: startLng });
    for (const stop of stops) {
        if (!isStopDone(stop) && stop.latitude !== null && stop.longitude !== null) {
            points.push({ kind: 'STOP', stopId: stop.id, latitude: stop.latitude, longitude: stop.longitude });
        }
    }
    const terminal = resolveTerminal(tour);
    if (terminal.point) {
        const duplicate = isDuplicateTerminal(points[points.length - 1], terminal.point);
        terminal.duplicate = duplicate;
        if (!duplicate) {
            points.push({ ...terminal.point, terminalMode: terminal.mode, label: terminal.label });
            terminal.included = true;
        } else {
            terminal.diagnostic = 'TERMINAL_DUPLICATE_OMITTED';
        }
    }
    return { points, terminal };
}

function fallbackLegs(points) {
    const legs = [];
    for (let i = 1; i < points.length; i += 1) {
        const distance = haversineKm(points[i - 1], points[i]) || 0;
        legs.push({ distance: distance * 1000, duration: estimateDurationSeconds(distance) || 0 });
    }
    return legs;
}

async function calculateTourRoute(tour, rawStops, options = {}) {
    const stops = rawStops.map(normalizeStop).sort((a, b) => a.order_index - b.order_index);
    const { points, terminal } = buildRoutePoints(tour, stops, options.startLocation);
    const warnings = [];
    const missingCoordinates = stops.filter(s => !isStopDone(s) && (s.latitude === null || s.longitude === null));
    if (missingCoordinates.length) warnings.push('MISSING_STOP_COORDINATES');
    if (terminal.diagnostic && !['OK', 'TERMINAL_NOT_CONFIGURED', 'TERMINAL_DUPLICATE_OMITTED'].includes(terminal.diagnostic)) warnings.push(terminal.diagnostic);

    let route = null;
    let osrmError = null;
    try {
        route = await fetchOsrm(points, options.overview || 'full');
    } catch (error) {
        osrmError = error.message;
        warnings.push('OSRM_UNAVAILABLE_USING_ESTIMATE');
    }

    const legs = route?.legs?.length ? route.legs : fallbackLegs(points);
    const totalDistanceKm = (route?.distance ?? legs.reduce((sum, leg) => sum + (leg.distance || 0), 0)) / 1000;
    const totalDurationSeconds = Math.round(route?.duration ?? legs.reduce((sum, leg) => sum + (leg.duration || 0), 0));
    let cumulativeDistance = 0;
    let cumulativeDuration = 0;
    const enrichedStops = stops.map(stop => ({ ...stop }));
    let stopLegIndex = points[0]?.kind === 'START_DEPOT' ? 0 : -1;

    for (const stop of enrichedStops) {
        if (isStopDone(stop) || stop.latitude === null || stop.longitude === null) continue;
        const leg = legs[stopLegIndex] || { distance: 0, duration: 0 };
        const segmentDistance = (leg.distance || 0) / 1000;
        const segmentDuration = Math.round(leg.duration || 0);
        cumulativeDistance += segmentDistance;
        cumulativeDuration += segmentDuration;
        stop.segment_distance_km = segmentDistance;
        stop.segment_duration_seconds = segmentDuration;
        stop.cumulative_distance_km = cumulativeDistance;
        stop.cumulative_duration_seconds = cumulativeDuration;
        stopLegIndex += 1;
    }

    return {
        route_status: warnings.length ? 'WARNING' : 'OK',
        route_polyline: route?.geometry ? JSON.stringify(route.geometry) : JSON.stringify({
            type: 'LineString',
            coordinates: points.map(p => [p.longitude, p.latitude])
        }),
        planned_distance_km: totalDistanceKm,
        planned_duration_seconds: totalDurationSeconds,
        route_calculated_at: Date.now(),
        route_error: osrmError,
        warnings,
        points,
        terminal,
        legs,
        stops: enrichedStops
    };
}

function calculateProgress(tour, rawStops, latestLocation) {
    const stops = rawStops.map(normalizeStop).sort((a, b) => a.order_index - b.order_index);
    const nextStop = getNextStop(stops);
    const terminal = resolveTerminal(tour);
    const activeOperationalStops = stops.filter(stop => !isStopDone(stop));
    const lastActiveStop = activeOperationalStops[activeOperationalStops.length - 1] || null;
    const terminalDistanceKm = terminal.point && lastActiveStop && !isDuplicateTerminal(lastActiveStop, terminal.point)
        ? (haversineKm(lastActiveStop, terminal.point) || 0)
        : 0;
    const terminalDurationSeconds = estimateDurationSeconds(terminalDistanceKm) || 0;
    const completedDistance = stops
        .filter(isStopDone)
        .reduce((sum, stop) => sum + (stop.segment_distance_km || 0), 0);
    let distanceToNextStop = nextStop?.segment_distance_km ?? null;
    let durationToNextStop = nextStop?.segment_duration_seconds ?? null;
    const hasFreshLocation = latestLocation && Number(latestLocation.timestamp) > Date.now() - STALE_LOCATION_MS;
    if (hasFreshLocation && nextStop?.latitude !== null && nextStop?.longitude !== null) {
        const liveDistance = haversineKm(latestLocation, nextStop);
        if (liveDistance !== null) {
            distanceToNextStop = liveDistance;
            durationToNextStop = estimateDurationSeconds(liveDistance);
        }
    }
    const remainingFromStops = stops
        .filter(stop => !isStopDone(stop))
        .reduce((sum, stop) => sum + (stop.segment_distance_km || 0), 0);
    const plannedDistance = toNumber(tour.planned_distance_km) ?? stops.reduce((sum, stop) => sum + (stop.segment_distance_km || 0), 0);
    const plannedDuration = Number(tour.planned_duration_seconds || stops.reduce((sum, stop) => sum + (stop.segment_duration_seconds || 0), 0));
    const remainingDistance = distanceToNextStop !== null
        ? distanceToNextStop + stops.filter(stop => !isStopDone(stop) && stop.id !== nextStop?.id).reduce((sum, stop) => sum + (stop.segment_distance_km || 0), 0) + terminalDistanceKm
        : (toNumber(tour.remaining_distance_km) ?? (remainingFromStops + terminalDistanceKm));
    const remainingDuration = durationToNextStop !== null
        ? durationToNextStop + stops.filter(stop => !isStopDone(stop) && stop.id !== nextStop?.id).reduce((sum, stop) => sum + (stop.segment_duration_seconds || 0), 0) + terminalDurationSeconds
        : Number(tour.remaining_duration_seconds || terminalDurationSeconds || 0);

    return {
        tourId: tour.id,
        status: tour.tour_status || (tour.is_closed ? 'COMPLETED' : (tour.is_current ? 'IN_PROGRESS' : 'PLANNED')),
        nextStop,
        terminal,
        plannedDistance,
        plannedDuration,
        completedDistance,
        remainingDistance,
        remainingDuration,
        distanceToNextStop,
        durationToNextStop,
        latestLocation,
        locationStale: Boolean(latestLocation && !hasFreshLocation),
        routeStatus: tour.route_status || 'NOT_CALCULATED'
    };
}

module.exports = {
    calculateProgress,
    calculateTourRoute,
    buildRoutePoints,
    getNextStop,
    isStopDone,
    isDuplicateTerminal,
    navigationUrl,
    normalizeStop,
    normalizeTerminalMode,
    resolveTerminal,
    STALE_LOCATION_MS
};
