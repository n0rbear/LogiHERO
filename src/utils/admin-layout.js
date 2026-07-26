const { escapeHtml } = require('./escape');

const renderAdminLayout = ({ title, content, activeMenu, scripts = '', styles = '', csrfToken = '' }) => {
    const menuItems = [
        { id: 'dashboard', label: 'Dashboard', icon: '📊', path: '/admin' },
        { id: 'tours', label: 'Túrák', icon: '🚛', path: '/admin/tours' },
        { id: 'drivers', label: 'Sofőrök', icon: '👤', path: '/admin/drivers' },
        { id: 'cargo', label: 'Cargo', icon: '📦', path: '/admin/cargo' },
        { id: 'hotels', label: 'Hotelek', icon: '🏨', path: '/admin/hotels' },
        { id: 'costs', label: 'Költségek', icon: '💶', path: '/admin/costs' },
        { id: 'worktime', label: 'Munkaidő', icon: '⏱', path: '/admin/work-time' },
        { id: 'settings', label: 'Beállítások', icon: '⚙️', path: '/admin/settings' }
    ];

    const sidebarHtml = menuItems.map(item => `
        <a href="${item.path}" class="nav-item ${activeMenu === item.id ? 'active' : ''}">
            <span class="nav-icon">${item.icon}</span>
            <span class="nav-label">${item.label}</span>
        </a>
    `).join('');

    return `<!DOCTYPE html>
<html lang="hu">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LogiHERO Admin | ${escapeHtml(title)}</title>
    <meta name="csrf-token" content="${escapeHtml(csrfToken)}">
    <style>
        :root {
            --color-bg: #f0f2f5;
            --color-sidebar: #1a1c23;
            --color-sidebar-hover: #2d2f39;
            --color-sidebar-active: #3498db;
            --color-text-light: #ffffff;
            --color-text-dark: #1a1c23;
            --color-text-muted: #707275;
            --color-surface: #ffffff;
            --color-border: #e1e4e8;
            --color-brand: #16884f;
            --color-brand-hover: #0f6f3e;
            --color-error: #e74c3c;
            --color-warning: #f39c12;
            --color-success: #2ecc71;
            --radius-md: 8px;
            --radius-lg: 12px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.12);
            --shadow-md: 0 4px 6px rgba(0,0,0,0.05);
            --sidebar-width: 240px;
        }

        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--color-bg);
            color: var(--color-text-dark);
            display: flex;
            min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: var(--sidebar-width);
            background-color: var(--color-sidebar);
            color: var(--color-text-light);
            display: flex;
            flex-direction: column;
            position: fixed;
            height: 100vh;
            z-index: 100;
            transition: transform 0.3s ease;
        }

        .sidebar-header {
            padding: 24px;
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .sidebar-logo {
            font-weight: 800;
            font-size: 20px;
            letter-spacing: -0.5px;
            color: var(--color-text-light);
            text-decoration: none;
        }

        .sidebar-nav {
            flex: 1;
            padding: 16px 0;
            overflow-y: auto;
        }

        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 24px;
            color: rgba(255,255,255,0.7);
            text-decoration: none;
            transition: all 0.2s ease;
            gap: 12px;
        }

        .nav-item:hover {
            background-color: var(--color-sidebar-hover);
            color: var(--color-text-light);
        }

        .nav-item.active {
            background-color: var(--color-sidebar-active);
            color: var(--color-text-light);
            font-weight: 600;
        }

        .nav-icon {
            font-size: 18px;
            width: 24px;
            text-align: center;
        }

        /* Main Content */
        .main-container {
            margin-left: var(--sidebar-width);
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0; /* Prevent flex overflow */
        }

        .top-bar {
            height: 64px;
            background-color: var(--color-surface);
            border-bottom: 1px solid var(--color-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 32px;
            position: sticky;
            top: 0;
            z-index: 90;
        }

        .page-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }

        .content-area {
            padding: 32px;
            max-width: 1600px;
            width: 100%;
            box-sizing: border-box;
            margin: 0 auto;
        }

        /* Common Components */
        .card {
            background: var(--color-surface);
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-md);
            border: 1px solid var(--color-border);
            padding: 24px;
            margin-bottom: 24px;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .badge-driving { background: #e3f2fd; color: #1976d2; }
        .badge-working { background: #e8f5e9; color: #2e7d32; }
        .badge-resting { background: #fff3e0; color: #ef6c00; }
        .badge-offline { background: #f5f5f5; color: #757575; }
        .badge-delayed { background: #ffebee; color: #c62828; }

        .btn {
            padding: 8px 16px;
            border-radius: var(--radius-md);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
        }

        .btn-primary { background: var(--color-sidebar-active); color: white; }
        .btn-primary:hover { opacity: 0.9; }
        .btn-outline { background: transparent; border-color: var(--color-border); color: var(--color-text-dark); }
        .btn-outline:hover { background: #f8f9fa; }

        .test-data-row {
            display: none !important;
        }

        body.show-test-data .test-data-row {
            display: block !important;
        }

        body.show-test-data tr.test-data-row {
            display: table-row !important;
        }

        /* Responsive */
        @media (max-width: 1024px) {
            .sidebar { transform: translateX(-100%); }
            .main-container { margin-left: 0; }
            body.sidebar-open .sidebar { transform: translateX(0); }
            .menu-toggle { display: block !important; }
        }

        .menu-toggle {
            display: none;
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
        }

        ${styles}
    </style>
</head>
<body class="show-test-data-init">
    <aside class="sidebar">
        <div class="sidebar-header">
            <a href="/admin" class="sidebar-logo">LogiHERO Admin</a>
        </div>
        <nav class="sidebar-nav">
            ${sidebarHtml}
        </nav>
    </aside>

    <div class="main-container">
        <header class="top-bar">
            <div style="display:flex; align-items:center; gap:16px;">
                <button class="menu-toggle" onclick="document.body.classList.toggle('sidebar-open')">☰</button>
                <h2 class="page-title">${escapeHtml(title)}</h2>
            </div>
            <div class="top-bar-actions" style="display:flex; gap:20px; align-items:center;">
                <label style="font-size:13px; color:var(--color-text-muted); display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" id="test-data-toggle" onchange="toggleTestData(this.checked)">
                    Tesztadatok
                </label>
                <form action="/admin/logout" method="POST" style="margin:0;">
                    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
                    <button type="submit" class="btn btn-outline" style="padding:6px 12px; font-size:13px;">Kijelentkezés</button>
                </form>
            </div>
        </header>

        <main class="content-area">
            ${content}
        </main>
    </div>

    <div id="toast-container" style="position:fixed; bottom:24px; right:24px; z-index:9999;"></div>

    <script>
        window.adminCsrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

        function showToast(msg, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.style.cssText = \`
                background: white;
                color: #1a1c23;
                padding: 12px 24px;
                border-radius: 8px;
                margin-top: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                border-left: 4px solid \${type === 'success' ? '#2ecc71' : '#e74c3c'};
                animation: slideIn 0.3s ease-out;
            \`;
            toast.innerText = msg;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(20px)';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        function toggleTestData(show) {
            localStorage.setItem('showTestData', show);
            document.body.classList.toggle('show-test-data', show);
        }

        // Initialize test data toggle
        (function() {
            const show = localStorage.getItem('showTestData') === 'true';
            document.getElementById('test-data-toggle').checked = show;
            if (show) document.body.classList.add('show-test-data');
        })();

        // Global escaping helper for JS
        function esc(v) {
            return String(v ?? '').replace(/[&<>"']/g, ch => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        const style = document.createElement('style');
        style.innerHTML = \`
            @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        \`;
        document.head.appendChild(style);

        (function startAdminLiveRefresh() {
            let lastVersion = null;
            const interactiveSelector = 'input, textarea, select';
            async function checkVersion() {
                try {
                    const res = await fetch('/api/sync/version', { headers: { 'accept': 'application/json' } });
                    if (!res.ok) return;
                    const data = await res.json();
                    if (lastVersion === null) {
                        lastVersion = data.version || 0;
                        return;
                    }
                    if ((data.version || 0) > lastVersion) {
                        lastVersion = data.version || 0;
                        if (document.activeElement && document.activeElement.matches(interactiveSelector)) {
                            showToast('Friss adatok erkeztek. Mentes utan frissitsd az oldalt.', 'success');
                            return;
                        }
                        location.reload();
                    }
                } catch (_err) {
                    // Keep admin usable if polling fails.
                }
            }
            setInterval(checkVersion, 15000);
            checkVersion();
        })();
    </script>
    ${scripts}
</body>
</html>`;
};

module.exports = renderAdminLayout;
