const requireAdmin = require('../middleware/requireAdmin');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');

function requireAdminOrDeviceAuth(req, res, next) {
    if (req.headers['x-device-id'] || req.headers['x-device-token'] || req.headers['x-driver-uuid']) {
        return requireDeviceAuth(req, res, next);
    }
    requireAdmin(req, res, (adminError) => {
        if (adminError) return next(adminError);
        if (req.adminRole || (!ADMIN_TOKEN && !IS_DEPLOYED)) return next();
        return requireDeviceAuth(req, res, next);
    });
}

function isAdminRequest(req) {
    return !!req.adminRole || (!ADMIN_TOKEN && !IS_DEPLOYED);
}

function normalizedText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function driverNameMatches(req, value) {
    const expected = normalizedText(req.deviceAuth?.driverName).toLowerCase();
    const actual = normalizedText(value).toLowerCase();
    return !!expected && !!actual && expected === actual;
}

function driverUuidMatches(req, value) {
    const expected = normalizedText(req.deviceAuth?.driverUuid).toLowerCase();
    const actual = normalizedText(value).toLowerCase();
    return !!expected && !!actual && expected === actual;
}

function rejectScope(res, error = 'DRIVER_SCOPE_DENIED') {
    return res.status(403).json({ error });
}

function requireOwnDriverName(req, res, value) {
    if (!driverNameMatches(req, value)) return rejectScope(res);
    return null;
}

function requireOwnDriverUuid(req, res, value) {
    if (!driverUuidMatches(req, value)) return rejectScope(res);
    return null;
}

async function ensureTourOwned(poolOrClient, req, tourId) {
    const result = await poolOrClient.query(
        `SELECT id
         FROM tours
         WHERE id = $1
           AND deleted_at IS NULL
           AND (driver_uuid = $2::uuid OR (driver_uuid IS NULL AND driver_name = $3))
           AND ($4::uuid IS NULL OR company_uuid IS NULL OR company_uuid = $4::uuid)
         LIMIT 1`,
        [tourId, req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid || null]
    );
    return !!result.rows[0];
}

async function ensureTourUuidOwned(poolOrClient, req, tourUuid) {
    const result = await poolOrClient.query(
        `SELECT id
         FROM tours
         WHERE uuid::text = $1
           AND deleted_at IS NULL
           AND (driver_uuid = $2::uuid OR (driver_uuid IS NULL AND driver_name = $3))
           AND ($4::uuid IS NULL OR company_uuid IS NULL OR company_uuid = $4::uuid)
         LIMIT 1`,
        [tourUuid, req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid || null]
    );
    return !!result.rows[0];
}

async function ensureHotelOwned(poolOrClient, req, hotelId) {
    const result = await poolOrClient.query(
        `SELECT h.id
         FROM hotels h
         LEFT JOIN tours t ON t.id = h.tour_id
         WHERE h.id = $1
           AND h.deleted_at IS NULL
           AND (
                h.driver_name = $2
                OR t.driver_uuid = $3::uuid
                OR (t.driver_uuid IS NULL AND t.driver_name = $2)
           )
           AND ($4::uuid IS NULL OR t.company_uuid IS NULL OR t.company_uuid = $4::uuid)
         LIMIT 1`,
        [hotelId, req.deviceAuth.driverName, req.deviceAuth.driverUuid, req.deviceAuth.companyUuid || null]
    );
    return !!result.rows[0];
}

async function ensureCargoOwned(poolOrClient, req, cargoId) {
    const result = await poolOrClient.query(
        `SELECT c.id
         FROM cargo c
         JOIN tours t ON t.id = c.tour_id
         WHERE c.id = $1
           AND c.deleted_at IS NULL
           AND t.deleted_at IS NULL
           AND (t.driver_uuid = $2::uuid OR (t.driver_uuid IS NULL AND t.driver_name = $3))
           AND ($4::uuid IS NULL OR t.company_uuid IS NULL OR t.company_uuid = $4::uuid)
         LIMIT 1`,
        [cargoId, req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid || null]
    );
    return !!result.rows[0];
}

async function ensureExistingUuidOwned(poolOrClient, req, table, uuid) {
    if (!uuid) return true;
    const result = await poolOrClient.query(
        `SELECT driver_uuid, driver_name, company_uuid
         FROM ${table}
         WHERE uuid::text = $1
         LIMIT 1`,
        [uuid]
    );
    const row = result.rows[0];
    if (!row) return true;
    const ownsDriver = normalizedText(row.driver_uuid).toLowerCase() === normalizedText(req.deviceAuth.driverUuid).toLowerCase()
        || (!row.driver_uuid && normalizedText(row.driver_name).toLowerCase() === normalizedText(req.deviceAuth.driverName).toLowerCase());
    const ownsCompany = !req.deviceAuth.companyUuid
        || !row.company_uuid
        || normalizedText(row.company_uuid).toLowerCase() === normalizedText(req.deviceAuth.companyUuid).toLowerCase();
    return ownsDriver && ownsCompany;
}

module.exports = {
    requireAdminOrDeviceAuth,
    isAdminRequest,
    normalizedText,
    driverNameMatches,
    driverUuidMatches,
    rejectScope,
    requireOwnDriverName,
    requireOwnDriverUuid,
    ensureTourOwned,
    ensureTourUuidOwned,
    ensureHotelOwned,
    ensureCargoOwned,
    ensureExistingUuidOwned
};
