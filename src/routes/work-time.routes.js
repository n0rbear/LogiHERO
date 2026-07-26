const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const { requireDeviceAuth } = require('../middleware/requireDeviceAuth');
const renderAdminLayout = require('../utils/admin-layout');
const { escapeHtml } = require('../utils/escape');
const {
    WORK_TIME_STATUSES,
    APPROVAL_STATUSES,
    normalizeWorkStatus,
    assertTransition,
    summarizeEntries
} = require('../utils/work-time-status');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const nowMs = () => Date.now();
const dayText = (value = nowMs()) => new Date(Number(value)).toISOString().slice(0, 10);
const fmt = (value) => value ? new Date(Number(value)).toLocaleString('hu-HU') : '-';
const hm = (ms) => {
    const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
    return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
};
const scriptJson = (value) => JSON.stringify(value ?? '').replace(/</g, '\\u003c');
const MS_DAY = 24 * 60 * 60 * 1000;

function weekStart(value = new Date()) {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date;
}

function csvSafe(value) {
    const raw = String(value ?? '');
    const escaped = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${escaped.replace(/"/g, '""')}"`;
}

function exportRowsToCsv(rows) {
    const headers = ['driver', 'date', 'start', 'end', 'total_ms', 'driving_ms', 'work_ms', 'break_ms', 'rest_ms', 'availability_ms', 'approval_status', 'corrected', 'anomalies', 'tour', 'revision', 'updated_at'];
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push([
            row.driver_name,
            row.work_date,
            row.start_time,
            row.end_time || '',
            row.total_work_ms || 0,
            row.driving_ms || 0,
            Math.max(0, Number(row.total_work_ms || 0) - Number(row.driving_ms || 0) - Number(row.break_ms || 0) - Number(row.rest_ms || 0) - Number(row.availability_ms || 0)),
            row.break_ms || 0,
            row.rest_ms || 0,
            row.availability_ms || 0,
            row.approval_status,
            row.manual_count > 0 ? 'yes' : 'no',
            (row.anomaly_flags || []).join('|'),
            row.tour_name || row.tour_uuid || '',
            row.revision,
            row.updated_at
        ].map(csvSafe).join(','));
    }
    return lines.join('\r\n');
}

function workDayWhereFromQuery(query, params) {
    const where = ['d.deleted_at IS NULL'];
    if (query.driverUuid || query.driver_uuid) {
        params.push(query.driverUuid || query.driver_uuid);
        where.push(`d.driver_uuid = $${params.length}`);
    }
    if (query.from) {
        params.push(query.from);
        where.push(`d.work_date >= $${params.length}`);
    }
    if (query.to) {
        params.push(query.to);
        where.push(`d.work_date <= $${params.length}`);
    }
    if (query.approval) {
        params.push(query.approval);
        where.push(`d.approval_status = $${params.length}`);
    }
    if (query.tourUuid || query.tour_uuid) {
        params.push(query.tourUuid || query.tour_uuid);
        where.push(`d.tour_uuid = $${params.length}`);
    }
    if (query.anomaly === 'true') where.push(`COALESCE(array_length(d.anomaly_flags, 1), 0) > 0`);
    return where;
}

async function getExportRows(query) {
    const params = [];
    const where = workDayWhereFromQuery(query, params);
    return (await pool.query(
        `SELECT d.*, t.name AS tour_name, COALESCE(e.manual_count, 0) AS manual_count
         FROM work_days d
         LEFT JOIN tours t ON t.uuid = d.tour_uuid
         LEFT JOIN (
            SELECT work_day_uuid, COUNT(*) FILTER (WHERE manual_edit = true) AS manual_count
            FROM work_time_entries WHERE deleted_at IS NULL GROUP BY work_day_uuid
         ) e ON e.work_day_uuid = d.uuid
         WHERE ${where.join(' AND ')}
         ORDER BY d.work_date ASC, d.driver_name ASC`,
        params
    )).rows;
}

function driverIdentity(req) {
    return {
        driverUuid: req.deviceAuth?.driverUuid || req.body?.driverUuid || req.body?.driver_uuid || req.query.driverUuid || req.query.driver_uuid || null,
        driverName: req.body?.driverName || req.body?.driver_name || req.query.driverName || req.query.driver_name || null
    };
}

async function loadDriver(client, identity) {
    if (identity.driverUuid) {
        if (!UUID_RE.test(String(identity.driverUuid))) return { error: 'Invalid driver UUID.' };
        const row = (await client.query('SELECT uuid, company_uuid, name, license_plate, is_active FROM drivers WHERE uuid = $1 AND deleted_at IS NULL', [identity.driverUuid])).rows[0];
        if (!row) return { error: 'Driver not found.' };
        if (!row.is_active) return { error: 'Inactive driver cannot start work time.' };
        return { driver: row };
    }
    if (!identity.driverName) return { error: 'Missing driver identity.' };
    const row = (await client.query('SELECT uuid, company_uuid, name, license_plate, is_active FROM drivers WHERE name = $1 AND deleted_at IS NULL', [identity.driverName])).rows[0];
    if (!row) return { error: 'Driver not found.' };
    if (!row.is_active) return { error: 'Inactive driver cannot start work time.' };
    return { driver: row };
}

async function audit(client, req, fields) {
    await client.query(
        `INSERT INTO work_time_audit (event_uuid, work_day_uuid, entry_uuid, event_type, old_value, new_value, actor_type, actor_id, request_id, occurred_at, reason)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            fields.workDayUuid || null,
            fields.entryUuid || null,
            fields.eventType,
            fields.oldValue ? JSON.stringify(fields.oldValue) : null,
            fields.newValue ? JSON.stringify(fields.newValue) : null,
            fields.actorType || 'SYSTEM',
            fields.actorId || null,
            req.requestId || null,
            nowMs(),
            fields.reason || null
        ]
    );
    console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} event=${fields.eventType} workDay=${fields.workDayUuid || 'n/a'} entry=${fields.entryUuid || 'n/a'}`);
}

async function openDay(client, driverUuid) {
    return (await client.query(
        `SELECT * FROM work_days
         WHERE driver_uuid = $1 AND end_time IS NULL AND deleted_at IS NULL
         ORDER BY start_time DESC LIMIT 1`,
        [driverUuid]
    )).rows[0];
}

async function openEntry(client, workDayUuid) {
    return (await client.query(
        `SELECT * FROM work_time_entries
         WHERE work_day_uuid = $1 AND end_time IS NULL AND deleted_at IS NULL
         ORDER BY start_time DESC LIMIT 1`,
        [workDayUuid]
    )).rows[0];
}

async function recalcDay(client, workDayUuid) {
    const entries = (await client.query('SELECT * FROM work_time_entries WHERE work_day_uuid = $1 AND deleted_at IS NULL ORDER BY start_time ASC', [workDayUuid])).rows;
    const summary = summarizeEntries(entries);
    await client.query(
        `UPDATE work_days SET total_work_ms = $2, driving_ms = $3, break_ms = $4, rest_ms = $5, availability_ms = $6,
            anomaly_flags = $7, updated_at = $8, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
         WHERE uuid = $1`,
        [workDayUuid, summary.totalMs, summary.drivingMs, summary.breakMs, summary.restMs, summary.availabilityMs, summary.anomalies, nowMs()]
    );
    return summary;
}

function validateTimestamp(value, fallback = nowMs()) {
    const timestamp = value == null ? fallback : Date.parse(value) || Number(value);
    if (!Number.isFinite(timestamp)) return { error: 'Invalid timestamp.' };
    if (timestamp > nowMs() + 5 * 60 * 1000) return { error: 'Future timestamp is not allowed without correction flow.' };
    return { timestamp };
}

function publicConflict(row) {
    return {
        uuid: row.uuid,
        workDayUuid: row.work_day_uuid,
        entryUuid: row.entry_uuid,
        driverUuid: row.driver_uuid,
        localRevision: row.local_revision,
        backendRevision: row.backend_revision,
        localValue: row.local_value,
        backendValue: row.backend_value,
        approvalStatus: row.approval_status,
        adminCorrection: row.admin_correction,
        reason: row.reason,
        resolutionStatus: row.resolution_status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at
    };
}

async function createConflict(client, req, fields) {
    const row = (await client.query(
        `INSERT INTO work_time_conflicts
            (work_day_uuid, entry_uuid, driver_uuid, local_revision, backend_revision, local_value, backend_value, approval_status, admin_correction, reason, resolution_status, created_at, updated_at, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UNRESOLVED',$11,$11,$12)
         RETURNING *`,
        [
            fields.workDayUuid || null,
            fields.entryUuid || null,
            fields.driverUuid,
            fields.localRevision || null,
            fields.backendRevision || null,
            JSON.stringify(fields.localValue || {}),
            JSON.stringify(fields.backendValue || {}),
            fields.approvalStatus || null,
            Boolean(fields.adminCorrection),
            fields.reason,
            nowMs(),
            req.requestId || null
        ]
    )).rows[0];
    await audit(client, req, {
        workDayUuid: fields.workDayUuid,
        entryUuid: fields.entryUuid,
        eventType: 'SYNC_CONFLICT_CREATED',
        oldValue: fields.backendValue,
        newValue: fields.localValue,
        actorType: 'DRIVER',
        actorId: fields.driverUuid,
        reason: fields.reason
    });
    console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} event=SYNC_CONFLICT_CREATED driver=${fields.driverUuid} conflict=${row.uuid} reason=${fields.reason}`);
    return row;
}

async function assertAndroidMayWriteWorkDay(client, req, workDayUuid, localRevision, localValue = {}) {
    if (!workDayUuid) return { ok: true };
    const day = (await client.query('SELECT * FROM work_days WHERE uuid = $1', [workDayUuid])).rows[0];
    if (!day) return { ok: true };
    const driverUuid = req.deviceAuth?.driverUuid;
    const adminCorrection = Boolean(day.admin_note) || (day.anomaly_flags || []).includes('ADMIN_CORRECTED');
    let status = null;
    let reason = null;
    if (String(day.driver_uuid) !== String(driverUuid)) {
        status = 403;
        reason = 'DRIVER_OWNERSHIP_FORBIDDEN';
    } else if (day.deleted_at) {
        status = 409;
        reason = 'SOFT_DELETED_RECORD';
    } else if (day.approval_status === 'APPROVED') {
        status = 409;
        reason = 'APPROVED_RECORD_LOCKED';
    } else if (adminCorrection) {
        status = 409;
        reason = 'ADMIN_CORRECTED_RECORD_LOCKED';
    } else if (localRevision && Number(day.revision || 1) !== Number(localRevision)) {
        status = 409;
        reason = 'STALE_REVISION';
    }
    if (!status) return { ok: true, day };
    const conflict = status === 409 ? await createConflict(client, req, {
        workDayUuid,
        driverUuid,
        localRevision,
        backendRevision: day.revision,
        localValue,
        backendValue: day,
        approvalStatus: day.approval_status,
        adminCorrection,
        reason
    }) : null;
    return { ok: false, status, reason, conflict };
}

router.use('/api/work-time', requireDeviceAuth);

router.get('/api/work-time/conflicts', async (req, res, next) => {
    try {
        const rows = (await pool.query(
            `SELECT * FROM work_time_conflicts
             WHERE driver_uuid = $1
             ORDER BY created_at DESC LIMIT 100`,
            [req.deviceAuth.driverUuid]
        )).rows;
        console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} event=conflict_list driver=${req.deviceAuth.driverUuid} result=ok`);
        res.json(rows.map(publicConflict));
    } catch (error) {
        next(error);
    }
});

router.get('/api/work-time/conflicts/:uuid', async (req, res, next) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid UUID.' });
    try {
        const row = (await pool.query(
            'SELECT * FROM work_time_conflicts WHERE uuid = $1 AND driver_uuid = $2',
            [req.params.uuid, req.deviceAuth.driverUuid]
        )).rows[0];
        if (!row) return res.status(404).json({ error: 'Conflict not found.' });
        res.json(publicConflict(row));
    } catch (error) {
        next(error);
    }
});

async function resolveConflict(req, res, next, action) {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid UUID.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const conflict = (await client.query(
            'SELECT * FROM work_time_conflicts WHERE uuid = $1 AND driver_uuid = $2 FOR UPDATE',
            [req.params.uuid, req.deviceAuth.driverUuid]
        )).rows[0];
        if (!conflict) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Conflict not found.' });
        }
        if (conflict.resolution_status !== 'UNRESOLVED') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'CONFLICT_ALREADY_RESOLVED', resolutionStatus: conflict.resolution_status });
        }

        const backend = conflict.backend_value || {};
        let resolutionStatus = 'DEFERRED';
        let eventType = 'SYNC_CONFLICT_DEFERRED';
        if (action === 'accept-server') {
            resolutionStatus = 'SERVER_ACCEPTED';
            eventType = 'SYNC_CONFLICT_SERVER_ACCEPTED';
            if (conflict.work_day_uuid && backend.uuid) {
                await client.query(
                    `UPDATE work_days
                     SET sync_state='SYNCED', revision=$2, updated_at=$3
                     WHERE uuid=$1 AND driver_uuid=$4`,
                    [conflict.work_day_uuid, Number(conflict.backend_revision || backend.revision || 1), nowMs(), req.deviceAuth.driverUuid]
                );
            }
        } else if (action === 'reapply-local') {
            const requiresAdmin = conflict.approval_status === 'APPROVED'
                || conflict.admin_correction
                || conflict.reason === 'SOFT_DELETED_RECORD'
                || conflict.reason === 'TIME_OVERLAP_FORBIDDEN';
            if (requiresAdmin) {
                await audit(client, req, {
                    workDayUuid: conflict.work_day_uuid,
                    entryUuid: conflict.entry_uuid,
                    eventType: 'SYNC_CONFLICT_ADMIN_REVIEW_REQUIRED',
                    oldValue: backend,
                    newValue: conflict.local_value,
                    actorType: 'DRIVER',
                    actorId: req.deviceAuth.driverUuid,
                    reason: conflict.reason
                });
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'MANUAL_REVIEW_REQUIRED', reason: conflict.reason });
            }
            resolutionStatus = 'LOCAL_REAPPLIED';
            eventType = 'SYNC_CONFLICT_LOCAL_REAPPLIED';
        }

        const updated = (await client.query(
            `UPDATE work_time_conflicts
             SET resolution_status=$2, resolved_at=$3, updated_at=$3
             WHERE uuid=$1 RETURNING *`,
            [conflict.uuid, resolutionStatus, nowMs()]
        )).rows[0];
        await audit(client, req, {
            workDayUuid: conflict.work_day_uuid,
            entryUuid: conflict.entry_uuid,
            eventType,
            oldValue: backend,
            newValue: conflict.local_value,
            actorType: 'DRIVER',
            actorId: req.deviceAuth.driverUuid,
            reason: conflict.reason
        });
        if (resolutionStatus !== 'DEFERRED') {
            await audit(client, req, {
                workDayUuid: conflict.work_day_uuid,
                entryUuid: conflict.entry_uuid,
                eventType: 'SYNC_CONFLICT_RESOLVED',
                actorType: 'DRIVER',
                actorId: req.deviceAuth.driverUuid,
                reason: resolutionStatus
            });
        }
        await client.query('COMMIT');
        console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} event=${eventType} driver=${req.deviceAuth.driverUuid} conflict=${conflict.uuid} result=ok`);
        res.json(publicConflict(updated));
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
}

router.post('/api/work-time/conflicts/:uuid/accept-server', (req, res, next) => resolveConflict(req, res, next, 'accept-server'));
router.post('/api/work-time/conflicts/:uuid/reapply-local', (req, res, next) => resolveConflict(req, res, next, 'reapply-local'));
router.post('/api/work-time/conflicts/:uuid/defer', (req, res, next) => resolveConflict(req, res, next, 'defer'));

router.get('/api/work-time/current', async (req, res, next) => {
    const client = await pool.connect();
    try {
        const loaded = await loadDriver(client, driverIdentity(req));
        if (loaded.error) return res.status(400).json({ error: loaded.error });
        const day = await openDay(client, loaded.driver.uuid);
        const entry = day ? await openEntry(client, day.uuid) : null;
        res.json({ workDay: day || null, currentEntry: entry || null });
    } catch (error) {
        next(error);
    } finally {
        client.release();
    }
});

router.post('/api/work-time/start-day', async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const loaded = await loadDriver(client, driverIdentity(req));
        if (loaded.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: loaded.error });
        }
        if (await openDay(client, loaded.driver.uuid)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Driver already has an open work day.' });
        }
        const status = normalizeWorkStatus(req.body?.status || 'WORK');
        if (!status || status === 'OFFLINE') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid starting status.' });
        }
        const time = validateTimestamp(req.body?.startTime || req.body?.start_time);
        if (time.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: time.error });
        }
        const workDate = req.body?.workDate || req.body?.work_date || dayText(time.timestamp);
        const day = (await client.query(
            `INSERT INTO work_days (uuid, company_uuid, driver_uuid, driver_name, tour_uuid, work_date, start_time, status, start_location, notes, created_at, updated_at, sync_state, revision)
             VALUES (COALESCE($1::UUID, gen_random_uuid()), $2, $3, $4, $5::UUID, $6, $7, 'OPEN', $8, $9, $10, $10, 'SYNCED', 1)
             RETURNING *`,
            [req.body?.uuid || null, loaded.driver.company_uuid, loaded.driver.uuid, loaded.driver.name, req.body?.tourUuid || req.body?.tour_uuid || null, workDate, time.timestamp, req.body?.startLocation || req.body?.start_location || null, req.body?.notes || '', nowMs()]
        )).rows[0];
        const entry = (await client.query(
            `INSERT INTO work_time_entries (uuid, work_day_uuid, company_uuid, driver_uuid, driver_name, tour_uuid, status, start_time, source, approval_status, created_at, updated_at, sync_state, revision)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::UUID, $6, $7, 'ANDROID', 'PENDING', $8, $8, 'SYNCED', 1)
             RETURNING *`,
            [day.uuid, loaded.driver.company_uuid, loaded.driver.uuid, loaded.driver.name, day.tour_uuid, status, time.timestamp, nowMs()]
        )).rows[0];
        await audit(client, req, { workDayUuid: day.uuid, entryUuid: entry.uuid, eventType: 'DAY_STARTED', newValue: { status }, actorType: 'DRIVER', actorId: loaded.driver.uuid });
        await client.query('COMMIT');
        res.status(201).json({ workDay: day, currentEntry: entry });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.post('/api/work-time/change-status', async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const loaded = await loadDriver(client, driverIdentity(req));
        if (loaded.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: loaded.error });
        }
        const day = await openDay(client, loaded.driver.uuid);
        if (!day) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No open work day.' });
        }
        const current = await openEntry(client, day.uuid);
        const transition = assertTransition(current?.status || null, req.body?.status);
        if (!transition.ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: transition.error });
        }
        const time = validateTimestamp(req.body?.startTime || req.body?.start_time);
        if (time.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: time.error });
        }
        if (current && Number(current.start_time) > time.timestamp) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'New status cannot start before current entry.' });
        }
        if (current) {
            await client.query(
                `UPDATE work_time_entries SET end_time = $2, duration_ms = $2::BIGINT - start_time, updated_at = $3, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
                 WHERE uuid = $1`,
                [current.uuid, time.timestamp, nowMs()]
            );
        }
        let entry = null;
        if (transition.to !== 'OFFLINE') {
            entry = (await client.query(
                `INSERT INTO work_time_entries (uuid, work_day_uuid, company_uuid, driver_uuid, driver_name, tour_uuid, status, start_time, source, approval_status, created_at, updated_at, sync_state, revision)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::UUID, $6, $7, 'ANDROID', 'PENDING', $8, $8, 'SYNCED', 1)
                 RETURNING *`,
                [day.uuid, loaded.driver.company_uuid, loaded.driver.uuid, loaded.driver.name, day.tour_uuid, transition.to, time.timestamp, nowMs()]
            )).rows[0];
        }
        await audit(client, req, { workDayUuid: day.uuid, entryUuid: entry?.uuid || current?.uuid, eventType: 'STATUS_CHANGED', oldValue: current, newValue: { status: transition.to }, actorType: 'DRIVER', actorId: loaded.driver.uuid });
        await recalcDay(client, day.uuid);
        await client.query('COMMIT');
        res.json({ workDayUuid: day.uuid, currentEntry: entry });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.post('/api/work-time/end-day', async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const loaded = await loadDriver(client, driverIdentity(req));
        if (loaded.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: loaded.error });
        }
        const day = await openDay(client, loaded.driver.uuid);
        if (!day) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No open work day.' });
        }
        const time = validateTimestamp(req.body?.endTime || req.body?.end_time);
        if (time.error || time.timestamp < Number(day.start_time)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: time.error || 'End time cannot be before start time.' });
        }
        const current = await openEntry(client, day.uuid);
        if (current) {
            await client.query(
                `UPDATE work_time_entries SET end_time = $2, duration_ms = $2::BIGINT - start_time, updated_at = $3, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
                 WHERE uuid = $1`,
                [current.uuid, time.timestamp, nowMs()]
            );
        }
        const summary = await recalcDay(client, day.uuid);
        const closed = (await client.query(
            `UPDATE work_days SET end_time = $2, status = 'CLOSED', end_location = $3, notes = COALESCE($4, notes),
                updated_at = $5, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
             WHERE uuid = $1 RETURNING *`,
            [day.uuid, time.timestamp, req.body?.endLocation || req.body?.end_location || null, req.body?.notes || null, nowMs()]
        )).rows[0];
        await audit(client, req, { workDayUuid: day.uuid, eventType: 'DAY_ENDED', newValue: { summary }, actorType: 'DRIVER', actorId: loaded.driver.uuid });
        await client.query('COMMIT');
        res.json({ workDay: closed, summary });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/api/work-time/days', async (req, res, next) => {
    try {
        const identity = driverIdentity(req);
        const params = [];
        const where = ['d.deleted_at IS NULL'];
        if (identity.driverUuid) {
            params.push(identity.driverUuid);
            where.push(`d.driver_uuid = $${params.length}`);
        }
        if (identity.driverName) {
            params.push(identity.driverName);
            where.push(`d.driver_name = $${params.length}`);
        }
        const result = await pool.query(`SELECT d.* FROM work_days d WHERE ${where.join(' AND ')} ORDER BY d.work_date DESC, d.start_time DESC LIMIT 100`, params);
        res.json(result.rows);
    } catch (error) {
        next(error);
    }
});

router.get('/api/work-time/days/:uuid', async (req, res, next) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid UUID.' });
    try {
        const day = (await pool.query('SELECT * FROM work_days WHERE uuid = $1 AND deleted_at IS NULL', [req.params.uuid])).rows[0];
        if (!day) return res.status(404).json({ error: 'Work day not found.' });
        const entries = (await pool.query('SELECT * FROM work_time_entries WHERE work_day_uuid = $1 AND deleted_at IS NULL ORDER BY start_time ASC', [req.params.uuid])).rows;
        res.json({ workDay: day, entries, summary: summarizeEntries(entries, day.end_time || nowMs()) });
    } catch (error) {
        next(error);
    }
});

async function correctEntry(req, res, next, actorType = 'ADMIN') {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid UUID.' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Correction reason is required.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const entry = (await client.query('SELECT * FROM work_time_entries WHERE uuid = $1 AND deleted_at IS NULL', [req.params.uuid])).rows[0];
        if (!entry) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Entry not found.' });
        }
        if (actorType === 'DRIVER') {
            const guard = await assertAndroidMayWriteWorkDay(client, req, entry.work_day_uuid, req.body?.baseRevision || req.body?.revision, req.body || {});
            if (!guard.ok) {
                await client.query('ROLLBACK');
                return res.status(guard.status).json({ error: guard.reason, conflict: guard.conflict ? publicConflict(guard.conflict) : undefined });
            }
        }
        const expectedRevision = Number(req.body?.revision || 0);
        if (expectedRevision && Number(entry.revision || 1) !== expectedRevision) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'STALE_REVISION', serverRevision: entry.revision });
        }
        const start = validateTimestamp(req.body?.startTime || req.body?.start_time, Number(entry.start_time));
        const end = validateTimestamp(req.body?.endTime || req.body?.end_time, Number(entry.end_time || nowMs()));
        const status = normalizeWorkStatus(req.body?.status || entry.status);
        if (start.error || end.error || !status || end.timestamp <= start.timestamp) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: start.error || end.error || 'Invalid correction.' });
        }
        const overlap = (await client.query(
            `SELECT uuid FROM work_time_entries
             WHERE work_day_uuid = $1 AND uuid <> $2 AND deleted_at IS NULL
               AND start_time < $4 AND COALESCE(end_time, $4) > $3
             LIMIT 1`,
            [entry.work_day_uuid, entry.uuid, start.timestamp, end.timestamp]
        )).rows[0];
        if (overlap) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Corrected entry overlaps another entry.' });
        }
        const updated = (await client.query(
                `UPDATE work_time_entries SET status = $2, start_time = $3, end_time = $4, duration_ms = $4::BIGINT - $3::BIGINT,
                manual_edit = true, correction_reason = $5, source = $6, approval_status = 'CORRECTION_REQUIRED',
                updated_at = $7, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
             WHERE uuid = $1 RETURNING *`,
            [entry.uuid, status, start.timestamp, end.timestamp, reason, actorType, nowMs()]
        )).rows[0];
        await audit(client, req, { workDayUuid: entry.work_day_uuid, entryUuid: entry.uuid, eventType: 'ENTRY_CORRECTED', oldValue: entry, newValue: updated, actorType, actorId: 'admin', reason });
        const summary = await recalcDay(client, entry.work_day_uuid);
        await client.query('COMMIT');
        res.json({ entry: updated, summary });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
}

router.post('/api/work-time/entries/:uuid/correct', (req, res, next) => correctEntry(req, res, next, 'DRIVER'));
router.post('/admin/work-time/:uuid/correct', requireAdmin, (req, res, next) => correctEntry(req, res, next, 'ADMIN'));

async function setApproval(req, res, next, status) {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid UUID.' });
    if (!APPROVAL_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid approval status.' });
    const reason = req.body?.reason || req.body?.admin_note || '';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const day = (await client.query('SELECT * FROM work_days WHERE uuid = $1 AND deleted_at IS NULL', [req.params.uuid])).rows[0];
        if (!day) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Work day not found.' });
        }
        const expectedRevision = Number(req.body?.revision || 0);
        if (expectedRevision && Number(day.revision || 1) !== expectedRevision) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'STALE_REVISION', serverRevision: day.revision });
        }
        const updated = (await client.query(
            `UPDATE work_days SET approval_status = $2, admin_note = $3, updated_at = $4,
                revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED'
             WHERE uuid = $1 RETURNING *`,
            [day.uuid, status, reason, nowMs()]
        )).rows[0];
        await client.query(`UPDATE work_time_entries SET approval_status = $2, updated_at = $3, revision = COALESCE(revision, 1) + 1, sync_state = 'SYNCED' WHERE work_day_uuid = $1`, [day.uuid, status, nowMs()]);
        await audit(client, req, { workDayUuid: day.uuid, eventType: status === 'APPROVED' ? 'DAY_APPROVED' : status === 'REJECTED' ? 'DAY_REJECTED' : 'CORRECTION_REQUIRED', oldValue: day, newValue: updated, actorType: 'ADMIN', actorId: 'admin', reason });
        await client.query('COMMIT');
        res.json({ workDay: updated });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
}

router.post('/admin/work-time/:uuid/approve', requireAdmin, (req, res, next) => setApproval(req, res, next, 'APPROVED'));
router.post('/admin/work-time/:uuid/reject', requireAdmin, (req, res, next) => setApproval(req, res, next, 'REJECTED'));
router.post('/admin/work-time/:uuid/request-correction', requireAdmin, (req, res, next) => setApproval(req, res, next, 'CORRECTION_REQUIRED'));

router.get('/admin/work-time/weekly', requireAdmin, async (req, res, next) => {
    try {
        const start = weekStart(req.query.week ? `${req.query.week}T00:00:00.000Z` : new Date());
        const end = new Date(start.getTime() + 6 * MS_DAY);
        const from = start.toISOString().slice(0, 10);
        const to = end.toISOString().slice(0, 10);
        const rows = (await pool.query(
            `SELECT d.driver_uuid, d.driver_name,
                COUNT(*) AS day_count,
                SUM(COALESCE(d.total_work_ms,0)) AS total_work_ms,
                SUM(COALESCE(d.driving_ms,0)) AS driving_ms,
                SUM(GREATEST(0, COALESCE(d.total_work_ms,0)-COALESCE(d.driving_ms,0)-COALESCE(d.break_ms,0)-COALESCE(d.rest_ms,0)-COALESCE(d.availability_ms,0))) AS work_ms,
                SUM(COALESCE(d.break_ms,0)) AS break_ms,
                SUM(COALESCE(d.rest_ms,0)) AS rest_ms,
                SUM(COALESCE(d.availability_ms,0)) AS availability_ms,
                COUNT(*) FILTER (WHERE d.end_time IS NULL OR d.status='OPEN') AS open_days,
                COUNT(*) FILTER (WHERE COALESCE(array_length(d.anomaly_flags,1),0) > 0) AS anomaly_days,
                COUNT(*) FILTER (WHERE e.manual_count > 0) AS manual_days,
                COUNT(*) FILTER (WHERE d.approval_status='PENDING') AS pending,
                COUNT(*) FILTER (WHERE d.approval_status='APPROVED') AS approved,
                COUNT(*) FILTER (WHERE d.approval_status='REJECTED') AS rejected,
                COUNT(*) FILTER (WHERE d.approval_status='CORRECTION_REQUIRED') AS correction_required
             FROM work_days d
             LEFT JOIN (
                SELECT work_day_uuid, COUNT(*) FILTER (WHERE manual_edit=true) AS manual_count
                FROM work_time_entries WHERE deleted_at IS NULL GROUP BY work_day_uuid
             ) e ON e.work_day_uuid=d.uuid
             WHERE d.deleted_at IS NULL AND d.work_date BETWEEN $1 AND $2
             GROUP BY d.driver_uuid, d.driver_name
             ORDER BY d.driver_name ASC`,
            [from, to]
        )).rows;
        console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} actor=admin role=${req.adminRole || 'FULL_ADMIN'} action=weekly_review_opened result=ok from=${from} to=${to}`);
        const prev = new Date(start.getTime() - 7 * MS_DAY).toISOString().slice(0, 10);
        const nextWeek = new Date(start.getTime() + 7 * MS_DAY).toISOString().slice(0, 10);
        const content = `
            <div style="margin-bottom:16px;"><a class="btn btn-outline" href="/admin/work-time/weekly">Heti review</a> <a class="btn btn-outline" href="/admin/work-time/export.csv">CSV export</a> <a class="btn btn-outline" href="/admin/work-time/export.json">JSON export</a></div>
            <div class="card">
                <form method="GET" style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
                    <a class="btn btn-outline" href="/admin/work-time/weekly?week=${prev}">Elozo het</a>
                    <label>Het kezdete<input type="date" name="week" value="${escapeHtml(from)}"></label>
                    <button class="btn btn-primary">Megnyitas</button>
                    <a class="btn btn-outline" href="/admin/work-time/weekly?week=${nextWeek}">Kovetkezo het</a>
                    <a class="btn btn-outline" href="/admin/work-time/export.csv?from=${from}&to=${to}">CSV export</a>
                    <a class="btn btn-outline" href="/admin/work-time/export.json?from=${from}&to=${to}">JSON export</a>
                </form>
            </div>
            <div class="card"><h3>${escapeHtml(from)} - ${escapeHtml(to)}</h3>
                <table style="width:100%; border-collapse:collapse;">
                    <thead><tr><th>Sofor</th><th>Nap</th><th>Teljes</th><th>Vezetes</th><th>Munka</th><th>Szunet</th><th>Piheno</th><th>Availability</th><th>Nyitott</th><th>Hianyos</th><th>Manual</th><th>Pending</th><th>Approved</th><th>Rejected</th><th>Correction</th></tr></thead>
                    <tbody>${rows.map(r => `<tr onclick="location.href='/admin/work-time/weekly/${r.driver_uuid}?week=${from}'" style="cursor:pointer;">
                        <td>${escapeHtml(r.driver_name)}</td><td>${escapeHtml(r.day_count)}</td><td>${hm(r.total_work_ms)}</td><td>${hm(r.driving_ms)}</td><td>${hm(r.work_ms)}</td><td>${hm(r.break_ms)}</td><td>${hm(r.rest_ms)}</td><td>${hm(r.availability_ms)}</td>
                        <td>${escapeHtml(r.open_days)}</td><td>${escapeHtml(r.anomaly_days)}</td><td>${escapeHtml(r.manual_days)}</td><td>${escapeHtml(r.pending)}</td><td>${escapeHtml(r.approved)}</td><td>${escapeHtml(r.rejected)}</td><td>${escapeHtml(r.correction_required)}</td>
                    </tr>`).join('') || '<tr><td colspan="15">Nincs adat erre a hetre.</td></tr>'}</tbody>
                </table>
            </div>`;
        res.send(renderAdminLayout({ title: 'Heti munkaido', content, activeMenu: 'worktime', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (error) {
        next(error);
    }
});

router.get('/admin/work-time/weekly/:driverUuid', requireAdmin, async (req, res, next) => {
    if (!UUID_RE.test(req.params.driverUuid)) return res.status(400).send('Invalid driver UUID.');
    try {
        const start = weekStart(req.query.week ? `${req.query.week}T00:00:00.000Z` : new Date());
        const from = start.toISOString().slice(0, 10);
        const to = new Date(start.getTime() + 6 * MS_DAY).toISOString().slice(0, 10);
        const rows = (await pool.query(
            `SELECT d.*, t.name AS tour_name, COALESCE(e.entry_count,0) AS entry_count, COALESCE(e.manual_count,0) AS manual_count
             FROM work_days d
             LEFT JOIN tours t ON t.uuid=d.tour_uuid
             LEFT JOIN (
                SELECT work_day_uuid, COUNT(*) AS entry_count, COUNT(*) FILTER (WHERE manual_edit=true) AS manual_count
                FROM work_time_entries WHERE deleted_at IS NULL GROUP BY work_day_uuid
             ) e ON e.work_day_uuid=d.uuid
             WHERE d.deleted_at IS NULL AND d.driver_uuid=$1 AND d.work_date BETWEEN $2 AND $3
             ORDER BY d.work_date ASC`,
            [req.params.driverUuid, from, to]
        )).rows;
        const total = rows.reduce((acc, r) => {
            acc.total += Number(r.total_work_ms || 0); acc.driving += Number(r.driving_ms || 0); acc.break += Number(r.break_ms || 0); acc.rest += Number(r.rest_ms || 0); acc.availability += Number(r.availability_ms || 0);
            return acc;
        }, { total: 0, driving: 0, break: 0, rest: 0, availability: 0 });
        const content = `
            <div style="margin-bottom:16px;"><a href="/admin/work-time/weekly?week=${from}">Vissza a heti osszesitohoz</a></div>
            <div class="card"><h3>${escapeHtml(rows[0]?.driver_name || 'Sofor')} - ${escapeHtml(from)} / ${escapeHtml(to)}</h3>
                <b>Heti teljes: ${hm(total.total)}</b> <b>Vezetes: ${hm(total.driving)}</b> <b>Szunet: ${hm(total.break)}</b> <b>Piheno: ${hm(total.rest)}</b> <b>Availability: ${hm(total.availability)}</b>
            </div>
            <div class="card">
                <form id="bulkForm">
                <table style="width:100%; border-collapse:collapse;"><thead><tr><th></th><th>Datum</th><th>Kezdes</th><th>Vege</th><th>Teljes</th><th>Vezetes</th><th>Munka</th><th>Szunet</th><th>Piheno</th><th>Approval</th><th>Jelzes</th><th>Tour</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td><input type="checkbox" name="days" value="${escapeHtml(r.uuid)}" ${r.status === 'OPEN' ? 'disabled' : ''}></td>
                    <td><a href="/admin/work-time/${r.uuid}">${escapeHtml(r.work_date)}</a></td><td>${escapeHtml(fmt(r.start_time))}</td><td>${escapeHtml(fmt(r.end_time))}</td><td>${hm(r.total_work_ms)}</td><td>${hm(r.driving_ms)}</td><td>${hm(Number(r.total_work_ms||0)-Number(r.driving_ms||0)-Number(r.break_ms||0)-Number(r.rest_ms||0)-Number(r.availability_ms||0))}</td><td>${hm(r.break_ms)}</td><td>${hm(r.rest_ms)}</td><td>${escapeHtml(r.approval_status)}</td><td>${[...(r.anomaly_flags||[]), r.entry_count === 0 ? 'NO_ENTRIES' : null, r.manual_count > 0 ? 'MANUAL' : null].filter(Boolean).map(a => `<span class="badge badge-delayed">${escapeHtml(a)}</span>`).join(' ')}</td><td>${escapeHtml(r.tour_name || '-')}</td>
                </tr>`).join('') || '<tr><td colspan="12">Nincs adat.</td></tr>'}</tbody></table>
                <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
                    <input name="reason" placeholder="Kozos megjegyzes / override indok">
                    <button type="button" class="btn btn-primary" onclick="bulkAction('approve')">Kijeloltek jovahagyasa</button>
                    <button type="button" class="btn btn-outline" onclick="bulkAction('reject')">Elutasitas</button>
                    <button type="button" class="btn btn-outline" onclick="bulkAction('request-correction')">Korrekcio kerese</button>
                </div>
                </form>
            </div>
            <script>
                async function bulkAction(action) {
                    if (window.isReadOnlyAdmin) return showToast('Read-only admin nem irhat.', 'error');
                    const form = document.getElementById('bulkForm');
                    const days = [...form.querySelectorAll('input[name="days"]:checked')].map(i => i.value);
                    if (!days.length) return showToast('Nincs kijelolt nap.', 'error');
                    if (!confirm('Biztosan vegrehajtod a bulk muveletet?')) return;
                    const res = await fetch('/admin/work-time/bulk/' + action, { method:'POST', headers:{'Content-Type':'application/json','x-csrf-token':window.adminCsrfToken}, body: JSON.stringify({ days, reason: form.reason.value }) });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) return showToast(body.error || 'Bulk muvelet sikertelen.', 'error');
                    showToast('Bulk muvelet kesz: ' + body.updated + ' rekord.'); setTimeout(() => location.reload(), 500);
                }
            </script>`;
        res.send(renderAdminLayout({ title: 'Sofor heti munkaido', content, activeMenu: 'worktime', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (error) {
        next(error);
    }
});

router.post('/admin/work-time/bulk/:action', requireAdmin, async (req, res, next) => {
    const map = { approve: 'APPROVED', reject: 'REJECTED', 'request-correction': 'CORRECTION_REQUIRED' };
    const status = map[req.params.action];
    if (!status) return res.status(400).json({ error: 'Invalid bulk action.' });
    const days = Array.isArray(req.body?.days) ? req.body.days.filter(id => UUID_RE.test(String(id))) : [];
    if (!days.length) return res.status(400).json({ error: 'No valid work days selected.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const rows = (await client.query('SELECT uuid, status, anomaly_flags FROM work_days WHERE uuid = ANY($1::UUID[]) AND deleted_at IS NULL', [days])).rows;
        const blocked = rows.filter(r => r.status === 'OPEN' || (r.anomaly_flags || []).includes('SYNC_CONFLICT'));
        if (blocked.length && !req.body?.override) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Some selected days require documented override.', blocked: blocked.map(r => r.uuid) });
        }
        const updated = (await client.query(
            `UPDATE work_days SET approval_status=$2, admin_note=$3, updated_at=$4, revision=COALESCE(revision,1)+1, sync_state='SYNCED'
             WHERE uuid=ANY($1::UUID[]) AND deleted_at IS NULL RETURNING uuid`,
            [days, status, req.body?.reason || null, nowMs()]
        )).rows;
        for (const row of updated) {
            await audit(client, req, { workDayUuid: row.uuid, eventType: `BULK_${status}`, actorType: 'ADMIN', actorId: 'admin', reason: req.body?.reason || null });
        }
        await client.query('COMMIT');
        console.log(`[WORK_TIME] requestId=${req.requestId || 'unknown'} actor=admin role=${req.adminRole || 'FULL_ADMIN'} action=bulk_${status.toLowerCase()} result=ok count=${updated.length}`);
        res.json({ updated: updated.length, results: updated });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

router.get('/admin/work-time/export.csv', requireAdmin, async (req, res, next) => {
    try {
        const rows = await getExportRows(req.query);
        console.log(`[WORK_TIME_EXPORT] requestId=${req.requestId || 'unknown'} actor=admin role=${req.adminRole || 'FULL_ADMIN'} format=csv driverFilter=${Boolean(req.query.driverUuid || req.query.driver_uuid)} count=${rows.length} result=ok`);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="work-time-export.csv"');
        res.setHeader('Cache-Control', 'no-store');
        res.send(exportRowsToCsv(rows));
    } catch (error) {
        next(error);
    }
});

router.get('/admin/work-time/export.json', requireAdmin, async (req, res, next) => {
    try {
        const rows = await getExportRows(req.query);
        console.log(`[WORK_TIME_EXPORT] requestId=${req.requestId || 'unknown'} actor=admin role=${req.adminRole || 'FULL_ADMIN'} format=json driverFilter=${Boolean(req.query.driverUuid || req.query.driver_uuid)} count=${rows.length} result=ok`);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ exportedAt: new Date().toISOString(), filters: req.query, count: rows.length, records: rows });
    } catch (error) {
        next(error);
    }
});

router.get('/admin/work-time', requireAdmin, async (req, res, next) => {
    try {
        const params = [];
        const where = ['d.deleted_at IS NULL'];
        if (req.query.driver) {
            params.push(`%${req.query.driver}%`);
            where.push(`d.driver_name ILIKE $${params.length}`);
        }
        if (req.query.from) {
            params.push(req.query.from);
            where.push(`d.work_date >= $${params.length}`);
        }
        if (req.query.to) {
            params.push(req.query.to);
            where.push(`d.work_date <= $${params.length}`);
        }
        if (req.query.status) {
            params.push(req.query.status);
            where.push(`d.status = $${params.length}`);
        }
        if (req.query.approval) {
            params.push(req.query.approval);
            where.push(`d.approval_status = $${params.length}`);
        }
        if (req.query.q) {
            params.push(`%${req.query.q}%`);
            where.push(`(d.driver_name ILIKE $${params.length} OR d.notes ILIKE $${params.length} OR d.admin_note ILIKE $${params.length})`);
        }
        const rows = (await pool.query(
            `SELECT d.*, t.name AS tour_name
             FROM work_days d
             LEFT JOIN tours t ON t.uuid = d.tour_uuid
             WHERE ${where.join(' AND ')}
             ORDER BY d.work_date DESC, d.start_time DESC
             LIMIT 100`,
            params
        )).rows;
        const content = `
            <div class="card">
                <form method="GET" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; align-items:end;">
                    <label>Sofor<input name="driver" value="${escapeHtml(req.query.driver || '')}"></label>
                    <label>Kezdet<input type="date" name="from" value="${escapeHtml(req.query.from || '')}"></label>
                    <label>Veg<input type="date" name="to" value="${escapeHtml(req.query.to || '')}"></label>
                    <label>Statusz<select name="status"><option value="">Mind</option>${['OPEN', 'CLOSED'].map(s => `<option ${req.query.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
                    <label>Jovahagyas<select name="approval"><option value="">Mind</option>${APPROVAL_STATUSES.map(s => `<option ${req.query.approval === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
                    <label>Kereses<input name="q" value="${escapeHtml(req.query.q || '')}"></label>
                    <button class="btn btn-primary" type="submit">Szures</button>
                </form>
            </div>
            <div class="card">
                <table style="width:100%; border-collapse:collapse;">
                    <thead><tr><th>Sofor</th><th>Datum</th><th>Kezdes</th><th>Vege</th><th>Teljes</th><th>Vezetes</th><th>Munka</th><th>Szunet</th><th>Piheno</th><th>Jovahagyas</th><th>Jelzes</th></tr></thead>
                    <tbody>${rows.map(row => `<tr onclick="location.href='/admin/work-time/${row.uuid}'" style="cursor:pointer;">
                        <td>${escapeHtml(row.driver_name)}</td><td>${escapeHtml(row.work_date)}</td><td>${escapeHtml(fmt(row.start_time))}</td><td>${escapeHtml(fmt(row.end_time))}</td>
                        <td>${hm(row.total_work_ms)}</td><td>${hm(row.driving_ms)}</td><td>${hm(row.total_work_ms - row.driving_ms - row.break_ms - row.rest_ms - row.availability_ms)}</td>
                        <td>${hm(row.break_ms)}</td><td>${hm(row.rest_ms)}</td><td><span class="badge">${escapeHtml(row.approval_status)}</span></td>
                        <td>${(row.anomaly_flags || []).map(a => `<span class="badge badge-delayed">${escapeHtml(a)}</span>`).join(' ')}</td>
                    </tr>`).join('') || '<tr><td colspan="11">Nincs munkaido adat.</td></tr>'}</tbody>
                </table>
            </div>`;
        res.send(renderAdminLayout({ title: 'Munkaido', content, activeMenu: 'worktime', csrfToken: req.adminCsrfToken }));
    } catch (error) {
        next(error);
    }
});

router.get('/admin/worktime', requireAdmin, (_req, res) => res.redirect('/admin/work-time'));

router.get('/admin/work-time/:uuid', requireAdmin, async (req, res, next) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).send('Invalid UUID.');
    try {
        const day = (await pool.query('SELECT d.*, t.name AS tour_name FROM work_days d LEFT JOIN tours t ON t.uuid = d.tour_uuid WHERE d.uuid = $1 AND d.deleted_at IS NULL', [req.params.uuid])).rows[0];
        if (!day) return res.status(404).send('Work day not found.');
        const entries = (await pool.query('SELECT * FROM work_time_entries WHERE work_day_uuid = $1 AND deleted_at IS NULL ORDER BY start_time ASC', [day.uuid])).rows;
        const audits = (await pool.query('SELECT * FROM work_time_audit WHERE work_day_uuid = $1 ORDER BY occurred_at ASC', [day.uuid])).rows;
        const summary = summarizeEntries(entries, day.end_time || nowMs());
        const content = `
            <div style="margin-bottom:16px;"><a href="/admin/work-time">Vissza</a></div>
            <div class="card">
                <h3>${escapeHtml(day.driver_name)} - ${escapeHtml(day.work_date)}</h3>
                <p>Tour: ${escapeHtml(day.tour_name || day.tour_uuid || '-')} | Revision: ${escapeHtml(day.revision)} | Status: ${escapeHtml(day.status)} | Approval: ${escapeHtml(day.approval_status)}</p>
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px;">
                    <b>Teljes: ${hm(summary.totalMs)}</b><b>Vezetes: ${hm(summary.drivingMs)}</b><b>Munka: ${hm(summary.workMs)}</b><b>Szunet: ${hm(summary.breakMs)}</b><b>Piheno: ${hm(summary.restMs)}</b>
                </div>
            </div>
            <div class="card">
                <h3>Timeline</h3>
                ${entries.map(e => `<div style="border-left:4px solid #3498db; padding:10px 16px; margin:10px 0;">
                    <b>${escapeHtml(e.status)}</b> ${escapeHtml(fmt(e.start_time))} - ${escapeHtml(fmt(e.end_time))}
                    <span class="badge">${escapeHtml(e.source || '')}</span> <span class="badge">${escapeHtml(e.approval_status || '')}</span>
                    ${e.manual_edit ? '<span class="badge badge-delayed">MANUAL</span>' : ''}
                    <form onsubmit="return correctEntry(event, '${escapeHtml(e.uuid)}', ${Number(e.revision || 1)})" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-top:8px;">
                        <select name="status">${Object.keys(WORK_TIME_STATUSES).filter(s => s !== 'OFFLINE').map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
                        <input name="startTime" type="datetime-local" value="${new Date(Number(e.start_time)).toISOString().slice(0,16)}">
                        <input name="endTime" type="datetime-local" value="${e.end_time ? new Date(Number(e.end_time)).toISOString().slice(0,16) : ''}">
                        <input name="reason" placeholder="Indoklas kotelezo">
                        <button class="btn btn-outline" type="submit">Korrekcio</button>
                    </form>
                </div>`).join('')}
            </div>
            <div class="card">
                <form onsubmit="return approveDay(event, 'approve')"><input type="hidden" name="revision" value="${escapeHtml(day.revision)}"><input name="reason" placeholder="Megjegyzes"><button class="btn btn-primary">Jovahagyas</button></form>
                <form onsubmit="return approveDay(event, 'reject')" style="margin-top:8px;"><input type="hidden" name="revision" value="${escapeHtml(day.revision)}"><input name="reason" placeholder="Elutasitas oka"><button class="btn btn-outline">Elutasitas</button></form>
            </div>
            <div class="card"><h3>Audit history</h3>${audits.map(a => `<div><b>${escapeHtml(a.event_type)}</b> ${escapeHtml(fmt(a.occurred_at))} ${escapeHtml(a.reason || '')}</div>`).join('') || 'Nincs audit.'}</div>
            <script>
                async function correctEntry(event, uuid, revision) {
                    event.preventDefault();
                    const data = Object.fromEntries(new FormData(event.target).entries());
                    data.revision = revision;
                    const res = await fetch('/admin/work-time/' + uuid + '/correct', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-csrf-token': window.adminCsrfToken }, body: JSON.stringify(data) });
                    if (!res.ok) return showToast((await res.json()).error || 'Hiba', 'error'), false;
                    showToast('Korrekcio mentve.'); setTimeout(() => location.reload(), 400); return false;
                }
                async function approveDay(event, action) {
                    event.preventDefault();
                    const data = Object.fromEntries(new FormData(event.target).entries());
                    const res = await fetch('/admin/work-time/${scriptJson(day.uuid).slice(1, -1)}/' + action, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-csrf-token': window.adminCsrfToken }, body: JSON.stringify(data) });
                    if (!res.ok) return showToast((await res.json()).error || 'Hiba', 'error'), false;
                    showToast('Allapot mentve.'); setTimeout(() => location.reload(), 400); return false;
                }
            </script>`;
        res.send(renderAdminLayout({ title: 'Munkaido adatlap', content, activeMenu: 'worktime', csrfToken: req.adminCsrfToken }));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
