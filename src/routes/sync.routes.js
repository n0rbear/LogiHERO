const express = require('express');
const pool = require('../database/pool');
const { SYNC_TABLES } = require('../utils/sync-models');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        out[key] = value;
        out[camel(key)] = value;
    }
    return out;
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

router.get('/api/sync', async (req, res, next) => {
    const since = Number(req.query.since || 0);
    if (!Number.isFinite(since) || since < 0) return res.status(400).json({ error: 'Invalid since value.' });
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
        const changes = {};
        for (const config of Object.values(SYNC_TABLES)) {
            const result = await client.query(
                `SELECT ${config.fields.join(', ')} FROM ${config.table}
                 WHERE COALESCE(${config.watermark}, 0) > $1
                    OR COALESCE(deleted_at, 0) > $1
                 ORDER BY COALESCE(${config.watermark}, 0) ASC
                 LIMIT 500`,
                [since]
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

    const keyColumn = config.entity === 'devices' ? 'device_id' : 'uuid';
    const keyValue = config.entity === 'devices' ? record.device_id || record.deviceId : uuid;
    if (!keyValue) return { status: 'rejected', error: 'Missing sync key', uuid: null };

    const existing = (await client.query(`SELECT * FROM ${config.table} WHERE ${keyColumn}::text = $1 LIMIT 1`, [String(keyValue)])).rows[0];
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

router.post('/api/sync', async (req, res, next) => {
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
                else if (result.status === 'rejected') rejected.push({ entity: config.entity, ...result });
                else applied[config.entity].push(result.record);
            }
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
                UNION ALL SELECT COALESCE(MAX(updated_at), 0) FROM costs
            ) versions
        `);
        res.json({ version: Number(result.rows[0]?.version || 0), serverTime: Date.now() });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
