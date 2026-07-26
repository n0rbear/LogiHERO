const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
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

function driverIdentity(req) {
    return {
        driverUuid: req.body?.driverUuid || req.body?.driver_uuid || req.query.driverUuid || req.query.driver_uuid || null,
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
