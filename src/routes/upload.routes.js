const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../database/pool');
const { MAX_UPLOAD_BYTES } = require('../config/env');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');

const uploadRoutes = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uploadDirectory() {
    return path.resolve(process.env.LOGIHERO_UPLOAD_DIR || 'uploads');
}

function normalizeOptionalText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function validateUuid(value, label) {
    const text = normalizeOptionalText(value);
    if (!text || !UUID_RE.test(text)) {
        const error = new Error(`${label} must be a valid UUID`);
        error.status = 400;
        error.publicMessage = 'Invalid UUID';
        throw error;
    }
    return text;
}

function decodeUploadImage(imageBase64) {
    if (!imageBase64) {
        const error = new Error('Missing image data');
        error.status = 400;
        error.publicMessage = 'No image data';
        throw error;
    }

    const normalizedBase64 = String(imageBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(normalizedBase64)) {
        const error = new Error('Invalid base64 data');
        error.status = 400;
        error.publicMessage = 'Invalid base64 data';
        throw error;
    }

    const buffer = Buffer.from(normalizedBase64, 'base64');
    if (buffer.length === 0) {
        const error = new Error('Invalid base64 data');
        error.status = 400;
        error.publicMessage = 'Invalid base64 data';
        throw error;
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
        const error = new Error('Image too large');
        error.status = 413;
        error.publicMessage = 'Image too large';
        throw error;
    }

    let ext = null;
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
    if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ext = 'png';
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
    if (!ext) {
        const error = new Error('Unsupported image type');
        error.status = 400;
        error.publicMessage = 'Unsupported image type';
        throw error;
    }

    return { buffer, ext };
}

async function writeUploadFile(prefix, ext, buffer) {
    const dir = uploadDirectory();
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${prefix}_${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
    return { fileName, filePath, photoUrl: `/uploads/${fileName}` };
}

async function removeUploadFile(filePath) {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (_error) {
        // Best-effort cleanup after a database write refusal.
    }
}

function denyDriverScope(res) {
    return res.status(403).json({ error: 'DRIVER_SCOPE_DENIED' });
}

function assertBodyDriverMatchesAuth(req, res) {
    const bodyDriverUuid = normalizeOptionalText(req.body?.uuid || req.body?.driverUuid || req.body?.driver_uuid);
    const bodyDriverName = normalizeOptionalText(req.body?.driverName || req.body?.driver_name);

    if (bodyDriverUuid && bodyDriverUuid !== req.deviceAuth.driverUuid) {
        denyDriverScope(res);
        return false;
    }
    if (bodyDriverName && bodyDriverName !== req.deviceAuth.driverName) {
        denyDriverScope(res);
        return false;
    }
    return true;
}

function handleUploadError(error, res, next, label) {
    if (error.status) return res.status(error.status).send(error.publicMessage || 'Upload rejected');
    console.error(`[${label}] ${error.message}`);
    return next(error);
}

uploadRoutes.post('/api/upload-photo', requireDeviceAuth, async (req, res, next) => {
    let writtenFile = null;
    try {
        if (!assertBodyDriverMatchesAuth(req, res)) return;

        const { buffer, ext } = decodeUploadImage(req.body?.imageBase64);
        writtenFile = await writeUploadFile('photo', ext, buffer);

        const now = Date.now();
        const result = await pool.query(
            `UPDATE drivers
             SET photo_url = $1,
                 profile_updated_at = $2,
                 updated_at = $2,
                 sync_state = 'PENDING',
                 revision = COALESCE(revision, 1) + 1
             WHERE uuid = $3::uuid
               AND deleted_at IS NULL
               AND is_active = TRUE
             RETURNING uuid`,
            [writtenFile.photoUrl, now, req.deviceAuth.driverUuid]
        );

        if (result.rowCount === 0) {
            await removeUploadFile(writtenFile.filePath);
            return res.status(404).json({ error: 'DRIVER_NOT_FOUND' });
        }

        return res.json({ photoUrl: writtenFile.photoUrl, profileUpdatedAt: now });
    } catch (error) {
        await removeUploadFile(writtenFile?.filePath);
        return handleUploadError(error, res, next, 'UPLOAD-ERROR');
    }
});

function stopBelongsToAuthenticatedDriver(stop, auth) {
    if (!stop) return false;
    if (stop.tour_driver_uuid && stop.tour_driver_uuid !== auth.driverUuid) return false;
    if (stop.stop_driver_uuid && stop.stop_driver_uuid !== auth.driverUuid) return false;
    if (!stop.tour_driver_uuid && !stop.stop_driver_uuid && stop.tour_driver_name !== auth.driverName) return false;
    if (auth.companyUuid && stop.tour_company_uuid && stop.tour_company_uuid !== auth.companyUuid) return false;
    if (auth.companyUuid && stop.stop_company_uuid && stop.stop_company_uuid !== auth.companyUuid) return false;
    return true;
}

function assertOptionalStopContextMatches(req, stop, res) {
    const bodyTourUuid = normalizeOptionalText(req.body?.tourUuid || req.body?.tour_uuid);
    const bodyTourId = normalizeOptionalText(req.body?.tourId || req.body?.tour_id);
    if (bodyTourUuid && bodyTourUuid !== stop.tour_uuid) {
        denyDriverScope(res);
        return false;
    }
    if (bodyTourId && String(bodyTourId) !== String(stop.tour_id)) {
        denyDriverScope(res);
        return false;
    }
    return true;
}

uploadRoutes.post('/api/upload-stop-photo', requireDeviceAuth, async (req, res, next) => {
    let writtenFile = null;
    try {
        if (!assertBodyDriverMatchesAuth(req, res)) return;

        const stopUuid = validateUuid(req.body?.stopUuid || req.body?.stop_uuid, 'stopUuid');
        const stopResult = await pool.query(
            `SELECT s.id,
                    s.uuid::text AS stop_uuid,
                    s.tour_id,
                    s.driver_uuid::text AS stop_driver_uuid,
                    s.company_uuid::text AS stop_company_uuid,
                    t.uuid::text AS tour_uuid,
                    t.driver_uuid::text AS tour_driver_uuid,
                    t.driver_name AS tour_driver_name,
                    t.company_uuid::text AS tour_company_uuid
             FROM stops s
             JOIN tours t ON t.id = s.tour_id
             WHERE s.uuid::text = $1
               AND s.deleted_at IS NULL
               AND t.deleted_at IS NULL
             LIMIT 1`,
            [stopUuid]
        );
        const stop = stopResult.rows[0];
        if (!stop) return res.status(404).json({ error: 'STOP_NOT_FOUND' });
        if (!stopBelongsToAuthenticatedDriver(stop, req.deviceAuth)) return denyDriverScope(res);
        if (!assertOptionalStopContextMatches(req, stop, res)) return;

        const { buffer, ext } = decodeUploadImage(req.body?.imageBase64);
        writtenFile = await writeUploadFile('stop', ext, buffer);

        const now = Date.now();
        const updateResult = await pool.query(
            `UPDATE stops s
             SET photo_url = $1,
                 updated_at = $2,
                 sync_state = 'PENDING',
                 revision = COALESCE(s.revision, 1) + 1
             FROM tours t
             WHERE s.tour_id = t.id
               AND s.uuid::text = $3
               AND s.deleted_at IS NULL
               AND t.deleted_at IS NULL
               AND (t.driver_uuid = $4::uuid OR (t.driver_uuid IS NULL AND s.driver_uuid IS NULL AND t.driver_name = $5))
               AND (s.driver_uuid IS NULL OR s.driver_uuid = $4::uuid)
               AND ($6::uuid IS NULL OR t.company_uuid IS NULL OR t.company_uuid = $6::uuid)
               AND ($6::uuid IS NULL OR s.company_uuid IS NULL OR s.company_uuid = $6::uuid)
             RETURNING s.uuid`,
            [writtenFile.photoUrl, now, stopUuid, req.deviceAuth.driverUuid, req.deviceAuth.driverName, req.deviceAuth.companyUuid]
        );
        if (updateResult.rowCount === 0) {
            await removeUploadFile(writtenFile.filePath);
            return res.status(404).json({ error: 'STOP_NOT_FOUND' });
        }

        return res.json({ photoUrl: writtenFile.photoUrl, updatedAt: now });
    } catch (error) {
        await removeUploadFile(writtenFile?.filePath);
        return handleUploadError(error, res, next, 'STOP-UPLOAD-ERROR');
    }
});

module.exports = {
    uploadRoutes
};
