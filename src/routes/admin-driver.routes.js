const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const renderAdminLayout = require('../utils/admin-layout');
const { escapeHtml } = require('../utils/escape');
const crypto = require('node:crypto');

const adminDriverRoutes = express.Router();

// 1. List drivers
adminDriverRoutes.get('/admin/drivers', requireAdmin, async (req, res) => {
    try {
        const drivers = (await pool.query('SELECT * FROM drivers ORDER BY name ASC')).rows;

        const isTestData = (name) => {
            const n = (name || '').toLowerCase();
            return n.includes('test') || n.includes('demo') || n.includes('qa') || n.includes('pilot');
        };

        const rows = drivers.map(d => `
            <tr class="${isTestData(d.name) ? 'test-data-row' : ''}">
                <td>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="${escapeHtml(d.photo_url || '')}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; background:#f0f0f0;">
                        <div>
                            <div style="font-weight:600;">${escapeHtml(d.name)}</div>
                            <small style="color:#707275;">${escapeHtml(d.uuid.slice(0, 8))}...</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div>${escapeHtml(d.license_plate || '—')}</div>
                </td>
                <td>
                    <div>${escapeHtml(d.email || '—')}</div>
                    <small style="color:#707275;">${escapeHtml(d.phone || '—')}</small>
                </td>
                <td>
                    <div class="activation-code-cell" data-uuid="${d.uuid}">
                        <code>••••••••</code>
                        <button class="btn btn-outline" style="padding:4px 8px; font-size:11px; margin-left:8px;" onclick="revealCode('${d.uuid}')">Mutat</button>
                    </div>
                </td>
                <td>
                    <span class="badge ${d.is_active ? 'badge-working' : 'badge-offline'}">${d.is_active ? 'Aktív' : 'Inaktív'}</span>
                </td>
                <td style="text-align:right;">
                    <button class="btn btn-outline" onclick="editDriver('${d.uuid}')">Szerkesztés</button>
                </td>
            </tr>
        `).join('');

        const content = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <h3 style="margin:0;">Sofőrök kezelése</h3>
                <button class="btn btn-primary" onclick="newDriver()">+ Új sofőr</button>
            </div>
            <div class="card" style="padding:0; overflow:hidden;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8f9fa;">
                            <th>Sofőr</th>
                            <th>Rendszám</th>
                            <th>Elérhetőség</th>
                            <th>Aktiváló kód</th>
                            <th>Státusz</th>
                            <th style="text-align:right;">Műveletek</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="6" style="text-align:center; padding:32px;">Nincs sofőr az adatbázisban.</td></tr>'}</tbody>
                </table>
            </div>
        `;

        const scripts = `
            <script>
                async function revealCode(uuid) {
                    try {
                        const r = await adminFetch('/api/admin/drivers/' + uuid + '/code');
                        if (!r.ok) throw new Error(await r.text());
                        const { code } = await r.json();
                        const cell = document.querySelector('.activation-code-cell[data-uuid="' + uuid + '"]');
                        cell.innerHTML = '<code>' + esc(code) + '</code> <button class="btn btn-outline" style="padding:4px 8px; font-size:11px; margin-left:8px;" onclick="copyToClipboard(\\'' + code + '\\')">Másol</button> <button class="btn btn-outline" style="padding:4px 8px; font-size:11px; color:var(--color-error);" onclick="regenerateCode(\\'' + uuid + '\\')">Új</button>';
                    } catch (e) { showToast(e.message, 'error'); }
                }

                function copyToClipboard(text) {
                    navigator.clipboard.writeText(text);
                    showToast('Kód a vágólapra másolva!');
                }

                async function regenerateCode(uuid) {
                    if (!confirm('Biztosan új aktiváló kódot generálsz? A régi kód azonnal érvénytelenné válik.')) return;
                    try {
                        const r = await adminFetch('/api/admin/drivers/' + uuid + '/regenerate', { method: 'POST' });
                        if (!r.ok) throw new Error(await r.text());
                        const { code } = await r.json();
                        showToast('Új kód generálva!');
                        revealCode(uuid); // Refresh UI
                    } catch (e) { showToast(e.message, 'error'); }
                }

                function editDriver(uuid) {
                    location.href = '/admin/drivers/' + uuid;
                }

                function newDriver() {
                    location.href = '/admin/drivers/new';
                }

                async function adminFetch(url, options = {}) {
                    let token = localStorage.getItem('adminToken');
                    if (!token) {
                        token = prompt('Admin token szükséges:');
                        if (token) localStorage.setItem('adminToken', token);
                    }
                    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
                    const r = await fetch(url, { ...options, headers });
                    if (r.status === 401) {
                        localStorage.removeItem('adminToken');
                        showToast('Hiba: Érvénytelen token', 'error');
                    }
                    return r;
                }
            </script>
        `;

        res.send(renderAdminLayout({ title: 'Sofőrök', content, activeMenu: 'drivers', scripts }));
    } catch (e) { res.status(500).send(e.message); }
});

// 2. New Driver Form
adminDriverRoutes.get('/admin/drivers/new', requireAdmin, async (req, res) => {
    const content = `
        <div style="margin-bottom:24px;">
            <a href="/admin/drivers" style="text-decoration:none; color:var(--color-text-muted);">← Vissza a listához</a>
            <h3 style="margin-top:8px;">Új sofőr hozzáadása</h3>
        </div>
        <div class="card" style="max-width:800px;">
            <form id="driverForm" onsubmit="saveDriver(event)">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px;">
                    <div>
                        <label style="display:block; margin-bottom:8px; font-weight:600;">Teljes név</label>
                        <input type="text" name="name" required style="width:100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:8px; font-weight:600;">Rendszám</label>
                        <input type="text" name="license_plate" style="width:100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:8px; font-weight:600;">Email</label>
                        <input type="email" name="email" style="width:100%;">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:8px; font-weight:600;">Telefon</label>
                        <input type="text" name="phone" style="width:100%;">
                    </div>
                </div>
                <div style="margin-bottom:24px;">
                    <label style="display:block; margin-bottom:8px; font-weight:600;">Profilkép URL</label>
                    <input type="text" name="photo_url" style="width:100%;">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:12px;">
                    <button type="button" class="btn btn-outline" onclick="location.href='/admin/drivers'">Mégse</button>
                    <button type="submit" class="btn btn-primary">Sofőr mentése</button>
                </div>
            </form>
        </div>
    `;
    const scripts = `
        <script>
            async function saveDriver(e) {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData.entries());
                try {
                    const r = await adminFetch('/admin/save-driver', {
                        method: 'POST',
                        body: JSON.stringify(data)
                    });
                    if (!r.ok) throw new Error(await r.text());
                    showToast('Sofőr sikeresen létrehozva!');
                    setTimeout(() => location.href = '/admin/drivers', 1000);
                } catch (e) { showToast(e.message, 'error'); }
            }
            // Reuse adminFetch from previous scripts if needed, or include here
            async function adminFetch(url, options = {}) {
                let token = localStorage.getItem('adminToken');
                const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
                return fetch(url, { ...options, headers });
            }
        </script>
    `;
    res.send(renderAdminLayout({ title: 'Új sofőr', content, activeMenu: 'drivers', scripts }));
});

// 3. Driver Details / Edit Form
adminDriverRoutes.get('/admin/drivers/:uuid', requireAdmin, async (req, res) => {
    try {
        const d = (await pool.query('SELECT * FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        if (!d) return res.status(404).send('Sofőr nem található');

        const content = `
            <div style="margin-bottom:24px;">
                <a href="/admin/drivers" style="text-decoration:none; color:var(--color-text-muted);">← Vissza a listához</a>
                <h3 style="margin-top:8px;">${escapeHtml(d.name)} adatlapja</h3>
            </div>

            <div style="display:grid; grid-template-columns:1fr 2fr; gap:24px;">
                <div class="card" style="text-align:center;">
                    <img src="${escapeHtml(d.photo_url || '')}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; margin-bottom:16px; background:#f0f0f0;">
                    <h4 style="margin:0;">${escapeHtml(d.name)}</h4>
                    <p style="color:var(--color-text-muted); font-size:14px;">${escapeHtml(d.license_plate || 'Nincs rendszám')}</p>
                    <hr style="margin:24px 0; border:0; border-top:1px solid var(--color-border);">
                    <div style="text-align:left;">
                        <div style="margin-bottom:12px;">
                            <small style="color:var(--color-text-muted); text-transform:uppercase; font-size:10px; font-weight:700;">Aktiváló kód</small>
                            <div id="code-reveal-area" style="margin-top:4px; font-family:monospace; font-weight:700; font-size:18px;">
                                ••••••••
                                <button class="btn btn-outline" style="margin-left:12px;" onclick="revealDetailsCode('${d.uuid}')">Mutat</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <form id="editDriverForm" onsubmit="updateDriver(event)">
                        <input type="hidden" name="uuid" value="${d.uuid}">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:24px;">
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">Név</label>
                                <input type="text" name="name" value="${escapeHtml(d.name)}" required style="width:100%;">
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">Rendszám</label>
                                <input type="text" name="license_plate" value="${escapeHtml(d.license_plate || '')}" style="width:100%;">
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">Email</label>
                                <input type="email" name="email" value="${escapeHtml(d.email || '')}" style="width:100%;">
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">Telefon</label>
                                <input type="text" name="phone" value="${escapeHtml(d.phone || '')}" style="width:100%;">
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">WhatsApp</label>
                                <input type="text" name="whatsapp" value="${escapeHtml(d.whatsapp || '')}" style="width:100%;">
                            </div>
                            <div>
                                <label style="display:block; margin-bottom:8px; font-weight:600;">Telegram</label>
                                <input type="text" name="telegram" value="${escapeHtml(d.telegram || '')}" style="width:100%;">
                            </div>
                        </div>
                        <div style="margin-bottom:24px;">
                            <label style="display:block; margin-bottom:8px; font-weight:600;">Profilkép URL</label>
                            <input type="text" name="photo_url" value="${escapeHtml(d.photo_url || '')}" style="width:100%;">
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                                <input type="checkbox" name="is_active" ${d.is_active ? 'checked' : ''}>
                                Aktív felhasználó
                            </label>
                            <div style="display:flex; gap:12px;">
                                <button type="button" class="btn btn-outline" style="color:var(--color-error);" onclick="deleteDriver('${d.uuid}')">🗑 Törlés</button>
                                <button type="submit" class="btn btn-primary">Módosítások mentése</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        `;

        const scripts = `
            <script>
                async function revealDetailsCode(uuid) {
                    try {
                        const r = await adminFetch('/api/admin/drivers/' + uuid + '/code');
                        const { code } = await r.json();
                        document.getElementById('code-reveal-area').innerHTML = code + ' <button class="btn btn-outline" onclick="copyToClipboard(\\'' + code + '\\')">📋</button>';
                    } catch (e) { showToast(e.message, 'error'); }
                }

                async function updateDriver(e) {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const data = Object.fromEntries(formData.entries());
                    data.is_active = formData.get('is_active') === 'on';
                    try {
                        const r = await adminFetch('/admin/save-driver', {
                            method: 'POST',
                            body: JSON.stringify(data)
                        });
                        if (!r.ok) throw new Error(await r.text());
                        showToast('Adatok frissítve!');
                    } catch (e) { showToast(e.message, 'error'); }
                }

                async function deleteDriver(uuid) {
                    if (!confirm('Biztosan törölni szeretnéd ezt a sofőrt?')) return;
                    try {
                        const r = await adminFetch('/admin/delete-driver', {
                            method: 'POST',
                            body: JSON.stringify({ uuid })
                        });
                        if (!r.ok) throw new Error(await r.text());
                        showToast('Sofőr törölve.');
                        setTimeout(() => location.href = '/admin/drivers', 1000);
                    } catch (e) { showToast(e.message, 'error'); }
                }

                async function adminFetch(url, options = {}) {
                    let token = localStorage.getItem('adminToken');
                    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
                    return fetch(url, { ...options, headers });
                }
            </script>
        `;

        res.send(renderAdminLayout({ title: 'Sofőr részletek', content, activeMenu: 'drivers', scripts }));
    } catch (e) { res.status(500).send(e.message); }
});

// 4. API: Get activation code (authorized)
adminDriverRoutes.get('/api/admin/drivers/:uuid/code', requireAdmin, async (req, res) => {
    try {
        const d = (await pool.query('SELECT activation_code FROM drivers WHERE uuid = $1', [req.params.uuid])).rows[0];
        if (!d) return res.status(404).send('Sofőr nem található');
        res.json({ code: d.activation_code || '---' });
    } catch (e) { res.status(500).send(e.message); }
});

// 3. API: Regenerate code
adminDriverRoutes.post('/api/admin/drivers/:uuid/regenerate', requireAdmin, async (req, res) => {
    try {
        const newCode = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
        await pool.query('UPDATE drivers SET activation_code = $1 WHERE uuid = $2', [newCode, req.params.uuid]);
        // Also unlink devices as the code changed
        await pool.query('DELETE FROM driver_devices WHERE driver_uuid = $1', [req.params.uuid]);
        res.json({ code: newCode });
    } catch (e) { res.status(500).send(e.message); }
});

module.exports = adminDriverRoutes;
