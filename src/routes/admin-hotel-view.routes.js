const express = require('express');
const pool = require('../database/pool');
const requireAdmin = require('../middleware/requireAdmin');

const adminHotelViewRoutes = express.Router();

adminHotelViewRoutes.get('/admin/hotels', requireAdmin, async (req, res) => {
    try {
        const toursRes = await pool.query('SELECT id, name, driver_name FROM tours WHERE deleted_at IS NULL');
        const driversRes = await pool.query('SELECT name FROM drivers WHERE is_active = true');

        res.send(`<!DOCTYPE html>
<html>
<head>
    <title>LogiHERO | Hotel Operatív Nézet</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
        :root {
            --bg: #f6faf7;
            --surface: #fff;
            --ink: #16211d;
            --muted: #607069;
            --brand: #16884f;
            --border: #d9e4dd;
            --warn: #b7791f;
            --err: #c73535;
        }
        body { font-family: Arial, sans-serif; margin: 0; background: var(--bg); color: var(--ink); display: flex; flex-direction: column; height: 100vh; }
        header { background: #26312d; color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; }
        main { display: grid; grid-template-columns: 450px 1fr; flex-grow: 1; overflow: hidden; }
        .sidebar { background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 20px; }
        #map { background: #eee; }
        .hotel-card { border: 1px solid var(--border); border-radius: 8px; padding: 15px; margin-bottom: 15px; cursor: pointer; transition: 0.2s; position: relative; }
        .hotel-card:hover { border-color: var(--brand); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .hotel-card.problem { border-left: 5px solid var(--err); }
        .hotel-card.active { border-left: 5px solid var(--brand); }
        .status-badge { font-size: 11px; padding: 3px 8px; border-radius: 10px; font-weight: bold; text-transform: uppercase; }
        .status-planned { background: #eee; color: #777; }
        .status-booked { background: #e3f2fd; color: #1976d2; }
        .status-confirmed { background: #e8f5e9; color: #2e7d32; }
        .status-checked_in { background: #16884f; color: white; }
        .status-checked_out { background: #26312d; color: white; }
        .status-cancelled { background: #ffebee; color: #c62828; }
        .status-problem { background: #fff3e0; color: #ef6c00; }
        .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
        input, select { padding: 8px; border: 1px solid var(--border); border-radius: 4px; width: 100%; box-sizing: border-box; }
        .btn { background: var(--brand); color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; width: 100%; }
        h3 { margin-top: 0; }
        .meta { font-size: 12px; color: var(--muted); margin-top: 5px; }
        .meta b { color: var(--ink); }
    </style>
</head>
<body>
    <header>
        <h1 style="margin:0; font-size:20px;">🏨 Hotel Operatív Nézet</h1>
        <button onclick="location.href='/'" style="background:none; border:1px solid #555; color:#ccc; padding:5px 15px; border-radius:4px; cursor:pointer;">Vissza</button>
    </header>
    <main>
        <div class="sidebar">
            <div class="filters">
                <input type="text" id="search" placeholder="Név, város..." oninput="refreshList()">
                <select id="statusFilter" onchange="refreshList()">
                    <option value="">Összes státusz</option>
                    <option value="PLANNED">Tervezett</option>
                    <option value="BOOKED">Lefoglalva</option>
                    <option value="CONFIRMED">Visszaigazolva</option>
                    <option value="CHECKED_IN">Checked In</option>
                    <option value="CHECKED_OUT">Checked Out</option>
                    <option value="CANCELLED">Lemondva</option>
                    <option value="PROBLEM">Problémás</option>
                </select>
                <select id="driverFilter" onchange="refreshList()">
                    <option value="">Összes sofőr</option>
                    ${driversRes.rows.map(d => `<option value="${d.name}">${d.name}</option>`).join('')}
                </select>
                <input type="date" id="dateFilter" onchange="refreshList()">
            </div>
            <div id="hotel-list">Betöltés...</div>
        </div>
        <div id="map"></div>
    </main>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        const map = L.map('map').setView([47.5, 19.05], 7);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        let hotelMarkers = L.layerGroup().addTo(map);
        let allHotels = [];

        async function loadHotels() {
            try {
                // Fetch all hotels (admin view)
                const r = await fetch('/api/admin/hotels-list');
                allHotels = await r.json();
                refreshList();
            } catch(e) { console.error(e); }
        }

        function getStatusClass(status) {
            return 'status-' + (status || 'planned').toLowerCase();
        }

        function refreshList() {
            const q = document.getElementById('search').value.toLowerCase();
            const status = document.getElementById('statusFilter').value;
            const driver = document.getElementById('driverFilter').value;
            const date = document.getElementById('dateFilter').value;

            const filtered = allHotels.filter(h => {
                const matchesSearch = !q || h.name.toLowerCase().includes(q) || (h.city || '').toLowerCase().includes(q);
                const matchesStatus = !status || h.status === status;
                const matchesDriver = !driver || h.driver_name === driver;
                const matchesDate = !date || (h.check_in_date === date || h.check_out_date === date);
                return matchesSearch && matchesStatus && matchesDriver && matchesDate && !h.deleted_at;
            });

            const list = document.getElementById('hotel-list');
            list.innerHTML = filtered.map(h => \`
                <div class="hotel-card \${h.status === 'PROBLEM' ? 'problem' : ''} \${h.status === 'CHECKED_IN' ? 'active' : ''}" onclick="focusHotel(\${h.id})">
                    <span class="status-badge \${getStatusClass(h.status)}">\${h.status}</span>
                    <h3 style="margin: 10px 0 5px 0;">\${h.name}</h3>
                    <div class="meta">📍 \${h.city || 'Nincs város megadva'}</div>
                    <div class="meta">👤 Sofőr: <b>\${h.driver_name || 'Nincs rendelve'}</b></div>
                    <div class="meta">📅 Check-in: <b>\${h.check_in_date || '---'} \${h.check_in_time || ''}</b></div>
                    <div class="meta">🔑 Foglalás: <b>\${h.booking_number || '---'}</b></div>
                </div>
            \`).join('') || '<p>Nincs találat.</p>';

            updateMap(filtered);
        }

        function updateMap(hotels) {
            hotelMarkers.clearLayers();
            const bounds = [];
            hotels.forEach(h => {
                if (h.latitude && h.longitude && Math.abs(h.latitude) > 0.0001) {
                    const marker = L.marker([h.latitude, h.longitude])
                        .addTo(hotelMarkers)
                        .bindPopup(\`
                            <b>\${h.name}</b><br>
                            \${h.address_line_1 || ''}<br>
                            Sofőr: \${h.driver_name}<br>
                            Státusz: \${h.status}<br>
                            <a href="https://www.google.com/maps/search/?api=1&query=\${h.latitude},\${h.longitude}" target="_blank">Google Maps</a> |
                            <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=\${h.latitude},\${h.longitude}" target="_blank">Street View</a>
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
</body>
</html>`);
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
