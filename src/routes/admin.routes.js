const express = require('express');
const pool = require('../database/pool');
const renderAdminLayout = require('../utils/admin-layout');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAdminWrite } = require('../middleware/requireAdmin');
const { generateDeviceToken, hashToken } = require('../middleware/requireDeviceAuth');
const { ADMIN_TOKEN, READ_ONLY_ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');
const { rateLimit } = require('../middleware/rate-limit');
const { escapeHtml } = require('../utils/escape');
const { renderAdminMapScript, renderAdminMapStyles } = require('../utils/admin-map');
const {
    createAdminSession,
    destroyAdminSession,
    getAdminSession,
    verifyAdminToken,
    SESSION_TTL_MS
} = require('../utils/admin-session');
const crypto = require('node:crypto');

const adminRoutes = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const input = (label, name, value = '', type = 'text', attrs = '') => `
    <div>
        <label style="display:block; margin-bottom:8px; font-weight:600;">${escapeHtml(label)}</label>
        <input type="${escapeHtml(type)}" name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" ${attrs} style="width:100%;">
    </div>
`;

const formatDateTime = (value) => value ? new Date(Number(value)).toLocaleString('hu-HU') : '—';
const scriptJson = (value) => JSON.stringify(value ?? '').replace(/</g, '\\u003c');

function renderDriverForm({ driver = {}, mode, csrfToken, error = '' }) {
    const isEdit = mode === 'edit';
    return `
        <div style="margin-bottom:24px;">
            <a href="/admin/drivers" style="text-decoration:none; color:var(--color-text-muted);">← Vissza a listához</a>
            <h3 style="margin-top:8px;">${isEdit ? `${escapeHtml(driver.name || 'Sofőr')} adatlapja` : 'Új sofőr hozzáadása'}</h3>
        </div>
        ${error ? `<div class="card" style="border-left:4px solid var(--color-error); color:var(--color-error);">${escapeHtml(error)}</div>` : ''}
        <div class="card" style="max-width:960px;">
            <form id="driverForm">
                ${isEdit ? `<input type="hidden" name="uuid" value="${escapeHtml(driver.uuid)}">` : ''}
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:20px; margin-bottom:20px;">
                    ${input('Név', 'name', driver.name, 'text', 'required maxlength="160"')}
                    ${input('Email', 'email', driver.email, 'email', 'maxlength="240"')}
                    ${input('Telefonszám', 'phone', driver.phone, 'text', 'maxlength="80"')}
                    ${input('WhatsApp', 'whatsapp', driver.whatsapp, 'text', 'maxlength="80"')}
                    ${input('Telegram', 'telegram', driver.telegram, 'text', 'maxlength="80"')}
                    ${input('Rendszám', 'license_plate', driver.license_plate, 'text', 'maxlength="40"')}
                    ${input('Profilkép URL', 'photo_url', driver.photo_url, 'url')}
                    ${input('Otthon lat.', 'home_lat', driver.home_lat, 'number', 'step="any"')}
                    ${input('Otthon lng.', 'home_lng', driver.home_lng, 'number', 'step="any"')}
                    ${input('Bázis lat.', 'base_lat', driver.base_lat, 'number', 'step="any"')}
                    ${input('Bázis lng.', 'base_lng', driver.base_lng, 'number', 'step="any"')}
                </div>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:24px;">
                    <input type="checkbox" name="is_active" ${driver.is_active !== false ? 'checked' : ''}>
                    Aktív sofőr
                </label>
                <div style="display:flex; justify-content:flex-end; gap:12px;">
                    <button type="button" class="btn btn-outline" onclick="location.href='/admin/drivers'">Mégse</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? 'Módosítások mentése' : 'Sofőr mentése'}</button>
                </div>
            </form>
        </div>
        <script>
            const driverFormIsEdit = ${isEdit ? 'true' : 'false'};
            document.getElementById('driverForm').addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = Object.fromEntries(new FormData(form).entries());
                data.is_active = form.querySelector('[name="is_active"]').checked;
                try {
                    const res = await fetch('/admin/save-driver', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': ${scriptJson(csrfToken)} },
                        body: JSON.stringify(data)
                    });
                    const payload = await res.json().catch(async () => ({ error: await res.text() }));
                    if (!res.ok) throw new Error(payload.error || 'Mentés sikertelen.');
                    showToast('Sofőr mentve.');
                    if (!driverFormIsEdit) {
                        setTimeout(() => location.href = payload.uuid ? '/admin/drivers/' + payload.uuid : '/admin/drivers', 450);
                    }
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        </script>
    `;
}

// --- 1. Public Authentication ---

adminRoutes.get('/login', (req, res) => {
    if (!ADMIN_TOKEN) {
        return res.status(503).send(`
            <div style="font-family:sans-serif; text-align:center; padding:50px;">
                <h1>⚠️ Configuration Error</h1>
                <p>ADMIN_TOKEN is not configured in the production environment.</p>
                <p>Please add the <b>ADMIN_TOKEN</b> environment variable on Render dashboard.</p>
                <hr>
                <a href="/health">System Health</a>
            </div>
        `);
    }

    const cookies = req.headers.cookie ? Object.fromEntries(req.headers.cookie.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return [name, decodeURIComponent(rest.join('='))];
    })) : {};
    if (getAdminSession(cookies['admin_session'])) return res.redirect('/admin');

    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>LogiHERO Admin | Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); width: 100%; max-width: 360px; text-align: center; }
        h2 { margin-bottom: 24px; color: #1a1c23; }
        input { width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid #e1e4e8; border-radius: 8px; box-sizing: border-box; font-size: 16px; }
        button { width: 100%; padding: 12px; background: #3498db; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 16px; }
        .error { color: #e74c3c; margin-top: 16px; font-size: 14px; display: none; }
    </style>
</head>
<body>
    <div class="card">
        <h2>LogiHERO Admin</h2>
        <form id="loginForm">
            <input type="password" id="token" placeholder="Admin Token" required autofocus>
            <button type="submit">Belépés</button>
        </form>
        <div id="errorMessage" class="error">Érvénytelen token!</div>
    </div>
    <script>
        document.getElementById('loginForm').onsubmit = async (e) => {
            e.preventDefault();
            const token = document.getElementById('token').value;
            const res = await fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            if (res.ok) {
                const urlParams = new URLSearchParams(window.location.search);
                window.location.href = urlParams.get('redirect') || '/admin';
            } else {
                document.getElementById('errorMessage').style.display = 'block';
            }
        };
    </script>
</body>
</html>`);
});

adminRoutes.post('/login', rateLimit({ name: 'admin-login', windowMs: 60_000, max: 10 }), (req, res) => {
    const { token } = req.body;
    const role = verifyAdminToken(token, ADMIN_TOKEN) ? 'FULL_ADMIN' :
        (READ_ONLY_ADMIN_TOKEN && verifyAdminToken(token, READ_ONLY_ADMIN_TOKEN) ? 'READ_ONLY' : null);
    if (role) {
        const session = createAdminSession(Date.now(), role);
        console.log(`[ADMIN_AUTH] requestId=${req.requestId || 'unknown'} actor=admin role=${role} action=login result=ok`);
        res.cookie('admin_session', session.id, {
            httpOnly: true,
            secure: IS_DEPLOYED,
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_TTL_MS
        });
        return res.json({ success: true, csrfToken: session.csrfToken });
    }
    res.sendStatus(401);
});

adminRoutes.get('/api/smoke-snapshot', requireAdmin, async (req, res, next) => {
    try {
        const queries = {
            drivers: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM drivers WHERE deleted_at IS NULL",
            driverDevices: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at, MAX(token_rotated_at)::bigint AS max_token_rotated_at FROM driver_devices WHERE deleted_at IS NULL",
            hotels: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM hotels WHERE deleted_at IS NULL",
            tours: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM tours WHERE deleted_at IS NULL",
            workDays: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM work_days WHERE deleted_at IS NULL",
            workEntries: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM work_time_entries WHERE deleted_at IS NULL",
            conflicts: "SELECT COUNT(*)::int AS count, MAX(updated_at)::bigint AS max_updated_at FROM work_time_conflicts"
        };
        const snapshot = {};
        for (const [name, sql] of Object.entries(queries)) {
            snapshot[name] = (await pool.query(sql)).rows[0] || {};
        }
        const sync = (await pool.query(`
            SELECT MAX(updated_at)::bigint AS version FROM (
                SELECT updated_at FROM drivers
                UNION ALL SELECT updated_at FROM tours
                UNION ALL SELECT updated_at FROM hotels
                UNION ALL SELECT updated_at FROM work_days
                UNION ALL SELECT updated_at FROM work_time_entries
                UNION ALL SELECT updated_at FROM work_time_conflicts
            ) v
        `)).rows[0] || {};
        console.log(`[SMOKE] requestId=${req.requestId || 'unknown'} actor=admin role=${req.adminRole || 'unknown'} action=snapshot result=ok`);
        res.json({
            capturedAt: new Date().toISOString(),
            role: req.adminRole || 'unknown',
            syncVersion: Number(sync.version || 0),
            snapshot
        });
    } catch (error) {
        next(error);
    }
});

adminRoutes.post('/logout', requireAdmin, (req, res) => {
    destroyAdminSession(req.adminSession?.id);
    res.clearCookie('admin_session', { httpOnly: true, secure: IS_DEPLOYED, sameSite: 'lax', path: '/' });
    res.redirect('/admin/login');
});

// --- 2. Dashboard ---

adminRoutes.get(['/', '/dashboard'], requireAdmin, async (req, res) => {
    try {
        const isTestData = (name) => {
            const n = (name || '').toLowerCase();
            return n.includes('test') || n.includes('demo') || n.includes('qa') || n.includes('pilot') || n.includes('ismeretlen');
        };

        const activeDriversRes = await pool.query("SELECT name, is_active FROM drivers");
        const activeDriversCount = activeDriversRes.rows.filter(d => d.is_active && !isTestData(d.name)).length;
        const activeToursRes = await pool.query("SELECT COUNT(*) FROM tours WHERE tour_status IN ('PLANNED', 'IN_PROGRESS') AND deleted_at IS NULL");
        const todayHotelsRes = await pool.query("SELECT COUNT(*) FROM hotels WHERE check_in_date = CURRENT_DATE::TEXT AND deleted_at IS NULL");
        const cargoProblemsRes = await pool.query("SELECT COUNT(*) FROM cargo WHERE status IN ('DAMAGED', 'MISSING', 'REJECTED') AND deleted_at IS NULL");

        const liveUpdatesRes = await pool.query("SELECT * FROM live_updates ORDER BY timestamp DESC LIMIT 10");

        const kpis = [
            { label: 'Aktív sofőrök', value: activeDriversCount, icon: '👤', color: '#3498db' },
            { label: 'Aktív túrák', value: activeToursRes.rows[0].count, icon: '🚛', color: '#16884f' },
            { label: 'Mai hotelek', value: todayHotelsRes.rows[0].count, icon: '🏨', color: '#f39c12' },
            { label: 'Cargo problémák', value: cargoProblemsRes.rows[0].count, icon: '📦', color: '#e74c3c' }
        ];

        const kpiHtml = kpis.map(kpi => `
            <div class="card" style="border-left: 4px solid ${kpi.color};">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-size:11px; color:var(--color-text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">${kpi.label}</div>
                        <div style="font-size:28px; font-weight:800; margin-top:4px;">${kpi.value || '0'}</div>
                    </div>
                    <div style="font-size:32px; opacity:0.15;">${kpi.icon}</div>
                </div>
            </div>
        `).join('');

        const eventsHtml = liveUpdatesRes.rows.map(u => `
            <div style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--color-border);">
                <div style="font-size:18px;">📍</div>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:14px;">${escapeHtml(u.driver_name)} - ${escapeHtml(u.status)}</div>
                    <div style="font-size:11px; color:var(--color-text-muted);">${new Date(Number(u.timestamp)).toLocaleString('hu-HU')}</div>
                </div>
            </div>
        `).join('') || '<p style="color:var(--color-text-muted); text-align:center; padding:20px;">Nincs friss esemény.</p>';

        const content = `
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:24px; margin-bottom:32px;">
                ${kpiHtml}
            </div>
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px;">
                <div class="card">
                    <h3 style="margin-top:0;">Legutóbbi aktivitás</h3>
                    <div>${eventsHtml}</div>
                    <button class="btn btn-outline" style="margin-top:16px; width:100%; justify-content:center;" onclick="location.href='/admin/drivers'">Összes sofőr</button>
                </div>
                <div class="card" style="background:#1a1c23; color:white;">
                    <h3 style="margin-top:0; color:white;">Rendszerállapot</h3>
                    <div style="display:flex; flex-direction:column; gap:16px; margin-top:20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:14px; opacity:0.7;">Backend</span>
                            <span class="badge" style="background:#2ecc71; color:white; font-size:10px;">ONLINE</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:14px; opacity:0.7;">Adatbázis</span>
                            <span class="badge" style="background:#2ecc71; color:white; font-size:10px;">CONNECTED</span>
                        </div>
                        <hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:8px 0;">
                        <p style="font-size:12px; opacity:0.6; line-height:1.5;">Minden rendszer megfelelően működik. Nincs folyamatban lévő karbantartás.</p>
                    </div>
                </div>
            </div>
        `;
        res.send(renderAdminLayout({ title: 'Dashboard', content, activeMenu: 'dashboard', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (e) { res.status(500).send(e.message); }
});

// --- 3. Drivers ---

adminRoutes.get('/drivers', requireAdmin, async (req, res) => {
    try {
        const drivers = (await pool.query('SELECT * FROM drivers ORDER BY name ASC')).rows;
        const isTestData = (name) => {
            const n = (name || '').toLowerCase();
            return n.includes('test') || n.includes('demo') || n.includes('qa') || n.includes('pilot') || n.includes('ismeretlen');
        };

        const rows = drivers.map(d => `
            <tr class="${isTestData(d.name) ? 'test-data-row' : ''}">
                <td>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${escapeHtml(d.photo_url || '')}" style="width:32px; height:36px; border-radius:50%; object-fit:cover; background:#eee;">
                        <div>
                            <div style="font-weight:600; font-size:14px;">${escapeHtml(d.name)}</div>
                            <small style="color:var(--color-text-muted); font-size:10px;">${d.uuid.slice(0,8)}</small>
                        </div>
                    </div>
                </td>
                <td style="font-size:14px;">${escapeHtml(d.license_plate || '—')}</td>
                <td>
                    <div style="font-size:14px;">${escapeHtml(d.email || '—')}</div>
                    <small style="color:var(--color-text-muted); font-size:12px;">${escapeHtml(d.phone || '—')}</small>
                </td>
                <td>
                    <div class="code-cell" data-uuid="${d.uuid}">
                        <code>••••••••</code>
                        <button class="btn btn-outline" style="padding:2px 8px; font-size:10px; margin-left:8px;" onclick="revealCode('${d.uuid}')">Mutat</button>
                    </div>
                </td>
                <td><span class="badge ${d.is_active ? 'badge-working' : 'badge-offline'}">${d.is_active ? 'Aktív' : 'Inaktív'}</span></td>
                <td style="text-align:right;"><button class="btn btn-outline" onclick="location.href='/admin/drivers/'+'${d.uuid}'">Adatlap</button></td>
            </tr>
        `).join('');

        const content = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <h3 style="margin:0;">Sofőrök</h3>
                <button class="btn btn-primary" onclick="location.href='/admin/drivers/new'">+ Új sofőr</button>
            </div>
            <div class="card" style="padding:0; overflow:hidden;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead><tr style="background:#f8f9fa;"><th>Sofőr</th><th>Rendszám</th><th>Kapcsolat</th><th>Aktiváló kód</th><th>Státusz</th><th style="text-align:right;">Művelet</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:32px;">Nincs sofőr.</td></tr>'}</tbody>
                </table>
            </div>
        `;

        const scripts = `
            <script>
                async function revealCode(uuid) {
                    const r = await fetch('/admin/api/drivers/' + uuid + '/code');
                    if (r.ok) {
                        const { code } = await r.json();
                        const cell = document.querySelector('.code-cell[data-uuid="' + uuid + '"]');
                        const regenerate = window.isReadOnlyAdmin ? '' : ' <button class="btn btn-outline" style="padding:2px 8px; font-size:10px; color:var(--color-error);" onclick="regenerateCode(\\''+uuid+'\\')">🔄</button>';
                        cell.innerHTML = '<code>' + code + '</code> <button class="btn btn-outline" style="padding:2px 8px; font-size:10px;" onclick="navigator.clipboard.writeText(\\''+code+'\\');showToast(\\'Vágólapra másolva!\\')">📋</button>' + regenerate;
                    }
                }
                async function regenerateCode(uuid) {
                    if (window.isReadOnlyAdmin) return showToast('Read-only admin fiokkal ez a muvelet nem elerheto.', 'error');
                    if(!confirm('Új kódot generálsz? A régi azonnal érvényét veszti.')) return;
                    const r = await fetch('/admin/api/drivers/' + uuid + '/regenerate', { method: 'POST', headers: { 'x-csrf-token': window.adminCsrfToken } });
                    if(r.ok) { showToast('Új kód generálva!'); revealCode(uuid); }
                }
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Sofőrök', content, activeMenu: 'drivers', scripts, csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (e) { res.status(500).send(e.message); }
});

adminRoutes.get('/drivers/new', requireAdmin, (req, res) => {
    if (req.adminRole === 'READ_ONLY') {
        return res.status(403).send(renderAdminLayout({
            title: 'Read-only',
            content: '<div class="card">Read-only admin fiokkal nem hozhato letre uj sofor.</div>',
            activeMenu: 'drivers',
            csrfToken: req.adminCsrfToken,
            adminRole: req.adminRole
        }));
    }
    const content = renderDriverForm({ mode: 'new', csrfToken: req.adminCsrfToken });
    res.send(renderAdminLayout({ title: 'Új sofőr', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
});

adminRoutes.get('/drivers/:uuid', requireAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).send(renderAdminLayout({
        title: 'Hibás sofőr azonosító',
        activeMenu: 'drivers',
        csrfToken: req.adminCsrfToken,
        adminRole: req.adminRole,
        content: '<div class="card">Hibás sofőr UUID.</div>'
    }));
    try {
        const driver = (await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        if (!driver) return res.status(404).send(renderAdminLayout({
            title: 'Sofőr nem található',
            activeMenu: 'drivers',
            csrfToken: req.adminCsrfToken,
            adminRole: req.adminRole,
            content: '<div class="card">Sofőr nem található.</div>'
        }));
        const tours = (await pool.query('SELECT id, name, tour_status, date, is_current FROM tours WHERE driver_uuid = $1 OR driver_name = $2 ORDER BY date DESC LIMIT 8', [driver.uuid, driver.name])).rows;
        const devices = (await pool.query('SELECT device_id, device_name, is_active, linked_at, last_seen_at, revision, token_rotated_at FROM driver_devices WHERE driver_uuid = $1 ORDER BY last_seen_at DESC NULLS LAST', [driver.uuid])).rows;
        const lastUpdate = (await pool.query('SELECT status, current_tour, timestamp FROM live_updates WHERE driver_uuid = $1 OR driver_name = $2 ORDER BY timestamp DESC LIMIT 1', [driver.uuid, driver.name])).rows[0];

        const tourRows = tours.map(t => `
            <tr><td>#${t.id}</td><td>${escapeHtml(t.name || '—')}</td><td>${escapeHtml(t.tour_status || '—')}</td><td>${formatDateTime(t.date)}</td><td>${t.is_current ? 'Igen' : 'Nem'}</td></tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;">Nincs kapcsolódó túra.</td></tr>';
        const canRotateToken = req.adminRole !== 'READ_ONLY';
        const deviceRows = devices.map(d => `
            <tr><td>${escapeHtml(d.device_name || '—')}</td><td><code>${escapeHtml(d.device_id || '')}</code></td><td>${d.is_active ? 'Aktív' : 'Leválasztva'}</td><td>${formatDateTime(d.last_seen_at)}</td><td>${escapeHtml(d.revision || 1)}</td><td>${formatDateTime(d.token_rotated_at)}</td><td>${canRotateToken ? `<button class="btn btn-outline rotate-device-token" data-device-id="${escapeHtml(d.device_id || '')}" onclick="rotateDeviceToken(this)">Token rotation</button>` : '<span class="badge">Read-only</span>'}</td></tr>
        `).join('') || '<tr><td colspan="7" style="text-align:center;">Nincs eszközadat.</td></tr>';

        const content = `
            <div style="display:grid; grid-template-columns:minmax(280px, 1fr) 2fr; gap:24px;">
                <div>
                    <div class="card" style="text-align:center;">
                        <img src="${escapeHtml(driver.photo_url || '')}" style="width:112px; height:112px; border-radius:50%; object-fit:cover; background:#eee; margin-bottom:16px;">
                        <h3 style="margin:0;">${escapeHtml(driver.name)}</h3>
                        <p style="color:var(--color-text-muted);">${escapeHtml(driver.license_plate || 'Nincs rendszám')}</p>
                        <span class="badge ${driver.is_active ? 'badge-working' : 'badge-offline'}">${driver.is_active ? 'Aktív' : 'Inaktív'}</span>
                        <hr style="border:0; border-top:1px solid var(--color-border); margin:20px 0;">
                        <div style="text-align:left; font-size:14px;">
                            <div><b>Státusz:</b> ${escapeHtml(lastUpdate?.status || 'Nincs friss adat')}</div>
                            <div><b>Aktuális túra:</b> ${escapeHtml(lastUpdate?.current_tour || '—')}</div>
                            <div><b>Utolsó sync:</b> ${formatDateTime(lastUpdate?.timestamp)}</div>
                        </div>
                        <div id="code-area" style="margin-top:20px; font-family:monospace; font-weight:700;">••••••••</div>
                        <div style="display:flex; gap:8px; justify-content:center; margin-top:12px;">
                            <button class="btn btn-outline" onclick="revealCode()">Mutat</button>
                            <button class="btn btn-outline" onclick="regenerateCode()">Új kód</button>
                        </div>
                    </div>
                    <div class="card">
                        <h4 style="margin-top:0;">Eszközök</h4>
                        <table style="width:100%; border-collapse:collapse;"><thead><tr><th>Név</th><th>Device ID</th><th>Állapot</th><th>Utolsó</th><th>Rev</th><th>Rotálva</th><th>Művelet</th></tr></thead><tbody>${deviceRows}</tbody></table>
                        <div id="rotated-token-panel" style="display:none; margin-top:12px; padding:12px; border:1px solid var(--color-border); border-radius:8px; background:#fff7ed;">
                            <b>Új device token</b>
                            <p style="margin:6px 0;">Csak most látható. Frissítés után eltűnik.</p>
                            <code id="rotated-token-value" data-testid="rotated-token-value"></code>
                        </div>
                    </div>
                </div>
                <div>
                    ${renderDriverForm({ driver, mode: 'edit', csrfToken: req.adminCsrfToken })}
                    <div class="card">
                        <h4 style="margin-top:0;">Kapcsolódó túrák</h4>
                        <table style="width:100%; border-collapse:collapse;"><thead><tr><th>ID</th><th>Név</th><th>Státusz</th><th>Dátum</th><th>Aktuális</th></tr></thead><tbody>${tourRows}</tbody></table>
                    </div>
                    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b>Sofőr deaktiválása</b><br>
                            <small style="color:var(--color-text-muted);">Az üzleti adatok megmaradnak, a sofőr inaktív lesz.</small>
                            <div id="driver-action-message" aria-live="polite" style="margin-top:8px; color:var(--color-success); font-weight:600;"></div>
                        </div>
                        <button type="button" id="deactivate-driver-button" class="btn btn-outline" style="color:var(--color-error);">Deaktiválás</button>
                    </div>
                </div>
            </div>
            <script>
                const driverUuid = ${scriptJson(driver.uuid)};
                async function revealCode() {
                    const res = await fetch('/admin/api/drivers/' + driverUuid + '/code');
                    const data = await res.json();
                    document.getElementById('code-area').textContent = data.code || '---';
                }
                async function regenerateCode() {
                    if (!confirm('Új aktiváló kódot generálsz?')) return;
                    const res = await fetch('/admin/api/drivers/' + driverUuid + '/regenerate', { method: 'POST', headers: { 'x-csrf-token': window.adminCsrfToken } });
                    if (!res.ok) return showToast('Nem sikerült új kódot generálni.', 'error');
                    const data = await res.json();
                    document.getElementById('code-area').textContent = data.code;
                    showToast('Új aktiváló kód létrehozva.');
                }
                async function deactivateDriver() {
                    if (!confirm('Deaktiválod ezt a sofőrt?')) return;
                    const res = await fetch('/admin/delete-driver', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.adminCsrfToken },
                        body: JSON.stringify({ uuid: driverUuid })
                    });
                    const message = document.getElementById('driver-action-message');
                    if (!res.ok) {
                        if (message) {
                            message.style.color = 'var(--color-error)';
                            message.textContent = 'Deaktiválás sikertelen.';
                        }
                        return showToast('Deaktiválás sikertelen.', 'error');
                    }
                    if (message) {
                        message.style.color = 'var(--color-success)';
                        message.textContent = 'Állapot: inaktív.';
                    }
                    showToast('Sofőr deaktiválva.');
                    document.querySelector('input[name="is_active"]').checked = false;
                }
                document.getElementById('deactivate-driver-button')?.addEventListener('click', deactivateDriver);
                async function rotateDeviceToken(button) {
                    if (window.isReadOnlyAdmin) return showToast('Read-only admin nem rotalhat tokent.', 'error');
                    if (!confirm('Uj tokent general ehhez az eszkohoz? A regi token azonnal ervenytelen lesz.')) return;
                    const deviceId = button.dataset.deviceId;
                    const res = await fetch('/admin/drivers/' + driverUuid + '/devices/' + encodeURIComponent(deviceId) + '/rotate-token', {
                        method: 'POST',
                        headers: { 'x-csrf-token': window.adminCsrfToken }
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) return showToast(data.error || 'Token rotation sikertelen.', 'error');
                    document.getElementById('rotated-token-value').textContent = data.token || '';
                    document.getElementById('rotated-token-panel').style.display = 'block';
                    showToast('Token rotation kesz. Az uj token csak most lathato.');
                }
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Sofőradatlap', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (e) { res.status(500).send(e.message); }
});

adminRoutes.post('/drivers/:uuid/devices/:deviceId/rotate-token', requireAdmin, requireAdminWrite, rateLimit({ name: 'token-rotation', windowMs: 60_000, max: 6 }), async (req, res, next) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'Invalid driver UUID.' });
    const token = generateDeviceToken();
    const now = Date.now();
    try {
        const updated = (await pool.query(
            `UPDATE driver_devices
             SET device_token_hash = $1, token_rotated_at = $2, updated_at = $2, sync_state = 'SYNCED', revision = COALESCE(revision, 1) + 1
             WHERE driver_uuid = $3 AND device_id = $4 AND deleted_at IS NULL
             RETURNING driver_uuid, device_id, revision, token_rotated_at`,
            [hashToken(token), now, req.params.uuid, req.params.deviceId]
        )).rows[0];
        if (!updated) return res.status(404).json({ error: 'Device not found.' });
        await pool.query(
            `INSERT INTO work_time_audit (event_uuid, event_type, new_value, actor_type, actor_id, request_id, occurred_at, reason)
             VALUES (gen_random_uuid(), 'DEVICE_TOKEN_ROTATED', $1, 'ADMIN', 'admin', $2, $3, 'admin rotation')`,
            [JSON.stringify({ driverUuid: updated.driver_uuid, deviceId: updated.device_id, revision: updated.revision }), req.requestId || null, now]
        );
        console.log(`[DEVICE_AUTH] requestId=${req.requestId || 'unknown'} event=DEVICE_TOKEN_ROTATED driver=${updated.driver_uuid} device=${updated.device_id} result=ok`);
        res.json({
            driverUuid: updated.driver_uuid,
            deviceId: updated.device_id,
            token,
            revision: updated.revision,
            tokenRotatedAt: updated.token_rotated_at
        });
    } catch (error) {
        next(error);
    }
});

// --- 4. Hotels ---

adminRoutes.get('/hotels', requireAdmin, async (req, res) => {
    try {
        const canWrite = req.adminRole !== 'READ_ONLY';
        const drivers = (await pool.query('SELECT name FROM drivers WHERE is_active = true ORDER BY name ASC')).rows;
        const tours = (await pool.query('SELECT id, name, driver_name FROM tours WHERE deleted_at IS NULL ORDER BY name ASC')).rows;
        const hotels = (await pool.query(`
            SELECT h.id, h.uuid::TEXT, 'hotel'::TEXT AS source, h.driver_name, h.name,
                   COALESCE(address_line_1, address) AS address, address_line_1, city, country,
                   latitude, longitude, phone, email, room_number, entry_code, booking_number,
                   check_in_date, check_out_date, h.status AS status, h.notes, h.updated_at,
                   h.tour_id, t.name AS tour_name
            FROM hotels h
            LEFT JOIN tours t ON t.id = h.tour_id AND t.deleted_at IS NULL
            WHERE h.deleted_at IS NULL
            UNION ALL
            SELECT s.id, s.uuid::TEXT, 'stop'::TEXT AS source, NULL::TEXT AS driver_name,
                   COALESCE(recipient, address_full) AS name, address_full AS address,
                   address_full AS address_line_1, s.city, s.country, s.latitude, s.longitude,
                   s.phone_number AS phone, s.email, s.room_number, s.entry_code, s.booking_number,
                   s.stop_date::TEXT AS check_in_date, NULL::TEXT AS check_out_date,
                   s.stop_status AS status, s.notes, s.updated_at,
                   s.tour_id, t.name AS tour_name
            FROM stops s
            LEFT JOIN tours t ON t.id = s.tour_id AND t.deleted_at IS NULL
            WHERE s.deleted_at IS NULL AND s.stop_type = 'HOTEL'
            ORDER BY updated_at DESC NULLS LAST
        `)).rows;
        const styles = `
            .hotel-main { display:grid; grid-template-columns:420px minmax(0,1fr); gap:24px; height:calc(100vh - 160px); }
            .hotel-sidebar { display:flex; flex-direction:column; min-height:0; gap:16px; }
            .hotel-list { overflow:auto; display:flex; flex-direction:column; gap:12px; padding-right:4px; }
            .hotel-card { background:white; border:1px solid var(--color-border); border-radius:8px; padding:16px; cursor:pointer; }
            .hotel-card:hover, .hotel-card.active { border-color:var(--color-sidebar-active); box-shadow:var(--shadow-md); }
            #hotel-map { min-height:420px; border:1px solid var(--color-border); border-radius:8px; background:#eef1f4; }
            .modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); display:none; align-items:center; justify-content:center; z-index:10000; }
            .modal-backdrop.open { display:flex; }
            .modal-panel { background:white; width:min(920px, calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; border-radius:8px; padding:24px; }
            ${renderAdminMapStyles()}
        `;
        const driverOptions = drivers.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
        const tourOptions = tours.map(t => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.name || `#${t.id}`)}${t.driver_name ? ` - ${escapeHtml(t.driver_name)}` : ''}</option>`).join('');
        const content = `
            <div class="hotel-main">
                <div class="hotel-sidebar">
                    <div class="card" style="padding:16px;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <input id="hotel-search" type="text" placeholder="Név, cím, város..." oninput="renderHotels()" style="width:100%;">
                            <select id="hotel-driver" onchange="renderHotels()"><option value="">Minden sofőr</option>${driverOptions}</select>
                            <select id="hotel-status" onchange="renderHotels()">
                                <option value="">Minden státusz</option><option>PLANNED</option><option>BOOKED</option><option>CONFIRMED</option><option>CHECKED_IN</option><option>CHECKED_OUT</option><option>CANCELLED</option><option>PROBLEM</option>
                            </select>
                            <select id="hotel-tour" onchange="renderHotels()"><option value="">Minden tĂşra</option><option value="__standalone">Standalone/manual hotel</option>${tourOptions}</select>
                            <input id="hotel-date" type="date" onchange="renderHotels()">
                        </div>
                    </div>
                    <div id="hotel-list" class="hotel-list"></div>
                </div>
                <div style="display:flex; flex-direction:column; gap:16px; min-width:0;">
                    <div id="hotel-map"></div>
                    <div id="hotel-detail" class="card">Válassz hotelt a részletekhez.</div>
                </div>
            </div>
            <div id="hotel-modal" class="modal-backdrop">
                <div class="modal-panel">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
                        <h3 style="margin:0;">Hotel szerkesztése</h3>
                        <button class="btn btn-outline" onclick="closeHotelModal()">Bezárás</button>
                    </div>
                    <form id="hotel-form">
                        <input type="hidden" name="source">
                        <input type="hidden" name="id">
                        <input type="hidden" name="uuid">
                        <input type="hidden" name="tour_id">
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:16px;">
                            ${input('Hotel név', 'name', '', 'text', 'required')}
                            ${input('Sofőr', 'driver_name')}
                            ${input('Cím', 'address_line_1')}
                            ${input('Város', 'city')}
                            ${input('Latitude', 'latitude', '', 'number', 'step="any"')}
                            ${input('Longitude', 'longitude', '', 'number', 'step="any"')}
                            ${input('Telefon', 'phone')}
                            ${input('Email', 'email', '', 'email')}
                            ${input('Szoba', 'room_number')}
                            ${input('Belépőkód', 'entry_code')}
                            ${input('Foglalási szám', 'booking_number')}
                            ${input('Check-in', 'check_in_date', '', 'date')}
                            ${input('Check-out', 'check_out_date', '', 'date')}
                            <div><label style="display:block; margin-bottom:8px; font-weight:600;">Státusz</label><select name="status" style="width:100%;"><option>PLANNED</option><option>BOOKED</option><option>CONFIRMED</option><option>CHECKED_IN</option><option>CHECKED_OUT</option><option>CANCELLED</option><option>PROBLEM</option></select></div>
                        </div>
                        <div style="margin-top:16px;"><label style="display:block; margin-bottom:8px; font-weight:600;">Megjegyzés</label><textarea name="notes" style="width:100%; min-height:90px;"></textarea></div>
                        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:18px;">
                            <button type="button" class="btn btn-outline" onclick="closeHotelModal()">Mégse</button>
                            ${canWrite ? '<button type="submit" class="btn btn-primary">Hotel mentése</button>' : '<span class="badge">Read-only</span>'}
                        </div>
                    </form>
                </div>
            </div>
        `;
        const scripts = `
            ${renderAdminMapScript()}
            <script>
                const hotels = ${scriptJson(hotels)};
                const tours = ${scriptJson(tours)};
                const map = L.map('hotel-map').setView([47.5, 19.04], 7);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' }).addTo(map);
                const layer = L.layerGroup().addTo(map);
                let selectedId = null;
                function hotelKey(h) { return h.source + ':' + h.id; }
                function filteredHotels() {
                    const q = document.getElementById('hotel-search').value.toLowerCase();
                    const driver = document.getElementById('hotel-driver').value;
                    const status = document.getElementById('hotel-status').value;
                    const tour = document.getElementById('hotel-tour').value;
                    const date = document.getElementById('hotel-date').value;
                    return hotels.filter(h => {
                        const hay = [h.name, h.address, h.city, h.driver_name].join(' ').toLowerCase();
                        const tourMatch = !tour || (tour === '__standalone' ? !h.tour_id : String(h.tour_id) === tour);
                        return (!q || hay.includes(q)) && (!driver || h.driver_name === driver) && (!status || h.status === status) && tourMatch && (!date || h.check_in_date === date || h.check_out_date === date);
                    });
                }
                function hotelOwnershipLabel(h) {
                    return h.tour_id ? 'Linked tour: ' + esc(h.tour_name || ('#' + h.tour_id)) : 'Standalone/manual hotel';
                }
                function renderHotels() {
                    const list = document.getElementById('hotel-list');
                    const rows = filteredHotels();
                    list.innerHTML = rows.map(h => {
                        const key = hotelKey(h);
                        return '<div class="hotel-card '+(key===selectedId?'active':'')+'" data-key="'+esc(key)+'" onclick="selectHotel(this.dataset.key)"><div style="display:flex; justify-content:space-between; gap:12px;"><b>'+esc(h.name || '')+'</b><span class="badge badge-working">'+esc(h.status || 'PLANNED')+'</span></div><div class="meta">'+esc(h.address || h.city || '')+'</div><div class="meta">Sofor: '+esc(h.driver_name || '-')+'</div><div class="meta">'+hotelOwnershipLabel(h)+'</div></div>';
                    }).join('') || '<div class="card">Nincs talalat.</div>';
                    renderMarkers(rows);
                }
                function renderMarkers(rows) {
                    layer.clearLayers();
                    const bounds = [];
                    rows.forEach(h => {
                        const lat = Number(h.latitude), lng = Number(h.longitude);
                        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.0001) {
                            L.marker([lat, lng]).addTo(layer).bindPopup('<b>'+esc(h.name || '')+'</b><br>'+esc(h.address || '')+'<br><a target="_blank" href="https://www.google.com/maps/search/?api=1&query='+lat+','+lng+'">Google Maps</a>');
                            bounds.push([lat, lng]);
                        }
                    });
                    if (bounds.length) map.fitBounds(bounds, { padding:[40,40] });
                }
                function selectHotel(key) {
                    selectedId = key;
                    const h = hotels.find(item => hotelKey(item) === key);
                    if (!h) return;
                    const editButton = window.isReadOnlyAdmin ? '<span class="badge">Read-only</span>' : '<button class="btn btn-primary" onclick="openHotelModal(\\''+key+'\\')">Szerkesztés</button>';
                    const tourLink = h.tour_id ? '<a class="btn btn-outline" href="/admin/tours#tour-'+encodeURIComponent(h.tour_id)+'">Related tour</a>' : '<span class="badge">No tour assigned</span>';
                    document.getElementById('hotel-detail').innerHTML = '<div style="display:flex; justify-content:space-between; gap:12px;"><h3 style="margin-top:0;">'+esc(h.name || '')+'</h3>'+editButton+'</div><p>'+esc(h.address || '')+'</p><p><b>Tour:</b> '+hotelOwnershipLabel(h)+'</p><p><b>Coordinates:</b> '+esc(h.latitude || '-')+', '+esc(h.longitude || '-')+'</p><p><b>Phone:</b> '+esc(h.phone || '-')+' &nbsp; <b>Email:</b> '+esc(h.email || '-')+'</p><p><b>Note:</b> '+esc(h.notes || '-')+'</p><div style="display:flex; gap:8px; flex-wrap:wrap;">' + tourLink + (h.latitude && h.longitude ? '<a class="btn btn-outline" target="_blank" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(h.latitude+','+h.longitude)+'">Google Maps</a>' : '') + '</div>';
                    renderHotels();
                }
                function openHotelModal(key) {
                    const h = hotels.find(item => hotelKey(item) === key);
                    const form = document.getElementById('hotel-form');
                    ['source','id','uuid','tour_id','name','driver_name','address_line_1','city','latitude','longitude','phone','email','room_number','entry_code','booking_number','check_in_date','check_out_date','status','notes'].forEach(name => {
                        if (form.elements[name]) form.elements[name].value = h[name] ?? (name === 'address_line_1' ? h.address || '' : '');
                    });
                    document.getElementById('hotel-modal').classList.add('open');
                }
                function closeHotelModal() { document.getElementById('hotel-modal').classList.remove('open'); }
                document.getElementById('hotel-form').addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
                    const res = await fetch('/admin/save-hotel-record', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-csrf-token': window.adminCsrfToken }, body: JSON.stringify(data) });
                    const payload = await res.json().catch(async () => ({ error: await res.text() }));
                    if (!res.ok) return showToast(payload.error || 'Hotel mentése sikertelen.', 'error');
                    showToast('Hotel mentve.');
                    setTimeout(() => location.reload(), 500);
                });
                renderHotels();
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Hotelek', content, activeMenu: 'hotels', styles, scripts, csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (e) { res.status(500).send(e.message); }
});

// --- 5. Internal API ---

adminRoutes.get('/api/drivers/:uuid/code', requireAdmin, async (req, res) => {
    try {
        const d = (await pool.query('SELECT activation_code FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        res.json({ code: d?.activation_code || '---' });
    } catch (e) { res.status(500).send(e.message); }
});

adminRoutes.post('/api/drivers/:uuid/regenerate', requireAdmin, requireAdminWrite, async (req, res) => {
    try {
        const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        await pool.query('UPDATE drivers SET activation_code = $1 WHERE uuid = $2', [newCode, req.params.uuid]);
        res.json({ code: newCode });
    } catch (e) { res.status(500).send(e.message); }
});

// --- 6. Cargo ---

adminRoutes.get('/cargo', requireAdmin, async (req, res) => {
    try {
        const canWrite = req.adminRole !== 'READ_ONLY';
        const cargoRows = (await pool.query(`
            SELECT
                c.id AS cargo_id,
                c.uuid::TEXT AS cargo_uuid,
                c.tour_id AS cargo_tour_id,
                c.pickup_stop_id AS cargo_pickup_stop_id,
                c.delivery_stop_id AS cargo_delivery_stop_id,
                c.pickup_stop_uuid::TEXT AS cargo_pickup_stop_uuid,
                c.delivery_stop_uuid::TEXT AS cargo_delivery_stop_uuid,
                c.type AS cargo_type,
                c.name AS cargo_name,
                c.description AS cargo_description,
                c.quantity AS cargo_quantity,
                c.unit AS cargo_unit,
                c.serial_number AS cargo_serial_number,
                c.external_reference AS cargo_external_reference,
                c.customer_reference AS cargo_customer_reference,
                c.weight_kg AS cargo_weight_kg,
                c.length_cm AS cargo_length_cm,
                c.width_cm AS cargo_width_cm,
                c.height_cm AS cargo_height_cm,
                c.status AS cargo_status,
                c.condition_at_pickup AS cargo_condition_at_pickup,
                c.condition_at_delivery AS cargo_condition_at_delivery,
                c.notes AS cargo_notes,
                c.driver_name AS cargo_driver_name,
                c.created_at AS cargo_created_at,
                c.updated_at AS cargo_updated_at,
                c.deleted_at AS cargo_deleted_at,
                c.sync_state AS cargo_sync_state,
                c.revision AS cargo_revision,
                t.id AS tour_id,
                t.name AS tour_name,
                t.driver_name AS tour_driver_name,
                ps.id AS pickup_stop_id,
                ps.uuid::TEXT AS pickup_stop_uuid,
                ps.order_index AS pickup_order_index,
                COALESCE(ps.company, ps.recipient, ps.address_full, ps.address) AS pickup_label,
                ps.address_full AS pickup_address,
                ds.id AS delivery_stop_id,
                ds.uuid::TEXT AS delivery_stop_uuid,
                ds.order_index AS delivery_order_index,
                COALESCE(ds.company, ds.recipient, ds.address_full, ds.address) AS delivery_label,
                ds.address_full AS delivery_address
            FROM cargo c
            LEFT JOIN tours t ON t.id = c.tour_id AND t.deleted_at IS NULL
            LEFT JOIN stops ps ON ps.id = c.pickup_stop_id AND ps.deleted_at IS NULL
            LEFT JOIN stops ds ON ds.id = c.delivery_stop_id AND ds.deleted_at IS NULL
            WHERE c.deleted_at IS NULL
            ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
        `)).rows;
        const tours = (await pool.query(`
            SELECT t.id, t.name, t.driver_name
            FROM tours t
            WHERE t.deleted_at IS NULL
            ORDER BY t.name ASC, t.id ASC
        `)).rows;
        const stops = (await pool.query(`
            SELECT
                s.id,
                s.uuid::TEXT AS uuid,
                s.tour_id,
                s.order_index,
                s.stop_type,
                COALESCE(s.company, s.recipient, s.address_full, s.address) AS label,
                s.address_full,
                s.city,
                s.stop_status
            FROM stops s
            JOIN tours t ON t.id = s.tour_id AND t.deleted_at IS NULL
            WHERE s.deleted_at IS NULL
            ORDER BY s.tour_id ASC, s.order_index ASC, s.id ASC
        `)).rows;
        const statusOptions = ['PLANNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'REJECTED', 'DAMAGED', 'MISSING', 'CANCELLED'];
        const typeOptions = ['MACHINE', 'PALLET', 'BOX', 'PART', 'VEHICLE', 'EQUIPMENT', 'OTHER'];
        const content = `
            <style>
                .cargo-shell { display:grid; grid-template-columns:minmax(360px, 480px) minmax(0,1fr); gap:24px; min-height:calc(100vh - 160px); }
                .cargo-panel { min-height:0; }
                .cargo-filters { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
                .cargo-filters input, .cargo-filters select, .cargo-form input, .cargo-form select, .cargo-form textarea { width:100%; }
                .cargo-list { display:flex; flex-direction:column; gap:10px; max-height:calc(100vh - 330px); overflow:auto; padding-right:4px; }
                .cargo-card { background:white; border:1px solid var(--color-border); border-radius:8px; padding:14px; cursor:pointer; }
                .cargo-card:hover, .cargo-card.active { border-color:var(--color-sidebar-active); box-shadow:var(--shadow-sm); }
                .cargo-meta { color:var(--color-text-muted); font-size:13px; margin-top:4px; }
                .cargo-detail-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:16px; }
                .cargo-detail-grid div { border-bottom:1px solid var(--color-border); padding-bottom:8px; }
                .cargo-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
                .cargo-form .wide { grid-column:1 / -1; }
                .cargo-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
                .cargo-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:1000; align-items:center; justify-content:center; padding:24px; }
                .cargo-modal.open { display:flex; }
                .cargo-modal-card { background:white; border-radius:8px; width:min(980px, 96vw); max-height:92vh; overflow:auto; padding:24px; }
                .cargo-error { display:none; margin-top:12px; color:var(--color-error); }
                .cargo-error.open { display:block; }
                @media (max-width: 900px) { .cargo-shell { grid-template-columns:1fr; } .cargo-list { max-height:none; } }
            </style>
            <div style="display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:18px;">
                <div>
                    <h3 style="margin:0;">Cargo</h3>
                    <div class="meta"><span id="cargo-count">0</span> rekord</div>
                </div>
                ${canWrite ? '<button class="btn btn-primary" onclick="openCargoForm()">+ Create Cargo</button>' : '<span class="badge">Read-only admin</span>'}
            </div>
            <div id="cargo-page-error" class="card cargo-error"></div>
            <div class="cargo-shell">
                <section class="cargo-panel">
                    <div class="card">
                        <div class="cargo-filters">
                            <input id="cargo-search" placeholder="Search name, serial, reference..." oninput="renderCargoList()">
                            <select id="cargo-tour-filter" onchange="renderCargoList()"><option value="">All tours</option></select>
                            <select id="cargo-status-filter" onchange="renderCargoList()"><option value="">All statuses</option></select>
                            <select id="cargo-type-filter" onchange="renderCargoList()"><option value="">All types</option></select>
                            <select id="cargo-issue-filter" onchange="renderCargoList()"><option value="">All issue states</option><option value="problem">Problem only</option><option value="ok">No problem</option></select>
                            <select id="cargo-deleted-filter" onchange="renderCargoList()"><option value="active">Active cargo</option><option value="deleted">Deleted cargo</option><option value="all">All cargo</option></select>
                        </div>
                    </div>
                    <div id="cargo-list" class="cargo-list"></div>
                </section>
                <section id="cargo-detail" class="card">Select cargo to inspect details.</section>
            </div>
            <div id="cargo-modal" class="cargo-modal">
                <div class="cargo-modal-card">
                    <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:16px;">
                        <h3 id="cargo-form-title" style="margin:0;">Create Cargo</h3>
                        <button class="btn btn-outline" type="button" onclick="closeCargoForm()">Cancel</button>
                    </div>
                    <form id="cargo-form" class="cargo-form">
                        <input type="hidden" name="id">
                        <div><label>Tour</label><select name="tour_id" required onchange="refreshStopOptions()"></select></div>
                        <div><label>Type</label><select name="type" onchange="toggleMachineFields()"></select></div>
                        <div><label>Name</label><input name="name" required maxlength="180"></div>
                        <div><label>Quantity</label><input name="quantity" type="number" min="1" step="1" value="1"></div>
                        <div><label>Unit</label><input name="unit" maxlength="40" value="pcs"></div>
                        <div class="machine-field"><label>Serial number</label><input name="serial_number" maxlength="120"></div>
                        <div class="machine-field"><label>External reference / model</label><input name="external_reference" maxlength="180"></div>
                        <div><label>Customer reference</label><input name="customer_reference" maxlength="180"></div>
                        <div><label>Pickup stop</label><select name="pickup_stop_id"></select></div>
                        <div><label>Delivery stop</label><select name="delivery_stop_id"></select></div>
                        <div><label>Weight kg</label><input name="weight_kg" type="number" min="0" step="0.01"></div>
                        <div><label>Dimensions cm</label><div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;"><input name="length_cm" type="number" min="0" step="0.1" placeholder="L"><input name="width_cm" type="number" min="0" step="0.1" placeholder="W"><input name="height_cm" type="number" min="0" step="0.1" placeholder="H"></div></div>
                        <div><label>Status</label><select name="status"></select></div>
                        <div class="wide"><label>Description</label><textarea name="description" rows="2" maxlength="1000"></textarea></div>
                        <div class="wide"><label>Notes</label><textarea name="notes" rows="3" maxlength="1000"></textarea></div>
                        <div class="wide"><button id="cargo-submit" class="btn btn-primary" type="submit">Save</button> <span id="cargo-form-message" class="meta"></span></div>
                    </form>
                </div>
            </div>
            <script>
                window.adminCsrfToken = '${escapeHtml(req.adminCsrfToken || '')}';
                const cargoRows = ${scriptJson(cargoRows)};
                const cargoTours = ${scriptJson(tours)};
                const cargoStops = ${scriptJson(stops)};
                const cargoStatuses = ${scriptJson(statusOptions)};
                const cargoTypes = ${scriptJson(typeOptions)};
                const canWriteCargo = ${canWrite ? 'true' : 'false'};
                let selectedCargoId = null;

                const problemStatuses = new Set(['DAMAGED', 'MISSING', 'REJECTED']);
                const transitions = {
                    PLANNED: ['READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED', 'DAMAGED', 'MISSING'],
                    READY_FOR_PICKUP: ['PICKED_UP', 'REJECTED', 'CANCELLED', 'DAMAGED', 'MISSING'],
                    PICKED_UP: ['IN_TRANSIT', 'DELIVERED', 'DAMAGED', 'MISSING', 'CANCELLED'],
                    IN_TRANSIT: ['DELIVERED', 'DAMAGED', 'MISSING', 'CANCELLED']
                };

                function esc(value) {
                    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
                }
                function fmt(value) { return value ? new Date(Number(value)).toLocaleString('hu-HU') : '-'; }
                function num(value) { return value === null || value === undefined || value === '' ? '' : String(value); }
                function cargoKey(c) { return String(c.cargo_id); }
                function stopLabel(stop) {
                    if (!stop) return '-';
                    return '#' + (Number(stop.order_index) + 1) + ' ' + (stop.label || stop.address_full || stop.city || ('Stop ' + stop.id));
                }
                function cargoStopOptions(tourId, selected) {
                    const rows = cargoStops.filter(s => String(s.tour_id) === String(tourId));
                    return '<option value="">No stop</option>' + rows.map(s => '<option value="'+esc(s.id)+'" '+(String(selected || '') === String(s.id) ? 'selected' : '')+'>'+esc(stopLabel(s))+'</option>').join('');
                }
                function seedFilters() {
                    document.getElementById('cargo-tour-filter').innerHTML += cargoTours.map(t => '<option value="'+esc(t.id)+'">'+esc((t.name || ('Tour #' + t.id)) + (t.driver_name ? ' - ' + t.driver_name : ''))+'</option>').join('');
                    document.getElementById('cargo-status-filter').innerHTML += cargoStatuses.map(s => '<option>'+esc(s)+'</option>').join('');
                    document.getElementById('cargo-type-filter').innerHTML += cargoTypes.map(t => '<option>'+esc(t)+'</option>').join('');
                    const form = document.getElementById('cargo-form');
                    form.elements.tour_id.innerHTML = '<option value="">Select tour</option>' + cargoTours.map(t => '<option value="'+esc(t.id)+'">'+esc((t.name || ('Tour #' + t.id)) + (t.driver_name ? ' - ' + t.driver_name : ''))+'</option>').join('');
                    form.elements.type.innerHTML = cargoTypes.map(t => '<option>'+esc(t)+'</option>').join('');
                    form.elements.status.innerHTML = cargoStatuses.map(s => '<option>'+esc(s)+'</option>').join('');
                }
                function filteredCargo() {
                    const q = document.getElementById('cargo-search').value.toLowerCase();
                    const tour = document.getElementById('cargo-tour-filter').value;
                    const status = document.getElementById('cargo-status-filter').value;
                    const type = document.getElementById('cargo-type-filter').value;
                    const issue = document.getElementById('cargo-issue-filter').value;
                    const deleted = document.getElementById('cargo-deleted-filter').value;
                    return cargoRows.filter(c => {
                        const hay = [c.cargo_name, c.cargo_description, c.cargo_serial_number, c.cargo_external_reference, c.cargo_customer_reference, c.tour_name, c.pickup_label, c.delivery_label].join(' ').toLowerCase();
                        const isProblem = problemStatuses.has(c.cargo_status);
                        const isDeleted = !!c.cargo_deleted_at;
                        return (!q || hay.includes(q))
                            && (!tour || String(c.cargo_tour_id || '') === tour)
                            && (!status || c.cargo_status === status)
                            && (!type || c.cargo_type === type)
                            && (!issue || (issue === 'problem' ? isProblem : !isProblem))
                            && (deleted === 'all' || (deleted === 'deleted' ? isDeleted : !isDeleted));
                    });
                }
                function renderCargoList() {
                    const rows = filteredCargo();
                    document.getElementById('cargo-count').innerText = rows.length;
                    const list = document.getElementById('cargo-list');
                    if (!cargoRows.length) {
                        list.innerHTML = '<div class="card">No cargo records.</div>';
                        return;
                    }
                    if (!rows.length) {
                        list.innerHTML = '<div class="card">No cargo matches the current filters.</div>';
                        return;
                    }
                    list.innerHTML = rows.map(c => {
                        const key = cargoKey(c);
                        const serial = c.cargo_serial_number ? 'S/N: ' + c.cargo_serial_number : 'No serial';
                        const issue = problemStatuses.has(c.cargo_status) ? ' badge-danger' : ' badge-working';
                        return '<div class="cargo-card '+(key === selectedCargoId ? 'active' : '')+'" data-id="'+esc(key)+'" onclick="selectCargo(this.dataset.id)">'
                            + '<div style="display:flex; justify-content:space-between; gap:10px;"><b>'+esc(c.cargo_name)+'</b><span class="badge '+issue+'">'+esc(c.cargo_status || 'PLANNED')+'</span></div>'
                            + '<div class="cargo-meta">'+esc(c.cargo_type || 'MACHINE')+' · '+esc(serial)+' · Qty '+esc(c.cargo_quantity || 1)+' '+esc(c.cargo_unit || 'pcs')+'</div>'
                            + '<div class="cargo-meta">Tour: '+esc(c.tour_name || ('#' + (c.cargo_tour_id || '-')))+'</div>'
                            + '<div class="cargo-meta">Pickup: '+esc(c.pickup_label || '-')+' → Delivery: '+esc(c.delivery_label || '-')+'</div>'
                            + '</div>';
                    }).join('');
                }
                function findCargo(id) { return cargoRows.find(c => String(c.cargo_id) === String(id)); }
                function renderDetail(c) {
                    if (!c) {
                        document.getElementById('cargo-detail').innerHTML = 'Select cargo to inspect details.';
                        return;
                    }
                    const dims = [c.cargo_length_cm, c.cargo_width_cm, c.cargo_height_cm].filter(v => v !== null && v !== undefined && v !== '').join(' x ');
                    const next = transitions[c.cargo_status] || [];
                    const transitionButtons = canWriteCargo ? next.map(s => '<button class="btn btn-outline" onclick="setCargoStatus('+Number(c.cargo_id)+', \\''+esc(s)+'\\')">'+esc(s)+'</button>').join('') : '';
                    const deleteButton = canWriteCargo ? '<button class="btn btn-outline" onclick="deleteCargo('+Number(c.cargo_id)+')">Soft delete</button>' : '';
                    const editButton = canWriteCargo ? '<button class="btn btn-primary" onclick="openCargoForm('+Number(c.cargo_id)+')">Edit</button>' : '';
                    document.getElementById('cargo-detail').innerHTML =
                        '<div style="display:flex; justify-content:space-between; gap:12px;"><h3 style="margin:0;">'+esc(c.cargo_name)+'</h3>'+editButton+'</div>'
                        + '<div class="cargo-detail-grid">'
                        + '<div><b>UUID</b><br>'+esc(c.cargo_uuid || '-')+'</div>'
                        + '<div><b>Status</b><br>'+esc(c.cargo_status || '-')+'</div>'
                        + '<div><b>Tour</b><br><a href="/admin/tours">'+esc(c.tour_name || ('#' + (c.cargo_tour_id || '-')))+'</a></div>'
                        + '<div><b>Driver</b><br>'+esc(c.cargo_driver_name || c.tour_driver_name || '-')+'</div>'
                        + '<div><b>Pickup stop</b><br>'+esc(c.pickup_label || '-')+'</div>'
                        + '<div><b>Delivery stop</b><br>'+esc(c.delivery_label || '-')+'</div>'
                        + '<div><b>Type</b><br>'+esc(c.cargo_type || '-')+'</div>'
                        + '<div><b>Serial</b><br>'+esc(c.cargo_serial_number || '-')+'</div>'
                        + '<div><b>External reference / model</b><br>'+esc(c.cargo_external_reference || '-')+'</div>'
                        + '<div><b>Customer reference</b><br>'+esc(c.cargo_customer_reference || '-')+'</div>'
                        + '<div><b>Quantity</b><br>'+esc(c.cargo_quantity || 1)+' '+esc(c.cargo_unit || 'pcs')+'</div>'
                        + '<div><b>Weight / dimensions</b><br>'+esc(c.cargo_weight_kg || '-')+' kg · '+esc(dims || '-')+'</div>'
                        + '<div><b>Sync</b><br>'+esc(c.cargo_sync_state || 'SYNCED')+' rev '+esc(c.cargo_revision || 1)+'</div>'
                        + '<div><b>Updated</b><br>'+esc(fmt(c.cargo_updated_at))+'</div>'
                        + '<div class="wide"><b>Description</b><br>'+esc(c.cargo_description || '-')+'</div>'
                        + '<div class="wide"><b>Notes</b><br>'+esc(c.cargo_notes || '-')+'</div>'
                        + '</div>'
                        + (canWriteCargo ? '<div class="cargo-actions">'+transitionButtons+deleteButton+'</div>' : '<div class="cargo-actions"><span class="badge">Read-only admin</span></div>');
                }
                function selectCargo(id) {
                    selectedCargoId = id;
                    renderCargoList();
                    renderDetail(findCargo(id));
                }
                function toggleMachineFields() {
                    const type = document.getElementById('cargo-form').elements.type.value;
                    document.querySelectorAll('.machine-field').forEach(el => { el.style.display = type === 'MACHINE' ? '' : 'none'; });
                }
                function refreshStopOptions() {
                    const form = document.getElementById('cargo-form');
                    form.elements.pickup_stop_id.innerHTML = cargoStopOptions(form.elements.tour_id.value, form.elements.pickup_stop_id.dataset.selected);
                    form.elements.delivery_stop_id.innerHTML = cargoStopOptions(form.elements.tour_id.value, form.elements.delivery_stop_id.dataset.selected);
                    form.elements.pickup_stop_id.dataset.selected = '';
                    form.elements.delivery_stop_id.dataset.selected = '';
                }
                function openCargoForm(id) {
                    if (!canWriteCargo) return;
                    const form = document.getElementById('cargo-form');
                    form.reset();
                    document.getElementById('cargo-form-message').innerText = '';
                    const c = id ? findCargo(id) : null;
                    document.getElementById('cargo-form-title').innerText = c ? 'Edit Cargo' : 'Create Cargo';
                    form.elements.id.value = c?.cargo_id || '';
                    form.elements.tour_id.value = c?.cargo_tour_id || '';
                    form.elements.type.value = c?.cargo_type || 'MACHINE';
                    form.elements.name.value = c?.cargo_name || '';
                    form.elements.quantity.value = num(c?.cargo_quantity || 1);
                    form.elements.unit.value = c?.cargo_unit || 'pcs';
                    form.elements.serial_number.value = c?.cargo_serial_number || '';
                    form.elements.external_reference.value = c?.cargo_external_reference || '';
                    form.elements.customer_reference.value = c?.cargo_customer_reference || '';
                    form.elements.weight_kg.value = num(c?.cargo_weight_kg);
                    form.elements.length_cm.value = num(c?.cargo_length_cm);
                    form.elements.width_cm.value = num(c?.cargo_width_cm);
                    form.elements.height_cm.value = num(c?.cargo_height_cm);
                    form.elements.status.value = c?.cargo_status || 'PLANNED';
                    form.elements.description.value = c?.cargo_description || '';
                    form.elements.notes.value = c?.cargo_notes || '';
                    form.elements.pickup_stop_id.dataset.selected = c?.cargo_pickup_stop_id || '';
                    form.elements.delivery_stop_id.dataset.selected = c?.cargo_delivery_stop_id || '';
                    refreshStopOptions();
                    toggleMachineFields();
                    document.getElementById('cargo-modal').classList.add('open');
                }
                function closeCargoForm() { document.getElementById('cargo-modal').classList.remove('open'); }
                function formPayload(form) {
                    const data = Object.fromEntries(new FormData(form).entries());
                    ['pickup_stop_id','delivery_stop_id'].forEach(k => { data[k] = data[k] ? Number(data[k]) : null; });
                    ['quantity'].forEach(k => { data[k] = data[k] ? Number(data[k]) : 1; });
                    ['weight_kg','length_cm','width_cm','height_cm'].forEach(k => { data[k] = data[k] ? Number(data[k]) : null; });
                    return data;
                }
                async function sendCargo(url, method, data) {
                    const res = await fetch(url, { method, headers:{ 'Content-Type':'application/json', 'x-csrf-token': window.adminCsrfToken }, body: JSON.stringify(data) });
                    const payload = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(payload.message || payload.error || 'Cargo request failed.');
                    return payload;
                }
                document.getElementById('cargo-form').addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const submit = document.getElementById('cargo-submit');
                    const message = document.getElementById('cargo-form-message');
                    submit.disabled = true;
                    message.innerText = 'Saving...';
                    try {
                        const data = formPayload(form);
                        if (!data.name.trim()) throw new Error('Name is required.');
                        if (!data.tour_id) throw new Error('Tour is required.');
                        if (Number(data.quantity) < 1) throw new Error('Quantity must be positive.');
                        if (data.pickup_stop_id && String(cargoStops.find(s => String(s.id) === String(data.pickup_stop_id))?.tour_id) !== String(data.tour_id)) throw new Error('Pickup stop belongs to another tour.');
                        if (data.delivery_stop_id && String(cargoStops.find(s => String(s.id) === String(data.delivery_stop_id))?.tour_id) !== String(data.tour_id)) throw new Error('Delivery stop belongs to another tour.');
                        const id = form.elements.id.value;
                        const saved = id ? await sendCargo('/api/cargo/' + encodeURIComponent(id), 'PATCH', data) : await sendCargo('/api/tours/' + encodeURIComponent(data.tour_id) + '/cargo', 'POST', data);
                        const idx = cargoRows.findIndex(c => String(c.cargo_id) === String(saved.id));
                        const tour = cargoTours.find(t => String(t.id) === String(saved.tour_id || data.tour_id)) || {};
                        const pickup = cargoStops.find(s => String(s.id) === String(saved.pickup_stop_id || data.pickup_stop_id)) || {};
                        const delivery = cargoStops.find(s => String(s.id) === String(saved.delivery_stop_id || data.delivery_stop_id)) || {};
                        const normalizedSaved = {
                            cargo_id: saved.id, cargo_uuid: saved.uuid, cargo_tour_id: saved.tour_id || data.tour_id,
                            cargo_pickup_stop_id: saved.pickup_stop_id, cargo_delivery_stop_id: saved.delivery_stop_id,
                            cargo_name: saved.name, cargo_type: saved.type, cargo_quantity: saved.quantity, cargo_unit: saved.unit,
                            cargo_serial_number: saved.serial_number, cargo_external_reference: saved.external_reference,
                            cargo_customer_reference: saved.customer_reference, cargo_status: saved.status,
                            cargo_description: saved.description, cargo_notes: saved.notes, cargo_updated_at: saved.updated_at,
                            cargo_weight_kg: saved.weight_kg, cargo_length_cm: saved.length_cm, cargo_width_cm: saved.width_cm, cargo_height_cm: saved.height_cm,
                            cargo_sync_state: saved.sync_state, cargo_revision: saved.revision,
                            tour_name: tour.name, tour_driver_name: tour.driver_name,
                            pickup_label: pickup.label, delivery_label: delivery.label
                        };
                        if (idx >= 0) Object.assign(cargoRows[idx], normalizedSaved);
                        else cargoRows.unshift(normalizedSaved);
                        message.innerText = 'Saved.';
                        closeCargoForm();
                        selectedCargoId = String(saved.id);
                        renderCargoList();
                        renderDetail(findCargo(saved.id));
                    } catch (error) {
                        message.innerText = error.message;
                    } finally {
                        submit.disabled = false;
                    }
                });
                async function setCargoStatus(id, status) {
                    if (!canWriteCargo) return;
                    try {
                        const saved = await sendCargo('/api/cargo/' + encodeURIComponent(id), 'PATCH', { status });
                        const row = findCargo(id);
                        if (row) { row.cargo_status = saved.status; row.cargo_updated_at = saved.updated_at; }
                        renderCargoList();
                        renderDetail(row);
                    } catch (error) { alert(error.message); }
                }
                async function deleteCargo(id) {
                    if (!canWriteCargo || !confirm('Soft delete this cargo record?')) return;
                    try {
                        await sendCargo('/api/cargo/' + encodeURIComponent(id), 'DELETE', {});
                        const row = findCargo(id);
                        if (row) row.cargo_deleted_at = Date.now();
                        selectedCargoId = null;
                        renderCargoList();
                        renderDetail(null);
                    } catch (error) { alert(error.message); }
                }
                seedFilters();
                renderCargoList();
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Cargo', content, activeMenu: 'cargo', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    } catch (e) {
        const content = `<div class="card" style="border-left:4px solid var(--color-error);"><h3>Cargo cannot be loaded</h3><p>Request ID: ${escapeHtml(req.requestId || 'unknown')}</p></div>`;
        res.status(500).send(renderAdminLayout({ title: 'Cargo', content, activeMenu: 'cargo', csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    }
});

// --- 7. Placeholders ---

const placeholders = ['costs', 'settings'];
placeholders.forEach(p => {
    adminRoutes.get('/' + p, requireAdmin, (req, res) => {
        const labels = { 'cargo': 'Cargo', 'costs': 'Költségek', 'worktime': 'Munkaidő', 'work-times': 'Munkaidő', 'settings': 'Beállítások' };
        const content = `<div class="card" style="text-align:center; padding:64px;"><h3>⏳ ${labels[p]} modul fejlesztés alatt</h3><p>Hamarosan...</p></div>`;
        res.send(renderAdminLayout({ title: labels[p], content, activeMenu: p.includes('work') ? 'worktime' : p, csrfToken: req.adminCsrfToken, adminRole: req.adminRole }));
    });
});

module.exports = adminRoutes;
