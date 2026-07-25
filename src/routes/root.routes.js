const express = require('express');
const pool = require('../database/pool');

const createRootRoutes = ({ escapeHtml }) => {
    const rootRoutes = express.Router();

rootRoutes.get(['/', '/admin/'], async (req, res) => {
    try {
        const driversRes = await pool.query(`
            SELECT DISTINCT ON (all_drivers.driver_name)
                all_drivers.driver_name,
                d.photo_url as driver_photo,
                all_drivers.status,
                COALESCE(d.license_plate, all_drivers.license_plate) as license_plate,
                all_drivers.timestamp
            FROM (
                SELECT driver_name, status, license_plate, timestamp::BIGINT, 1 as source_rank FROM live_updates
                UNION ALL
                SELECT driver_name, 'Túra feltöltve' as status, '' as license_plate, date::BIGINT as timestamp, 2 as source_rank FROM tours WHERE deleted_at IS NULL
                UNION ALL
                SELECT name as driver_name, 'Új sofőr' as status, license_plate, COALESCE(profile_updated_at, created_at, 0)::BIGINT as timestamp, 3 as source_rank FROM drivers WHERE is_active = true
            ) AS all_drivers
            LEFT JOIN drivers d ON d.name = all_drivers.driver_name
            ORDER BY all_drivers.driver_name, all_drivers.source_rank ASC, all_drivers.timestamp DESC
        `);
        let list = driversRes.rows.map(d => '<div class="card driver-card" data-driver-name="' + escapeHtml(d.driver_name) + '"><img src="' + escapeHtml(d.driver_photo || '') + '" style="width:50px;height:50px;border-radius:50%;float:right;background:#444;object-fit:cover;"><h3>' + escapeHtml(d.driver_name) + '</h3><p>' + escapeHtml(d.status) + (d.license_plate ? ' | ' + escapeHtml(d.license_plate) : '') + '</p></div>').join('');
        res.send(`<html><head><title>LogiHERO Admin</title><style>
            :root {
                --color-background: #f6faf7;
                --color-surface: #ffffff;
                --color-surface-muted: #edf5ef;
                --color-header: #26312d;
                --color-text-primary: #16211d;
                --color-text-secondary: #607069;
                --color-brand: #16884f;
                --color-brand-hover: #0f6f3e;
                --color-border: #d9e4dd;
                --color-success: #16884f;
                --color-warning: #b7791f;
                --color-error: #c73535;
                --radius-small: 4px;
                --radius-medium: 8px;
                --radius-large: 12px;
                --shadow-card: 0 10px 28px rgba(22, 33, 29, 0.08);
                --spacing-small: 8px;
                --spacing-medium: 16px;
                --spacing-large: 28px;
            }
            body { font-family: Arial, sans-serif; background: var(--color-background); color: var(--color-text-primary); padding: 40px; margin: 0; }
            body::before { content: ""; position: fixed; inset: 0 0 auto 0; height: 88px; background: var(--color-header); z-index: -1; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .card { background: var(--color-surface); padding: 20px; border-radius: var(--radius-medium); cursor: pointer; border-left: 6px solid var(--color-brand); transition: 0.2s; box-shadow: var(--shadow-card); }
            .card:hover { transform: translateY(-2px); background: var(--color-surface-muted); }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { text-align: left; padding: 12px; border-bottom: 1px solid var(--color-border); }
            input, select { padding: 8px; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-primary); border-radius: var(--radius-small); }
            .btn-admin { background: var(--color-brand); color: white; padding: 10px 20px; border-radius: var(--radius-medium); border: none; cursor: pointer; font-weight: bold; margin-bottom: 20px; }
            .btn-admin:hover { background: var(--color-brand-hover); }
            .section { display: none; }
            .section.active { display: block; }
            #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
            .toast { background: var(--color-success); color: white; padding: 12px 24px; border-radius: var(--radius-medium); margin-top: 10px; box-shadow: var(--shadow-card); animation: slideIn 0.3s, fadeOut 0.5s 2.5s forwards; }
            h1 { color: white; letter-spacing: 0; }
            h3 { color: var(--color-text-primary); }
            @media (max-width: 720px) {
                body { padding: 20px 14px; }
                body::before { height: 120px; }
                .grid { grid-template-columns: 1fr; }
                table { display: block; overflow-x: auto; }
                input, select, button { max-width: 100%; }
            }
            @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        </style></head>
        <body>
            <div id="toast-container"></div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h1>🚛 Flotta kiválasztása</h1>
                <button class="btn-admin" id="admin-toggle" onclick="toggleAdmin()">⚙️ SOFŐRÖK KEZELÉSE</button>
            </div>

            <div id="fleet-section" class="section active">
                <div class="grid" id="driver-grid">${list}</div>
            </div>

            <div id="admin-section" class="section">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>SOFŐRÖK LISTÁJA</h3>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="importCode" placeholder="Aktiváló kód" style="width:150px;">
                        <button onclick="importDriver()" style="background:#3498db; color:white; padding:10px; border:none; border-radius:4px; cursor:pointer;">Importálás</button>
                        <button onclick="editDriver()" style="background:#2ecc71; color:white; padding:10px 20px; border:none; border-radius:4px; cursor:pointer;">+ Új sofőr</button>
                    </div>
                </div>
                <table>
                    <thead><tr><th>Név</th><th>Email / Telefon</th><th>Rendszám</th><th>Aktiváló kód</th><th>Állapot</th><th>Művelet</th></tr></thead>
                    <tbody id="drivers-list"></tbody>
                </table>
            </div>

            <div id="driverModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1001; padding:50px;">
                <div style="background:#222; padding:30px; border-radius:12px; max-width:600px; margin:auto;">
                    <h2>Sofőr szerkesztése</h2>
                    <input type="hidden" id="dUuid">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="position: relative; display: inline-block;">
                            <img id="dPhotoPreview" src="" style="width:100px; height:100px; border-radius:50%; background:#333; object-fit: cover; border: 2px solid #444;">
                            <label for="admin-photo-upload" style="position: absolute; bottom: 0; right: 0; background: #3498db; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid #222;">📷</label>
                            <input type="file" id="admin-photo-upload" style="display: none;" onchange="uploadAdminPhoto(this)" accept="image/*">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
                        <div><label style="display:block; font-size:11px; color:#aaa;">Név</label><input type="text" id="dName" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Rendszám</label><input type="text" id="dPlate" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Email</label><input type="text" id="dEmail" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Telefon</label><input type="text" id="dPhone" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">WhatsApp</label><input type="text" id="dWhatsapp" style="width:100%"></div>
                        <div><label style="display:block; font-size:11px; color:#aaa;">Telegram</label><input type="text" id="dTelegram" style="width:100%"></div>
                    </div>
                    <div><label style="display:block; font-size:11px; color:#aaa;">Profilkép URL</label><input type="text" id="dPhoto" style="width:100%"></div>
                    <div style="margin-top:15px;">
                        <input type="checkbox" id="dActive" checked style="width:20px; height:20px; display:inline-block; vertical-align:middle;">
                        <label style="display:inline-block; margin-left:10px;">Aktív felhasználó</label>
                    </div>
                    <div style="margin-top:30px; display:flex; gap:10px; justify-content:flex-end;">
                        <button onclick="document.getElementById('driverModal').style.display='none'">Mégse</button>
                        <button onclick="saveDriver()" style="background:#3498db; color:white; padding:10px 30px; border:none; border-radius:4px; cursor:pointer;">Mentés</button>
                    </div>
                </div>
            </div>

            <script>
                function esc(value) {
                    return String(value ?? '').replace(/[&<>"']/g, ch => ({
                        '&': '&amp;',
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#39;'
                    }[ch]));
                }
                function toggleAdmin() {
                    const isAdmin = document.getElementById('admin-section').classList.toggle('active');
                    document.getElementById('fleet-section').classList.toggle('active', !isAdmin);
                    document.getElementById('admin-toggle').innerText = isAdmin ? '⬅️ VISSZA A FLOTTÁHOZ' : '⚙️ SOFŐRÖK KEZELÉSE';
                    if (isAdmin) refreshDrivers();
                }

                async function refreshFleet() {
                    if (document.getElementById('admin-section').classList.contains('active')) return;
                    try {
                        const r = await fetch('/api/fleet-status');
                        if (!r.ok) return;
                        const drivers = await r.json();
                        const grid = document.getElementById('driver-grid');
                        grid.innerHTML = drivers.map(d =>
                            '<div class="card driver-card" data-driver-name="' + esc(d.driver_name) + '">' +
                                '<img src="' + esc(d.driver_photo || '') + '" style="width:50px;height:50px;border-radius:50%;float:right;background:#444;object-fit:cover;">' +
                                '<h3>' + esc(d.driver_name) + '</h3>' +
                                '<p>' + esc(d.status) + (d.license_plate ? ' | ' + esc(d.license_plate) : '') + '</p>' +
                            '</div>').join('');
                        bindDriverCards();
                    } catch (e) { console.error('Fleet refresh error:', e); }
                }

                function bindDriverCards() {
                    document.querySelectorAll('.driver-card').forEach(card => {
                        card.onclick = () => {
                            const driverName = card.dataset.driverName || '';
                            if (driverName) location.href = '/driver/' + encodeURIComponent(driverName);
                        };
                    });
                }

                async function refreshDrivers() {
                    const r = await fetch('/api/all-drivers');
                    const drivers = await r.json();
                    document.getElementById('drivers-list').innerHTML = drivers.map(d =>
                        '<tr>' +
                            '<td>' +
                                '<small style="color:#777;display:block;">#' + d.id + ' | ' + (d.uuid || '').slice(0,8) + '...</small>' +
                                '<img src="' + esc(d.photo_url || '') + '" style="width:30px;height:30px;border-radius:50%;vertical-align:middle;margin-right:10px;background:#444;object-fit:cover;">' +
                                '<b>' + esc(d.name) + '</b>' +
                            '</td>' +
                            '<td>' + esc(d.email || '') + '<br><small>' + esc(d.phone || '') + '</small></td>' +
                            '<td>' + esc(d.license_plate || '') + '</td>' +
                            '<td><code style="background:#444; padding:2px 5px;">' + esc(d.activation_code || '---') + '</code></td>' +
                            '<td><span style="color:' + (d.is_active ? '#2ecc71' : '#e74c3c') + '">' + (d.is_active ? 'AKTÍV' : 'INAKTÍV') + '</span></td>' +
                            '<td>' +
                                '<button data-driver="' + encodeURIComponent(JSON.stringify(d)) + '" onclick="editDriver(JSON.parse(decodeURIComponent(this.dataset.driver)))">✏</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="unlinkDriverDevices(this.dataset.uuid)" style="background:#f39c12; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">📱 leválaszt</button>' +
                                '<button data-uuid="' + esc(d.uuid) + '" onclick="deleteDriver(this.dataset.uuid)" style="background:#e74c3c; color:white; border:none; border-radius:4px; padding:5px 10px; cursor:pointer;">🗑</button>' +
                            '</td>' +
                        '</tr>').join('');
                }

                function editDriver(d) {
                    document.getElementById('dUuid').value = d ? d.uuid : '';
                    document.getElementById('dName').value = d ? d.name : '';
                    document.getElementById('dPlate').value = d ? d.license_plate : '';
                    document.getElementById('dEmail').value = d ? d.email : '';
                    document.getElementById('dPhone').value = d ? d.phone : '';
                    document.getElementById('dWhatsapp').value = d ? d.whatsapp : '';
                    document.getElementById('dTelegram').value = d ? d.telegram : '';
                    document.getElementById('dPhoto').value = d ? d.photo_url : '';
                    document.getElementById('dPhotoPreview').src = d ? (d.photo_url || '') : '';
                    document.getElementById('dActive').checked = d ? d.is_active : true;
                    document.getElementById('driverModal').style.display = 'block';
                }

                async function uploadAdminPhoto(input) {
                    if (!input.files || !input.files[0]) return;
                    const file = input.files[0];
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const base64 = e.target.result.split(',')[1];
                        const res = await fetch('/api/upload-photo', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                uuid: document.getElementById('dUuid').value,
                                driverName: document.getElementById('dName').value,
                                imageBase64: base64
                            })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            document.getElementById('dPhotoPreview').src = data.photoUrl;
                            document.getElementById('dPhoto').value = data.photoUrl;
                            showToast('Kép feltöltve!');
                        }
                    };
                    reader.readAsDataURL(file);
                }

                async function saveDriver() {
                    const data = {
                        uuid: document.getElementById('dUuid').value || null,
                        name: document.getElementById('dName').value,
                        license_plate: document.getElementById('dPlate').value,
                        email: document.getElementById('dEmail').value,
                        phone: document.getElementById('dPhone').value,
                        whatsapp: document.getElementById('dWhatsapp').value,
                        telegram: document.getElementById('dTelegram').value,
                        photo_url: document.getElementById('dPhoto').value,
                        is_active: document.getElementById('dActive').checked
                    };
                    const r = await adminFetch('/admin/save-driver', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                    if(r.ok) {
                        showToast('Sofőr adatai mentve!');
                        document.getElementById('driverModal').style.display = 'none';
                        refreshDrivers();
                    }
                }

                async function deleteDriver(uuid) {
                    if (!confirm('Biztosan törölni szeretnéd ezt a sofőrt? Minden adata elvész!')) return;
                    const r = await adminFetch('/admin/delete-driver', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid })
                    });
                    if (r.ok) {
                        showToast('Sofőr törölve.');
                        refreshDrivers();
                    }
                }

                async function unlinkDriverDevices(uuid) {
                    if (!confirm('Leválasztod a sofőr társított telefonjait? A sofőr és az adatai megmaradnak.')) return;
                    const r = await adminFetch('/admin/unlink-driver-devices', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ uuid })
                    });
                    if (r.ok) {
                        showToast('Telefonos társítás leválasztva.');
                        refreshDrivers();
                    }
                }

                async function importDriver() {
                    const code = document.getElementById('importCode').value.trim();
                    if (!code) return;
                    try {
                        const r = await fetch('/api/activate-driver', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ code })
                        });
                        if (r.ok) {
                            const driver = await r.json();
                            showToast('Sofőr importálva: ' + driver.name);
                            document.getElementById('importCode').value = '';
                            refreshDrivers();
                        } else {
                            alert('Érvénytelen kód vagy a sofőr már importálva van.');
                        }
                    } catch (e) { console.error('Import error:', e); }
                }

                function showToast(msg) {
                    const c = document.getElementById('toast-container');
                    const t = document.createElement('div');
                    t.className = 'toast';
                    t.innerText = msg;
                    c.appendChild(t);
                    setTimeout(() => t.remove(), 3000);
                }

                function getAdminToken() {
                    let token = localStorage.getItem('adminToken') || '';
                    if (!token) {
                        token = prompt('Admin token:') || '';
                        if (token) localStorage.setItem('adminToken', token);
                    }
                    return token;
                }

                async function adminFetch(url, options = {}, retry = true) {
                    const token = getAdminToken();
                    const headers = Object.assign({}, options.headers || {});
                    if (token) headers.Authorization = 'Bearer ' + token;
                    const response = await fetch(url, Object.assign({}, options, { headers }));
                    if ((response.status === 401 || response.status === 503) && retry) {
                        localStorage.removeItem('adminToken');
                        const message = await response.text().catch(() => '');
                        showToast(message || 'Admin token hibás vagy hiányzik.');
                        const nextToken = prompt('Admin token:') || '';
                        if (nextToken) {
                            localStorage.setItem('adminToken', nextToken);
                            return adminFetch(url, options, false);
                        }
                    }
                    return response;
                }

                setInterval(refreshFleet, 5000);
                bindDriverCards();
            </script>
        </body></html>`);
    } catch (e) { res.status(500).send(e.message); }
});

    return rootRoutes;
};

module.exports = createRootRoutes;
