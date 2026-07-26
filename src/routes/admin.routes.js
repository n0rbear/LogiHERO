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
    const content = `<div class="card" style="text-align:center; padding:64px;"><h3>👤 Új sofőr felvétele</h3><p style="color:var(--color-text-muted);">Ez a funkció a következő sprintben érkezik.</p><button class="btn btn-primary" onclick="history.back()" style="margin-top:20px;">Vissza</button></div>`;
    res.send(renderAdminLayout({ title: 'Új sofőr', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken }));
});

adminRoutes.get('/drivers/:uuid', requireAdmin, async (req, res) => {
    const content = `<div class="card" style="text-align:center; padding:64px;"><h3>📝 Sofőradatlap</h3><p style="color:var(--color-text-muted);">Részletes szerkesztés a következő sprintben.</p><button class="btn btn-primary" onclick="history.back()" style="margin-top:20px;">Vissza</button></div>`;
    res.send(renderAdminLayout({ title: 'Sofőradatlap', content, activeMenu: 'drivers', csrfToken: req.adminCsrfToken }));
});

// --- 4. Hotels ---

adminRoutes.get('/hotels', requireAdmin, async (req, res) => {
    const content = `<div class="card" style="text-align:center; padding:64px;"><h3>🏨 Hotelmenedzsment</h3><p style="color:var(--color-text-muted);">Fejlesztés alatt.</p><button class="btn btn-primary" onclick="history.back()" style="margin-top:20px;">Vissza</button></div>`;
    res.send(renderAdminLayout({ title: 'Hotelek', content, activeMenu: 'hotels', csrfToken: req.adminCsrfToken }));
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
