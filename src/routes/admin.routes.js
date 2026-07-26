const express = require('express');
const pool = require('../database/pool');
const renderAdminLayout = require('../utils/admin-layout');
const requireAdmin = require('../middleware/requireAdmin');
const { ADMIN_TOKEN, IS_DEPLOYED } = require('../config/env');
const { escapeHtml } = require('../utils/escape');
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
                    setTimeout(() => location.href = payload.uuid ? '/admin/drivers/' + payload.uuid : '/admin/drivers', 450);
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

adminRoutes.post('/login', (req, res) => {
    const { token } = req.body;
    if (verifyAdminToken(token, ADMIN_TOKEN)) {
        const session = createAdminSession();
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
        res.send(renderAdminLayout({ title: 'Dashboard', content, activeMenu: 'dashboard', csrfToken: req.adminCsrfToken }));
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
                        cell.innerHTML = '<code>' + code + '</code> <button class="btn btn-outline" style="padding:2px 8px; font-size:10px;" onclick="navigator.clipboard.writeText(\\''+code+'\\');showToast(\\'Vágólapra másolva!\\')">📋</button> <button class="btn btn-outline" style="padding:2px 8px; font-size:10px; color:var(--color-error);" onclick="regenerateCode(\\''+uuid+'\\')">🔄</button>';
                    }
                }
                async function regenerateCode(uuid) {
                    if(!confirm('Új kódot generálsz? A régi azonnal érvényét veszti.')) return;
                    const r = await fetch('/admin/api/drivers/' + uuid + '/regenerate', { method: 'POST', headers: { 'x-csrf-token': window.adminCsrfToken } });
                    if(r.ok) { showToast('Új kód generálva!'); revealCode(uuid); }
                }
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Sofőrök', content, activeMenu: 'drivers', scripts, csrfToken: req.adminCsrfToken }));
    } catch (e) { res.status(500).send(e.message); }
});

adminRoutes.get('/drivers/new', requireAdmin, (req, res) => {
    const content = renderDriverForm({ mode: 'new', csrfToken: req.adminCsrfToken });
    res.send(renderAdminLayout({ title: 'Új sofőr', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken }));
});

adminRoutes.get('/drivers/:uuid', requireAdmin, async (req, res) => {
    if (!UUID_RE.test(req.params.uuid)) return res.status(400).send(renderAdminLayout({
        title: 'Hibás sofőr azonosító',
        activeMenu: 'drivers',
        csrfToken: req.adminCsrfToken,
        content: '<div class="card">Hibás sofőr UUID.</div>'
    }));
    try {
        const driver = (await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        if (!driver) return res.status(404).send(renderAdminLayout({
            title: 'Sofőr nem található',
            activeMenu: 'drivers',
            csrfToken: req.adminCsrfToken,
            content: '<div class="card">Sofőr nem található.</div>'
        }));
        const tours = (await pool.query('SELECT id, name, tour_status, date, is_current FROM tours WHERE driver_uuid = $1 OR driver_name = $2 ORDER BY date DESC LIMIT 8', [driver.uuid, driver.name])).rows;
        const devices = (await pool.query('SELECT device_id, device_name, is_active, linked_at, last_seen_at FROM driver_devices WHERE driver_uuid = $1 ORDER BY last_seen_at DESC NULLS LAST', [driver.uuid])).rows;
        const lastUpdate = (await pool.query('SELECT status, current_tour, timestamp FROM live_updates WHERE driver_uuid = $1 OR driver_name = $2 ORDER BY timestamp DESC LIMIT 1', [driver.uuid, driver.name])).rows[0];

        const tourRows = tours.map(t => `
            <tr><td>#${t.id}</td><td>${escapeHtml(t.name || '—')}</td><td>${escapeHtml(t.tour_status || '—')}</td><td>${formatDateTime(t.date)}</td><td>${t.is_current ? 'Igen' : 'Nem'}</td></tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;">Nincs kapcsolódó túra.</td></tr>';
        const deviceRows = devices.map(d => `
            <tr><td>${escapeHtml(d.device_name || '—')}</td><td><code>${escapeHtml(d.device_id || '')}</code></td><td>${d.is_active ? 'Aktív' : 'Leválasztva'}</td><td>${formatDateTime(d.last_seen_at)}</td></tr>
        `).join('') || '<tr><td colspan="4" style="text-align:center;">Nincs eszközadat.</td></tr>';

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
                        <table style="width:100%; border-collapse:collapse;"><thead><tr><th>Név</th><th>Device ID</th><th>Állapot</th><th>Utolsó</th></tr></thead><tbody>${deviceRows}</tbody></table>
                    </div>
                </div>
                <div>
                    ${renderDriverForm({ driver, mode: 'edit', csrfToken: req.adminCsrfToken })}
                    <div class="card">
                        <h4 style="margin-top:0;">Kapcsolódó túrák</h4>
                        <table style="width:100%; border-collapse:collapse;"><thead><tr><th>ID</th><th>Név</th><th>Státusz</th><th>Dátum</th><th>Aktuális</th></tr></thead><tbody>${tourRows}</tbody></table>
                    </div>
                    <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                        <div><b>Sofőr deaktiválása</b><br><small style="color:var(--color-text-muted);">Az üzleti adatok megmaradnak, a sofőr inaktív lesz.</small></div>
                        <button class="btn btn-outline" style="color:var(--color-error);" onclick="deactivateDriver()">Deaktiválás</button>
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
                    if (!res.ok) return showToast('Deaktiválás sikertelen.', 'error');
                    showToast('Sofőr deaktiválva.');
                    setTimeout(() => location.reload(), 500);
                }
            </script>
        `;
        res.send(renderAdminLayout({ title: 'Sofőradatlap', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken }));
    } catch (e) { res.status(500).send(e.message); }
});

// --- 4. Hotels ---

adminRoutes.get('/hotels', requireAdmin, async (req, res) => {
    try {
        const drivers = (await pool.query('SELECT name FROM drivers WHERE is_active = true ORDER BY name ASC')).rows;
        const hotels = (await pool.query(`
            SELECT id, uuid::TEXT, 'hotel'::TEXT AS source, driver_name, name,
                   COALESCE(address_line_1, address) AS address, address_line_1, city, country,
                   latitude, longitude, phone, email, room_number, entry_code, booking_number,
                   check_in_date, check_out_date, status, notes, updated_at
            FROM hotels
            WHERE deleted_at IS NULL
            UNION ALL
            SELECT id, uuid::TEXT, 'stop'::TEXT AS source, NULL::TEXT AS driver_name,
                   COALESCE(recipient, address_full) AS name, address_full AS address,
                   address_full AS address_line_1, city, country, latitude, longitude,
                   phone_number AS phone, email, room_number, entry_code, booking_number,
                   stop_date::TEXT AS check_in_date, NULL::TEXT AS check_out_date,
                   stop_status AS status, notes, updated_at
            FROM stops
            WHERE deleted_at IS NULL AND stop_type = 'HOTEL'
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
        `;
        const driverOptions = drivers.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
        const content = `
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
            <div class="hotel-main">
                <div class="hotel-sidebar">
                    <div class="card" style="padding:16px;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <input id="hotel-search" type="text" placeholder="Név, cím, város..." oninput="renderHotels()" style="width:100%;">
                            <select id="hotel-driver" onchange="renderHotels()"><option value="">Minden sofőr</option>${driverOptions}</select>
                            <select id="hotel-status" onchange="renderHotels()">
                                <option value="">Minden státusz</option><option>PLANNED</option><option>BOOKED</option><option>CONFIRMED</option><option>CHECKED_IN</option><option>CHECKED_OUT</option><option>CANCELLED</option><option>PROBLEM</option>
                            </select>
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
                            <button type="submit" class="btn btn-primary">Hotel mentése</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        const scripts = `
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
                const hotels = ${scriptJson(hotels)};
                const map = L.map('hotel-map').setView([47.5, 19.04], 7);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OSM' }).addTo(map);
                const layer = L.layerGroup().addTo(map);
                let selectedId = null;
                function hotelKey(h) { return h.source + ':' + h.id; }
                function filteredHotels() {
                    const q = document.getElementById('hotel-search').value.toLowerCase();
                    const driver = document.getElementById('hotel-driver').value;
                    const status = document.getElementById('hotel-status').value;
                    const date = document.getElementById('hotel-date').value;
                    return hotels.filter(h => {
                        const hay = [h.name, h.address, h.city, h.driver_name].join(' ').toLowerCase();
                        return (!q || hay.includes(q)) && (!driver || h.driver_name === driver) && (!status || h.status === status) && (!date || h.check_in_date === date || h.check_out_date === date);
                    });
                }
                function renderHotels() {
                    const list = document.getElementById('hotel-list');
                    const rows = filteredHotels();
                    list.innerHTML = rows.map(h => '<div class="hotel-card '+(hotelKey(h)===selectedId?'active':'')+'" onclick="selectHotel(\\''+hotelKey(h)+'\\')"><div style="display:flex; justify-content:space-between; gap:12px;"><b>'+esc(h.name || '')+'</b><span class="badge badge-working">'+esc(h.status || 'PLANNED')+'</span></div><div class="meta">'+esc(h.address || h.city || '')+'</div><div class="meta">Sofőr: '+esc(h.driver_name || '—')+'</div></div>').join('') || '<div class="card">Nincs találat.</div>';
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
                    document.getElementById('hotel-detail').innerHTML = '<div style="display:flex; justify-content:space-between; gap:12px;"><h3 style="margin-top:0;">'+esc(h.name || '')+'</h3><button class="btn btn-primary" onclick="openHotelModal(\\''+key+'\\')">Szerkesztés</button></div><p>'+esc(h.address || '')+'</p><p><b>Koordináták:</b> '+esc(h.latitude || '—')+', '+esc(h.longitude || '—')+'</p><p><b>Telefon:</b> '+esc(h.phone || '—')+' &nbsp; <b>Email:</b> '+esc(h.email || '—')+'</p><p><b>Megjegyzés:</b> '+esc(h.notes || '—')+'</p>' + (h.latitude && h.longitude ? '<a class="btn btn-outline" target="_blank" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(h.latitude+','+h.longitude)+'">Google Maps</a>' : '');
                    renderHotels();
                }
                function openHotelModal(key) {
                    const h = hotels.find(item => hotelKey(item) === key);
                    const form = document.getElementById('hotel-form');
                    ['source','id','uuid','name','driver_name','address_line_1','city','latitude','longitude','phone','email','room_number','entry_code','booking_number','check_in_date','check_out_date','status','notes'].forEach(name => {
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
        res.send(renderAdminLayout({ title: 'Hotelek', content, activeMenu: 'hotels', styles, scripts, csrfToken: req.adminCsrfToken }));
    } catch (e) { res.status(500).send(e.message); }
});

// --- 5. Internal API ---

adminRoutes.get('/api/drivers/:uuid/code', requireAdmin, async (req, res) => {
    try {
        const d = (await pool.query('SELECT activation_code FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        res.json({ code: d?.activation_code || '---' });
    } catch (e) { res.status(500).send(e.message); }
});

adminRoutes.post('/api/drivers/:uuid/regenerate', requireAdmin, async (req, res) => {
    try {
        const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        await pool.query('UPDATE drivers SET activation_code = $1 WHERE uuid = $2', [newCode, req.params.uuid]);
        res.json({ code: newCode });
    } catch (e) { res.status(500).send(e.message); }
});

// --- 6. Placeholders ---

const placeholders = ['cargo', 'costs', 'worktime', 'work-times', 'settings'];
placeholders.forEach(p => {
    adminRoutes.get('/' + p, requireAdmin, (req, res) => {
        const labels = { 'cargo': 'Cargo', 'costs': 'Költségek', 'worktime': 'Munkaidő', 'work-times': 'Munkaidő', 'settings': 'Beállítások' };
        const content = `<div class="card" style="text-align:center; padding:64px;"><h3>⏳ ${labels[p]} modul fejlesztés alatt</h3><p>Hamarosan...</p></div>`;
        res.send(renderAdminLayout({ title: labels[p], content, activeMenu: p.includes('work') ? 'worktime' : p, csrfToken: req.adminCsrfToken }));
    });
});

module.exports = adminRoutes;
