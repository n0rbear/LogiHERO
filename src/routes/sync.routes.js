const express = require('express');
const pool = require('../database/pool');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const { SYNC_TABLES } = require('../utils/sync-models');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVER_ONLY_FIELDS = new Set([
    'activation_code',
    'is_active',
    'admin_note',
    'approval_status',
    'manual_edit',
    'correction_reason'
]);
// Entity-specific fields with a dedicated lifecycle workflow (status transitions, audit
// logging, terminal-state locks) that generic sync must not be able to set directly.
const ENTITY_LOCKED_FIELDS = {
    costs: ['status'],
    hotels: ['status', 'deleted_at'],
    // Confirmed unused by any current Android call site (only `work_times` is ever pushed
    // through generic sync; tours/stops lifecycle sync exclusively uses the dedicated
    // POST /api/sync-tours/:driverName route). Blocking these here closes the
    // cargo/hotel completion-blocking bypass in PATCH /api/tours/:id and the
    // cargo-blocking bypass in the dedicated stop-complete endpoint, with no loss of
    // legitimate mobile functionality.
    tours: ['tour_status', 'is_closed'],
    stops: ['stop_status', 'is_completed']
};

const snake = (key) => key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const nowMs = () => Date.now();

function normalizeRecord(entityConfig, record) {
    const normalized = {};
    for (const field of entityConfig.fields) {
        if (record[field] !== undefined) normalized[field] = record[field];
        const camelName = camel(field);
        if (record[camelName] !== undefined) normalized[field] = record[camelName];
    }
    return normalized;
}

function publicRecord(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        if (SERVER_ONLY_FIELDS.has(key)) continue;
        out[key] = value;
        out[camel(key)] = value;
    }
    return out;
}

function driverScopeParams(auth) {
    return [auth.driverUuid, auth.driverName, auth.companyUuid];
}

function ownerScopeWhere(config, offset = 0, alias = '') {
    const prefix = alias ? `${alias}.` : '';
    const driverUuid = `$${offset + 1}::uuid`;
    const driverName = `$${offset + 2}`;
    const companyUuid = `$${offset + 3}::uuid`;

    if (config.entity === 'drivers') {
        return `${prefix}uuid = ${driverUuid} AND (${companyUuid} IS NULL OR ${prefix}company_uuid IS NULL OR ${prefix}company_uuid = ${companyUuid})`;
    }
    if (config.entity === 'devices') {
        return `${prefix}driver_uuid = ${driverUuid}`;
    }
    if (config.entity === 'stops') {
        return `(
            ${prefix}driver_uuid = ${driverUuid}
            OR (${prefix}driver_uuid IS NULL AND EXISTS (
                SELECT 1 FROM tours sync_scope_t
                WHERE sync_scope_t.id = ${prefix}tour_id
                  AND (sync_scope_t.driver_uuid = ${driverUuid} OR (sync_scope_t.driver_uuid IS NULL AND sync_scope_t.driver_name = ${driverName}))
                  AND (${companyUuid} IS NULL OR sync_scope_t.company_uuid IS NULL OR sync_scope_t.company_uuid = ${companyUuid})
            ))
        )
        AND (${companyUuid} IS NULL OR ${prefix}company_uuid IS NULL OR ${prefix}company_uuid = ${companyUuid})`;
    }
    return `(
        ${prefix}driver_uuid = ${driverUuid}
        OR (${prefix}driver_uuid IS NULL AND ${prefix}driver_name = ${driverName})
    )
    AND (${companyUuid} IS NULL OR ${prefix}company_uuid IS NULL OR ${prefix}company_uuid = ${companyUuid})`;
}

function recordValue(record, snakeKey) {
    return record[snakeKey] ?? record[camel(snakeKey)];
}

function rejectScope(error, uuid = null) {
    return { status: 'scope_denied', error, uuid };
}

function isWorkDayLocked(day) {
    if (!day) return false;
    return day.approval_status === 'APPROVED'
        || Boolean(day.admin_note)
        || (Array.isArray(day.anomaly_flags) && day.anomaly_flags.includes('ADMIN_CORRECTED'));
}

function assertRecordOwnerFields(config, record, auth) {
    const uuid = recordValue(record, 'uuid') || recordValue(record, 'device_id') || null;
    const companyUuid = recordValue(record, 'company_uuid');
    const driverUuid = recordValue(record, 'driver_uuid');
    const driverName = recordValue(record, 'driver_name');

    if (companyUuid && auth.companyUuid && companyUuid !== auth.companyUuid) return rejectScope('COMPANY_SCOPE_DENIED', uuid);

    if (config.entity === 'drivers') {
        if (uuid && uuid !== auth.driverUuid) return rejectScope('DRIVER_SCOPE_DENIED', uuid);
        if (driverName && driverName !== auth.driverName) return rejectScope('DRIVER_SCOPE_DENIED', uuid);
        return null;
    }

    if (config.entity === 'devices') {
        if (driverUuid && driverUuid !== auth.driverUuid) return rejectScope('DRIVER_SCOPE_DENIED', uuid);
        const deviceId = recordValue(record, 'device_id');
        if (deviceId && deviceId !== auth.deviceId) return rejectScope('DEVICE_SCOPE_DENIED', uuid);
        return null;
    }

    if (driverUuid && driverUuid !== auth.driverUuid) return rejectScope('DRIVER_SCOPE_DENIED', uuid);
    if (driverName && driverName !== auth.driverName) return rejectScope('DRIVER_SCOPE_DENIED', uuid);
    return null;
}

function applyServerScope(config, record, auth) {
    for (const field of SERVER_ONLY_FIELDS) delete record[field];
    for (const field of ENTITY_LOCKED_FIELDS[config.entity] || []) delete record[field];
    if (config.fields.includes('company_uuid')) record.company_uuid = auth.companyUuid;
    if (config.fields.includes('driver_uuid')) record.driver_uuid = auth.driverUuid;
    if (config.fields.includes('driver_name')) record.driver_name = auth.driverName;
    if (config.entity === 'drivers') {
        record.uuid = auth.driverUuid;
        if (config.fields.includes('name')) record.name = auth.driverName;
    }
    if (config.entity === 'devices') {
        record.driver_uuid = auth.driverUuid;
        record.device_id = auth.deviceId;
    }
}

async function relationOwned(client, sql, params) {
    const result = await client.query(sql, params);
    return Boolean(result.rows[0]);
}

async function loadOwnedWorkDay(client, workDayUuid, auth) {
    const result = await client.query(
        `SELECT approval_status, admin_note, anomaly_flags FROM work_days
         WHERE uuid::text = $4
           AND deleted_at IS NULL
           AND ${ownerScopeWhere(SYNC_TABLES.work_days, 0)}
         LIMIT 1`,
        [...driverScopeParams(auth), String(workDayUuid)]
    );
    return result.rows[0];
}

async function assertOwnedRelations(client, config, record, auth) {
    const params = driverScopeParams(auth);
    const tourId = recordValue(record, 'tour_id');
    if (tourId && ['stops', 'hotels', 'cargo'].includes(config.entity)) {
        const ok = await relationOwned(
            client,
            `SELECT id FROM tours
             WHERE id::text = $4
               AND deleted_at IS NULL
               AND ${ownerScopeWhere(SYNC_TABLES.tours, 0)}
             LIMIT 1`,
            [...params, String(tourId)]
        );
        if (!ok) return rejectScope('TOUR_SCOPE_DENIED', recordValue(record, 'uuid'));
    }

    const stopId = recordValue(record, 'stop_id');
    if (stopId && config.entity === 'hotels') {
        const ok = await relationOwned(
            client,
            `SELECT s.id FROM stops s
             WHERE s.id::text = $4
               AND s.deleted_at IS NULL
               AND ${ownerScopeWhere(SYNC_TABLES.stops, 0, 's')}
             LIMIT 1`,
            [...params, String(stopId)]
        );
        if (!ok) return rejectScope('STOP_SCOPE_DENIED', recordValue(record, 'uuid'));
    }

    for (const key of ['pickup_stop_uuid', 'delivery_stop_uuid']) {
        const stopUuid = recordValue(record, key);
        if (stopUuid && config.entity === 'cargo') {
            const ok = await relationOwned(
                client,
                `SELECT s.id FROM stops s
                 WHERE s.uuid::text = $4
                   AND s.deleted_at IS NULL
                   AND ${ownerScopeWhere(SYNC_TABLES.stops, 0, 's')}
                 LIMIT 1`,
                [...params, String(stopUuid)]
            );
            if (!ok) return rejectScope('STOP_SCOPE_DENIED', recordValue(record, 'uuid'));
        }
    }

    const workDayUuid = recordValue(record, 'work_day_uuid');
    if (workDayUuid && config.entity === 'work_time_entries') {
        const day = await loadOwnedWorkDay(client, workDayUuid, auth);
        if (!day) return rejectScope('WORK_DAY_SCOPE_DENIED', recordValue(record, 'uuid'));
        if (isWorkDayLocked(day)) return { status: 'rejected', error: 'WORK_DAY_LOCKED', uuid: recordValue(record, 'uuid') };
    }

    return null;
}

// For an existing entry the STORED parent decides whether it may be edited, mirroring the
// dedicated correction route, which guards on `entry.work_day_uuid` rather than on anything
// the client sends. Without this an approved day's entries stay writable by simply omitting
// work_day_uuid, or by pointing the record at some other open day.
async function assertExistingEntryUnlocked(client, existing, record, auth) {
    const storedParent = existing.work_day_uuid;
    const uuid = existing.uuid ? String(existing.uuid) : null;
    if (!storedParent) return null;

    const day = await loadOwnedWorkDay(client, storedParent, auth);
    if (!day) return rejectScope('WORK_DAY_SCOPE_DENIED', uuid);
    if (isWorkDayLocked(day)) return { status: 'rejected', error: 'WORK_DAY_LOCKED', uuid };

    const incomingParent = recordValue(record, 'work_day_uuid');
    if (incomingParent && String(incomingParent) !== String(storedParent)) {
        return { status: 'rejected', error: 'WORK_DAY_REPARENT_NOT_SUPPORTED', uuid };
    }
    return null;
}

async function logSync(client, req, { entity, uuid, direction, result, startedAt, details }) {
    const durationMs = Date.now() - startedAt;
    console.log(`[SYNC] requestId=${req.requestId || 'unknown'} entity=${entity} uuid=${uuid || 'n/a'} direction=${direction} result=${result} durationMs=${durationMs}`);
    await client.query(
        `INSERT INTO sync_events (request_id, entity, entity_uuid, direction, result, duration_ms, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.requestId || null, entity, uuid || null, direction, result, durationMs, details ? JSON.stringify(details) : null, Date.now()]
    );
}

router.get('/api/sync', requireDeviceAuth, async (req, res, next) => {
    const since = Number(req.query.since || 0);
    if (!Number.isFinite(since) || since < 0) return res.status(400).json({ error: 'Invalid since value.' });
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
        const changes = {};
        for (const config of Object.values(SYNC_TABLES)) {
            const result = await client.query(
                `SELECT ${config.fields.join(', ')} FROM ${config.table}
                 WHERE (COALESCE(${config.watermark}, 0) > $1
                    OR COALESCE(deleted_at, 0) > $1)
                   AND ${ownerScopeWhere(config, 1)}
                 ORDER BY COALESCE(${config.watermark}, 0) ASC
                 LIMIT 500`,
                [since, ...driverScopeParams(req.deviceAuth)]
            );
            changes[config.entity] = result.rows.map(publicRecord);
            await logSync(client, req, { entity: config.entity, direction: 'pull', result: 'ok', startedAt, details: { count: result.rowCount, since } });
        }
        res.json({ serverTime: Date.now(), changes });
    } catch (error) {
        next(error);
    } finally {
        client.release();
    }
});

async function applyChange(client, req, config, rawRecord, startedAt) {
    const record = normalizeRecord(config, rawRecord);
    const uuid = record.uuid || rawRecord.uuid;
    if (config.entity !== 'devices' && (!uuid || !UUID_RE.test(String(uuid)))) {
        return { status: 'rejected', error: 'Invalid UUID', uuid };
    }

    // Cargo has no mobile creation path (dispatched by admin only) and its status/lifecycle
    // is owned by dedicated pickup/deliver/report endpoints with their own audit trail and
    // terminal-state locks. Generic sync must not be able to create or mutate cargo rows.
    if (config.entity === 'cargo') {
        return { status: 'rejected', error: 'CARGO_SYNC_WRITE_NOT_SUPPORTED', uuid: uuid || null };
    }

    const keyColumn = config.entity === 'devices' ? 'device_id' : 'uuid';
    const keyValue = config.entity === 'devices' ? record.device_id || record.deviceId : uuid;
    if (!keyValue) return { status: 'rejected', error: 'Missing sync key', uuid: null };

    const ownerFieldError = assertRecordOwnerFields(config, { ...rawRecord, ...record }, req.deviceAuth);
    if (ownerFieldError) return ownerFieldError;

    const existing = (await client.query(`SELECT * FROM ${config.table} WHERE ${keyColumn}::text = $1 LIMIT 1`, [String(keyValue)])).rows[0];
    if (existing) {
        const ownedExisting = (await client.query(
            `SELECT ${keyColumn} FROM ${config.table}
             WHERE ${keyColumn}::text = $1
               AND ${ownerScopeWhere(config, 1)}
             LIMIT 1`,
            [String(keyValue), ...driverScopeParams(req.deviceAuth)]
        )).rows[0];
        if (!ownedExisting) return rejectScope('DRIVER_SCOPE_DENIED', String(keyValue));
    }

    if (existing && config.entity === 'work_days' && isWorkDayLocked(existing)) {
        return { status: 'rejected', error: 'WORK_DAY_LOCKED', uuid: String(keyValue) };
    }

    if (existing && config.entity === 'work_time_entries') {
        const lockError = await assertExistingEntryUnlocked(client, existing, { ...rawRecord, ...record }, req.deviceAuth);
        if (lockError) return lockError;
    }

    const relationError = await assertOwnedRelations(client, config, { ...rawRecord, ...record }, req.deviceAuth);
    if (relationError) return relationError;

    applyServerScope(config, record, req.deviceAuth);

    const clientRevision = Number(rawRecord.baseRevision ?? rawRecord.revision ?? record.revision ?? 0);
    if (existing && clientRevision && Number(existing.revision || 1) !== clientRevision) {
        await logSync(client, req, { entity: config.entity, uuid: String(keyValue), direction: 'push', result: 'conflict', startedAt, details: { serverRevision: existing.revision, clientRevision } });
        return { status: 'conflict', uuid: String(keyValue), server: publicRecord(existing), serverRevision: existing.revision };
    }

    const timestamp = Math.max(Number(record.updated_at || 0), nowMs());
    record.updated_at = timestamp;
    record.sync_state = 'SYNCED';
    record.revision = existing ? Number(existing.revision || 1) + 1 : Math.max(Number(record.revision || 1), 1);
    if (!existing && config.fields.includes('created_at')) record.created_at = record.created_at || timestamp;

    const fields = Object.keys(record).filter((field) => config.fields.includes(field) && record[field] !== undefined);
    if (!fields.includes(keyColumn)) fields.unshift(keyColumn);
    const values = fields.map((field) => record[field]);
    const placeholders = fields.map((_, index) => `$${index + 1}`);
    const updates = fields
        .filter((field) => field !== keyColumn)
        .map((field) => `${field} = EXCLUDED.${field}`)
        .join(', ');

    const result = await client.query(
        `INSERT INTO ${config.table} (${fields.join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (${keyColumn}) DO UPDATE SET ${updates}
         RETURNING *`,
        values
    );
    await logSync(client, req, { entity: config.entity, uuid: String(keyValue), direction: 'push', result: 'ok', startedAt, details: { revision: result.rows[0].revision } });
    return { status: 'ok', uuid: String(keyValue), record: publicRecord(result.rows[0]) };
}

router.post('/api/sync', requireDeviceAuth, async (req, res, next) => {
    const changes = req.body?.changes || req.body || {};
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
        await client.query('BEGIN');
        const applied = {};
        const conflicts = [];
        const rejected = [];
        for (const [entity, records] of Object.entries(changes)) {
            const key = snake(entity);
            const config = SYNC_TABLES[key] || Object.values(SYNC_TABLES).find((item) => item.entity === entity);
            if (!config || !Array.isArray(records)) continue;
            applied[config.entity] = [];
            for (const record of records) {
                const result = await applyChange(client, req, config, record, startedAt);
                if (result.status === 'conflict') conflicts.push({ entity: config.entity, ...result });
                else if (result.status === 'scope_denied') rejected.push({ entity: config.entity, ...result });
                else if (result.status === 'rejected') rejected.push({ entity: config.entity, ...result });
                else applied[config.entity].push(result.record);
            }
        }
        if (rejected.some((item) => item.status === 'scope_denied')) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'SYNC_SCOPE_DENIED', rejected, serverTime: Date.now() });
        }
        if (conflicts.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'SYNC_CONFLICT', conflicts, serverTime: Date.now() });
        }
        await client.query('COMMIT');
        res.json({ success: true, serverTime: Date.now(), applied, rejected });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/api/sync/version', async (_req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT MAX(v) AS version FROM (
                SELECT COALESCE(MAX(updated_at), 0) AS v FROM drivers
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM tours
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM hotels
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM cargo
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM work_times
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM work_days
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM work_time_entries
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM costs
            ) versions
        `);
        res.json({ version: Number(result.rows[0]?.version || 0), serverTime: Date.now() });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
