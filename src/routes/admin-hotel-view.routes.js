const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');
const renderAdminLayout = require('../utils/admin-layout');

const adminHotelViewRoutes = express.Router();

adminHotelViewRoutes.get('/admin/hotels', requireAdmin, async (req, res) => {
    try {
        const driversRes = await pool.query('SELECT name FROM drivers WHERE is_active = true');

        const styles = `
            main.hotel-main { display: grid; grid-template-columns: 400px 1fr; gap: 24px; height: calc(100vh - 160px); }
            .hotel-sidebar { overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
            #hotel-map { background: #eee; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
            .hotel-card { background: white; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; cursor: pointer; transition: 0.2s; position: relative; }
            .hotel-card:hover { border-color: var(--color-sidebar-active); box-shadow: var(--shadow-md); }
            .hotel-card.problem { border-left: 5px solid var(--color-error); }
            .hotel-card.active { border-left: 5px solid var(--color-brand); }
            .meta { font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
            .hotel-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        `;

        const content = `
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
            <main class="hotel-main">
                <div class="hotel-sidebar">
                    <div class="card" style="padding:16px;">
                        <div class="hotel-filters">
                            <input type="text" id="hotel-search" placeholder="Név, város..." oninput="refreshHotelList()">
                            <select id="hotel-statusFilter" onchange="refreshHotelList()">
                                <option value="">Státusz</option>
                                <option value="PLANNED">Tervezett</option>
                                <option value="BOOKED">Lefoglalva</option>
                                <option value="CONFIRMED">Visszaigazolva</option>
                                <option value="CHECKED_IN">Checked In</option>
                                <option value="CHECKED_OUT">Checked Out</option>
                                <option value="CANCELLED">Lemondva</option>
                                <option value="PROBLEM">Problémás</option>
                            </select>
                            <select id="hotel-driverFilter" onchange="refreshHotelList()">
                                <option value="">Sofőr</option>
                                ${driversRes.rows.map(d => `<option value="${d.name}">${d.name}</option>`).join('')}
                            </select>
                            <input type="date" id="hotel-dateFilter" onchange="refreshHotelList()">
                        </div>
                    </div>
                    <div id="hotel-list-container" style="flex:1; overflow-y:auto;">Betöltés...</div>
                </div>
                <div id="hotel-map"></div>
            </main>
        `;

        const scripts = `
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
                const map = L.map('hotel-map').setView([47.5, 19.05], 7);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: 'OSM'
                }).addTo(map);

                let hotelMarkers = L.layerGroup().addTo(map);
                let allHotels = [];

                async function loadHotels() {
                    try {
                        const r = await fetch('/api/admin/hotels-list');
                        allHotels = await r.json();
                        refreshHotelList();
                    } catch(e) { console.error(e); }
                }

                function getHotelStatusClass(status) {
                    return 'status-' + (status || 'planned').toLowerCase();
                }

                function refreshHotelList() {
                    const q = document.getElementById('hotel-search').value.toLowerCase();
                    const status = document.getElementById('hotel-statusFilter').value;
                    const driver = document.getElementById('hotel-driverFilter').value;
                    const date = document.getElementById('hotel-dateFilter').value;

                    const filtered = allHotels.filter(h => {
                        const matchesSearch = !q || h.name.toLowerCase().includes(q) || (h.city || '').toLowerCase().includes(q);
                        const matchesStatus = !status || h.status === status;
                        const matchesDriver = !driver || h.driver_name === driver;
                        const matchesDate = !date || (h.check_in_date === date || h.check_out_date === date);
                        return matchesSearch && matchesStatus && matchesDriver && matchesDate && !h.deleted_at;
                    });

                    const list = document.getElementById('hotel-list-container');
                    list.innerHTML = filtered.map(h => \`
                        <div class="hotel-card \${h.status === 'PROBLEM' ? 'problem' : ''} \${h.status === 'CHECKED_IN' ? 'active' : ''}" onclick="focusHotel(\${h.id})">
                            <div style="display:flex; justify-content:space-between; align-items:start;">
                                <h4 style="margin:0;">\${esc(h.name)}</h4>
                                <span class="badge \${getHotelStatusClass(h.status)}">\${h.status}</span>
                            </div>
                            <div class="meta">📍 \${esc(h.city || '—')}</div>
                            <div class="meta">👤 Sofőr: <b>\${esc(h.driver_name || '—')}</b></div>
                            <div class="meta">📅 Check-in: <b>\${h.check_in_date || '—'}</b></div>
                        </div>
                    \`).join('') || '<p style="text-align:center; color:var(--color-text-muted); margin-top:32px;">Nincs találat.</p>';

                    updateHotelMap(filtered);
                }

                function updateHotelMap(hotels) {
                    hotelMarkers.clearLayers();
                    const bounds = [];
                    hotels.forEach(h => {
                        if (h.latitude && h.longitude && Math.abs(h.latitude) > 0.0001) {
                            const marker = L.marker([h.latitude, h.longitude])
                                .addTo(hotelMarkers)
                                .bindPopup(\`
                                    <b>\${esc(h.name)}</b><br>
                                    \${esc(h.address_line_1 || '')}<br>
                                    Sofőr: \${esc(h.driver_name)}<br>
                                    <a href="https://www.google.com/maps/search/?api=1&query=\${h.latitude},\${h.longitude}" target="_blank">Google Maps</a>
                                \`);
                            marker.hotelId = h.id;
                            bounds.push([h.latitude, h.longitude]);
                        }
                    });
                    if (bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
                }

                function focusHotel(id) {
                    const m = hotelMarkers.getLayers().find(l => l.hotelId === id);
                    if (m) {
                        map.setView(m.getLatLng(), 15);
                        m.openPopup();
                    }
                }

                loadHotels();
            </script>
        `;

        res.send(renderAdminLayout({ title: 'Hotelek', content, activeMenu: 'hotels', styles, scripts }));
    } catch (e) { res.status(500).send(e.message); }
});

adminHotelViewRoutes.get('/api/admin/hotels-list', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hotels WHERE deleted_at IS NULL ORDER BY updated_at DESC');
        res.json(result.rows);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

module.exports = adminHotelViewRoutes;
