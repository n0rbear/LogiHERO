# Implementation Plan - Production Admin UX Sprint

This plan overhauls the Admin UI of LogiHERO to provide a professional, unified, and data-driven experience. The goal is to move from a simple list of drivers to a full-featured management dashboard.

## User Review Required

> [!IMPORTANT]
> - I will refactor `/admin` to be a metrics-driven Dashboard instead of a simple driver list.
> - A new unified sidebar navigation will be introduced across all `/admin/*` pages.
> - "Test Data" (e.g., records containing 'demo', 'test', 'qa') will be hidden by default with a UI toggle.
> - Activation codes will be masked by default for security.

## Proposed Changes

### Core UI Framework
- **[NEW] [admin-layout.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/utils/admin-layout.js)**: A utility function to wrap any admin page content in a standard HTML shell with a sidebar, navigation, and common CSS/JS.

### Routes Refactoring
- **[MODIFY] [root.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/root.routes.js)**:
    - `/admin` now renders the **Dashboard**.
    - `/` (public landing) can remain or redirect to `/admin` if appropriate.
- **[NEW] [admin-driver.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/admin-driver.routes.js)**:
    - Dedicated routes for `/admin/drivers`, `/admin/drivers/:uuid`, and `/admin/drivers/new`.
- **[MODIFY] [admin-hotel-view.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/admin-hotel-view.routes.js)**: Update to use the unified layout.
- **[MODIFY] [tour-core.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/tour-core.routes.js)**: Update `/admin/tours` to use the unified layout.

### Features
1.  **Dashboard Widgets**:
    - Summary cards for Active Drivers, Active Tours, Today's Hotels, and Cargo Issues.
    - "Recent Events" feed combining cargo and hotel events.
2.  **Driver Management UX**:
    - Table/Card view with status badges (Driving, Resting, etc.).
    - Masked activation codes with "Copy" and "Regenerate" buttons.
    - Test data toggle (persisted in `localStorage`).
3.  **Responsive Design**: Modern CSS using variables and Flex/Grid.

## Verification Plan

### Automated Tests
- `npm run typecheck` to ensure no syntax errors.
- `node --check server.js`.

### Manual Verification
- **E2E in Chrome**:
    - Verify `/admin` displays correct summary counts.
    - Verify sidebar navigation works between Dashboard, Drivers, Tours, and Hotels.
    - Test the "Show Test Data" toggle on the Drivers page.
    - Test "Copy" and "Regenerate" for driver activation codes.
    - Verify responsiveness on Desktop, Tablet, and Mobile views.

## Success Criteria
- Uniform sidebar present on all admin pages.
- `/admin` provides immediate visibility into fleet status.
- QA data is hidden by default.
- Activation codes are secure yet manageable.
- 0 regressions in existing backend functionality.
