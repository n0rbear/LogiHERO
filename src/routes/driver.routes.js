const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const crypto = require('node:crypto');
const { generateDeviceToken, hashToken } = require('../middleware/requireDeviceAuth');

const driverProfileRoutes = express.Router();
const driverReadRoutes = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const textOrNull = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const numberOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

function sanitizeAdminDriver(body) {
    const d = body || {};
    const name = textOrNull(d.name);
    const email = textOrNull(d.email);
    if (!name) throw Object.assign(new Error('A név kötelező.'), { statusCode: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Hibás email cím.'), { statusCode: 400 });
    if (d.uuid && !UUID_RE.test(d.uuid)) throw Object.assign(new Error('Hibás sofőr UUID.'), { statusCode: 400 });
    return {
        uuid: d.uuid || null,
        name,
        email,
        phone: textOrNull(d.phone),
        whatsapp: textOrNull(d.whatsapp),
        telegram: textOrNull(d.telegram),
        license_plate: textOrNull(d.license_plate),
        photo_url: textOrNull(d.photo_url),
        is_active: d.is_active === true || d.is_active === 'true' || d.is_active === 'on',
        home_lat: numberOrNull(d.home_lat),
        home_lng: numberOrNull(d.home_lng),
        base_lat: numberOrNull(d.base_lat),
        base_lng: numberOrNull(d.base_lng)
    };
}

driverProfileRoutes.post('/api/activate-driver', async (req, res) => {
    const { code, deviceId, deviceName } = req.body;
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE activation_code = $1 AND is_active = true', [code]);
        if (result.rows.length === 0) return res.status(404).send('Érvénytelen vagy inaktív aktiváló kód.');
        const driver = result.rows[0];
        const now = Date.now();
        const deviceToken = generateDeviceToken();
        if (deviceId) {
            await pool.query(
                `INSERT INTO driver_devices (driver_uuid, device_id, device_name, is_active, linked_at, last_seen_at, device_token_hash, token_rotated_at, updated_at, sync_state, revision)
                 VALUES ($1, $2, $3, true, $4, $4, $5, $4, $4, 'SYNCED', 1)
                 ON CONFLICT (device_id) DO UPDATE SET
                    driver_uuid = EXCLUDED.driver_uuid,
                    device_name = EXCLUDED.device_name,
                    is_active = true,
                    last_seen_at = EXCLUDED.last_seen_at,
                    device_token_hash = EXCLUDED.device_token_hash,
                    token_rotated_at = EXCLUDED.token_rotated_at,
                    updated_at = EXCLUDED.updated_at,
                    revision = COALESCE(driver_devices.revision, 1) + 1`,
                [driver.uuid, deviceId, deviceName || 'Android telefon', now, hashToken(deviceToken)]
            );
        }
        res.json({ ...driver, deviceToken });
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/api/unlink-device', async (req, res) => {
    const { uuid, deviceId } = req.body;
    if (!deviceId) return res.status(400).send('Missing deviceId');
    try {
        if (uuid) {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2 AND driver_uuid = $3', [Date.now(), deviceId, uuid]);
        } else {
            await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE device_id = $2', [Date.now(), deviceId]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/api/sync-profile', async (req, res) => {
    const d = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Először próbáljuk meg UUID alapján azonosítani, ha az app küldi
        let driverRes;
        if (d.uuid) {
            driverRes = await client.query('SELECT * FROM drivers WHERE uuid = $1', [d.uuid]);
        } else {
            // Ha nincs UUID, akkor név alapján keressük (visszafelé kompatibilitás)
            driverRes = await client.query('SELECT * FROM drivers WHERE name = $1', [d.name]);
        }

        const driver = driverRes.rows[0];
        const incomingUpdatedAt = Number(d.profileUpdatedAt || d.profile_updated_at || 0);
        const now = Date.now();

        if (driver) {
            const serverUpdatedAt = Number(driver.profile_updated_at || 0);
            if (incomingUpdatedAt > 0 && serverUpdatedAt > incomingUpdatedAt) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'PROFILE_CHANGED_ON_SERVER', profile: driver });
            }
            const oldName = driver.name;
            await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=true, profile_updated_at=$8, updated_at=$8, sync_state='SYNCED', revision=COALESCE(revision,1)+1
                 WHERE uuid=$9`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, now, driver.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is
            if (oldName !== d.name) {
                console.log(`[RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
        } else {
            // Új sofőr beszúrása (csak ha tényleg nem létezik)
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, is_active, profile_updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.licensePlate, d.photoUrl, code, now]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, profileUpdatedAt: now });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[SYNC-PROFILE-ERROR] ${e.message}`);
        res.status(500).send(e.message);
    } finally {
        client.release();
    }
});

driverProfileRoutes.get('/api/get-profile/:name', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE name = $1', [req.params.name]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.get('/api/get-profile-by-uuid/:uuid', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid]);
        if (result.rows.length === 0) return res.status(404).send('Driver not found');
        res.json(result.rows[0]);
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/admin/unlink-driver-devices', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).send('Missing driver uuid');
    try {
        await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1 WHERE driver_uuid = $2', [Date.now(), uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

driverProfileRoutes.post('/admin/save-driver', requireAdmin, async (req, res) => {
    let d;
    try {
        d = sanitizeAdminDriver(req.body);
    } catch (e) {
        return res.status(e.statusCode || 400).json({ error: e.message });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (d.uuid) {
            // Régi név lekérése a módosítás előtt
            const oldRes = await client.query('SELECT name FROM drivers WHERE uuid = $1', [d.uuid]);
            if (!oldRes.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Sofőr nem található.' });
            }
            const oldName = oldRes.rows[0]?.name;

            const updated = await client.query(
                `UPDATE drivers SET name=$1, email=$2, phone=$3, whatsapp=$4, telegram=$5, license_plate=$6, photo_url=COALESCE(NULLIF($7, ''), photo_url), is_active=$8, home_lat=$9, home_lng=$10, base_lat=$11, base_lng=$12, profile_updated_at=$13, updated_at=$13, sync_state='SYNCED', revision=COALESCE(revision,1)+1 WHERE uuid=$14`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, d.is_active, d.home_lat, d.home_lng, d.base_lat, d.base_lng, Date.now(), d.uuid]
            );

            // Ha megváltozott a név, frissítsük az összes kapcsolódó táblát is (cascade)
            if (oldName && oldName !== d.name) {
                console.log(`[ADMIN-RENAME] Cascading name change: ${oldName} -> ${d.name}`);
                const tables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours'];
                for (const t of tables) {
                    await client.query(`UPDATE ${t} SET driver_name = $1 WHERE driver_name = $2`, [d.name, oldName]);
                }
            }
            await client.query('COMMIT');
            return res.json({ success: true, uuid: d.uuid, updated: updated.rowCount });
        } else {
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            const inserted = await client.query(
                `INSERT INTO drivers (name, email, phone, whatsapp, telegram, license_plate, photo_url, activation_code, is_active, home_lat, home_lng, base_lat, base_lng, profile_updated_at, created_at, updated_at, sync_state, revision)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $14, 'SYNCED', 1)
                 RETURNING uuid`,
                [d.name, d.email, d.phone, d.whatsapp, d.telegram, d.license_plate, d.photo_url, code, d.is_active, d.home_lat, d.home_lng, d.base_lat, d.base_lng, Date.now()]
            );
            await client.query('COMMIT');
            return res.json({ success: true, uuid: inserted.rows[0].uuid, activation_code: code });
        }
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[ADMIN-SAVE-ERROR] ${e.message}`);
        res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'A sofőr neve vagy aktiváló kódja már létezik.' : e.message });
    } finally {
        client.release();
    }
});

driverProfileRoutes.post('/admin/delete-driver', requireAdmin, async (req, res) => {
    const { uuid } = req.body;
    if (!UUID_RE.test(uuid || '')) return res.status(400).json({ error: 'Hibás sofőr UUID.' });
    try {
        const result = await pool.query('UPDATE drivers SET is_active = false, profile_updated_at = $1, updated_at = $1, sync_state = $2, revision = COALESCE(revision,1)+1 WHERE uuid = $3 RETURNING uuid', [Date.now(), 'SYNCED', uuid]);
        if (!result.rows[0]) return res.status(404).json({ error: 'Sofőr nem található.' });
        await pool.query('UPDATE driver_devices SET is_active = false, last_seen_at = $1, updated_at = $1, sync_state = $2, revision = COALESCE(revision,1)+1 WHERE driver_uuid = $3', [Date.now(), 'SYNCED', uuid]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

driverReadRoutes.get('/api/all-drivers', async (req, res) => {
    const result = await pool.query('SELECT * FROM drivers ORDER BY name ASC');
    res.json(result.rows);
});

module.exports = {
    driverProfileRoutes,
    driverReadRoutes
};
