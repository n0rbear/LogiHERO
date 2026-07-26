// FIXED SERVER v18 - ADMIN UX CONSOLIDATION
const express = require('express');
const initDb = require('./src/database/init');
const { PORT } = require('./src/config/env');
const setupUploads = require('./src/infrastructure/uploads');
const healthRoutes = require('./src/routes/health.routes');
const downloadRoutes = require('./src/routes/download.routes');
const chatRoutes = require('./src/routes/chat.routes');
const {
    worktimeReadRoutes,
    worktimeSyncRoutes
} = require('./src/routes/worktime.routes');
const {
    costReadRoutes,
    costManagementRoutes
} = require('./src/routes/cost.routes');
const { uploadRoutes } = require('./src/routes/upload.routes');
const {
    hotelManagementRoutes,
    hotelReadRoutes
} = require('./src/routes/hotel.routes');
const {
    driverProfileRoutes,
    driverReadRoutes
} = require('./src/routes/driver.routes');
const fleetRoutes = require('./src/routes/fleet.routes');
const statsRoutes = require('./src/routes/stats.routes');
const createRootRoutes = require('./src/routes/root.routes');
const createDriverDashboardRoutes = require('./src/routes/driver-dashboard.routes');
const historyRoutes = require('./src/routes/history.routes');
const currentTourRoutes = require('./src/routes/current-tour.routes');
const tourRoutes = require('./src/routes/tour.routes');
const tourCoreRoutes = require('./src/routes/tour-core.routes');
const cargoRoutes = require('./src/routes/cargo.routes');
const adminTourRoutes = require('./src/routes/admin-tour.routes');
const devResetRoutes = require('./src/routes/dev-reset.routes');
const devSeedRoutes = require('./src/routes/dev-seed.routes');
const createAdminSaveTourRoutes = require('./src/routes/admin-save-tour.routes');
const adminTransferTourRoutes = require('./src/routes/admin-transfer-tour.routes');
const adminRoutes = require('./src/routes/admin.routes');
const createSyncTourRoutes = require('./src/routes/sync-tour.routes');
const createLiveUpdateRoutes = require('./src/routes/live-update.routes');
const { escapeHtml, escapeJsString } = require('./src/utils/escape');
const ImportEngine = require('./src/engines/import-engine');
const StatusEngine = require('./src/engines/status-engine');
const ndp = require('./src/integrations/ndp-client');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
setupUploads(app);

// Public Assets & Routes
app.use(downloadRoutes);
app.use(healthRoutes);

// Consolidated Admin UI & Protected Routes
app.use('/admin', adminRoutes);

// Driver & Live Data APIs
app.use(createLiveUpdateRoutes({ StatusEngine }));
app.use(historyRoutes);
app.use(chatRoutes);
app.use(currentTourRoutes);
app.use(driverProfileRoutes);
app.use(uploadRoutes);
app.use(driverReadRoutes);
app.use(createSyncTourRoutes({ ImportEngine }));
app.use(tourRoutes);
app.use(tourCoreRoutes);
app.use(cargoRoutes);
app.use(hotelReadRoutes);
app.use(worktimeReadRoutes);
app.use(costReadRoutes);
app.use(fleetRoutes);
app.use(statsRoutes);

// Admin Action APIs (POST)
app.use(createAdminSaveTourRoutes({ ImportEngine }));
app.use(adminTransferTourRoutes);
app.use(adminTourRoutes);
app.use(hotelManagementRoutes);
app.use(costManagementRoutes);
app.use(worktimeSyncRoutes);

// Dev Tools
app.use(devResetRoutes);
app.use(devSeedRoutes);

// Public Root & Driver Dashboard
app.use(createRootRoutes());
app.use(createDriverDashboardRoutes({ escapeHtml, escapeJsString }));

const start = async () => {
    try {
        await initDb();
        app.listen(PORT, () => {
            console.log('[STARTUP] LogiHERO server starting on port ' + PORT);
        });
    } catch (err) {
        console.error('[STARTUP] Fatal error during initDb:', err);
        process.exit(1);
    }
};
start();
