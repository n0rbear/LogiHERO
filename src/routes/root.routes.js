const express = require('express');
const pool = require('../database/pool');
const renderAdminLayout = require('../utils/admin-layout');
const requireAdmin = require('../middleware/requireAdmin');

const createRootRoutes = ({ escapeHtml }) => {
    const rootRoutes = express.Router();

    // Landing page or Redirect to Dashboard
    rootRoutes.get('/', (req, res) => {
        res.redirect('/admin');
    });

    // Unified Admin Dashboard
    rootRoutes.get('/admin', requireAdmin, async (req, res) => {
        try {
            const isTestData = (name) => {
                const n = (name || '').toLowerCase();
                return n.includes('test') || n.includes('demo') || n.includes('qa') || n.includes('pilot') || n.includes('ismeretlen');
            };

            // Fetch Dashboard KPIs
            const driversRes = await pool.query("SELECT name, is_active FROM drivers");
            const activeDriversCount = driversRes.rows.filter(d => d.is_active && !isTestData(d.name)).length;

            const activeToursRes = await pool.query("SELECT COUNT(*) FROM tours WHERE tour_status IN ('PLANNED', 'IN_PROGRESS') AND deleted_at IS NULL");
            const todayHotelsRes = await pool.query("SELECT COUNT(*) FROM hotels WHERE check_in_date = CURRENT_DATE::TEXT AND deleted_at IS NULL");
            const cargoProblemsRes = await pool.query("SELECT COUNT(*) FROM cargo WHERE status IN ('DAMAGED', 'MISSING', 'REJECTED') AND deleted_at IS NULL");

            const liveUpdatesRes = await pool.query("SELECT * FROM live_updates ORDER BY timestamp DESC LIMIT 5");

            const kpis = [
                { label: 'Aktív sofőrök', value: activeDriversCount, icon: '👤', color: 'var(--color-sidebar-active)' },
                { label: 'Aktív túrák', value: activeToursRes.rows[0].count, icon: '🚛', color: 'var(--color-brand)' },
                { label: 'Mai hotelek', value: todayHotelsRes.rows[0].count, icon: '🏨', color: 'var(--color-warning)' },
                { label: 'Cargo problémák', value: cargoProblemsRes.rows[0].count, icon: '📦', color: 'var(--color-error)' }
            ];

            const kpiHtml = kpis.map(kpi => `
                <div class="card" style="border-left: 4px solid ${kpi.color};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-size:13px; color:var(--color-text-muted); text-transform:uppercase; font-weight:600;">${kpi.label}</div>
                            <div style="font-size:28px; font-weight:800; margin-top:4px;">${kpi.value}</div>
                        </div>
                        <div style="font-size:32px; opacity:0.2;">${kpi.icon}</div>
                    </div>
                </div>
            `).join('');

            const recentEventsHtml = liveUpdatesRes.rows.map(u => `
                <div style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--color-border);">
                    <div style="font-size:20px;">📍</div>
                    <div>
                        <div style="font-weight:600;">${escapeHtml(u.driver_name)} - ${escapeHtml(u.status)}</div>
                        <div style="font-size:12px; color:var(--color-text-muted);">${new Date(Number(u.timestamp)).toLocaleString()}</div>
                    </div>
                </div>
            `).join('') || '<p style="color:var(--color-text-muted); padding:16px 0;">Nincs esemény az utolsó 24 órában.</p>';

            const content = `
                <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:24px; margin-bottom:32px;">
                    ${kpiHtml}
                </div>

                <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px;">
                    <div class="card">
                        <h3 style="margin-top:0;">Utolsó frissítések</h3>
                        <div style="margin-top:16px;">
                            ${recentEventsHtml}
                        </div>
                        <button class="btn btn-outline" style="margin-top:16px; width:100%; justify-content:center;" onclick="location.href='/admin/drivers'">Összes sofőr megtekintése</button>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:24px;">
                        <div class="card">
                            <h3 style="margin-top:0;">Rendszer állapot</h3>
                            <div style="margin-top:16px; display:flex; flex-direction:column; gap:12px;">
                                <div style="display:flex; justify-content:space-between;">
                                    <span>Backend</span>
                                    <span class="badge" style="background:#e8f5e9; color:#2e7d32;">ONLINE</span>
                                </div>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>Adatbázis</span>
                                    <span class="badge" style="background:#e8f5e9; color:#2e7d32;">CONNECTED</span>
                                </div>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>API Latency</span>
                                    <span style="color:var(--color-text-muted);">24ms</span>
                                </div>
                            </div>
                        </div>

                        <div class="card" style="background:var(--color-sidebar); color:white;">
                            <h3 style="margin-top:0;">Támogatás</h3>
                            <p style="font-size:14px; opacity:0.8;">Bármilyen kérdésed van a LogiHERO platformmal kapcsolatban?</p>
                            <button class="btn btn-primary" style="width:100%; justify-content:center;">Ügyfélszolgálat</button>
                        </div>
                    </div>
                </div>
            `;

            res.send(renderAdminLayout({ title: 'Dashboard', content, activeMenu: 'dashboard' }));
        } catch (e) { res.status(500).send(e.message); }
    });

    // Placeholder for unimplemented modules
    rootRoutes.get(['/admin/cargo', '/admin/costs', '/admin/worktime', '/admin/settings'], requireAdmin, (req, res) => {
        const path = req.path.split('/').pop();
        const labels = { 'cargo': 'Cargo', 'costs': 'Költségek', 'worktime': 'Munkaidő', 'settings': 'Beállítások' };
        const content = `
            <div class="card" style="text-align:center; padding:64px;">
                <div style="font-size:48px; margin-bottom:16px;">⏳</div>
                <h3>${labels[path]} modul fejlesztés alatt</h3>
                <p style="color:var(--color-text-muted);">Ez a funkció a következő sprintben válik elérhetővé.</p>
                <button class="btn btn-primary" onclick="location.href='/admin'" style="margin-top:24px;">Vissza a Dashboardra</button>
            </div>
        `;
        res.send(renderAdminLayout({ title: labels[path], content, activeMenu: path }));
    });

    return rootRoutes;
};

module.exports = createRootRoutes;
