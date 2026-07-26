# Implementation Plan - Fix Syntax Errors in `driver-dashboard.routes.js`

This plan addresses a blocking syntax error in the production deployment caused by nested template literals and duplicated code blocks in the `driver-dashboard.routes.js` file.

## User Review Required

> [!IMPORTANT]
> The fix involves changing the way options are generated in the `addCargoRow` function to avoid nested template literals within a large template literal. I will use string concatenation as requested.
> I will also remove a redundant code block in `addStopRow`.

## Proposed Changes

### Routes

#### [MODIFY] [driver-dashboard.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/driver-dashboard.routes.js)

1.  **Fix `addCargoRow()`**:
    *   Locate the lines defining `pickupOptions` and `deliveryOptions` (approx. lines 816-817).
    *   Replace the backtick-based mapping with simple string concatenation.
    *   Correctly escape values using the `esc()` function available in the client-side script.

2.  **Fix `addStopRow()`**:
    *   Locate the duplicated block at the end of the function (approx. lines 904-911).
    *   Remove the duplicate calls to `appendChild`, `addEventListener`, and `toggleStopHotelFields`.
    *   Remove the extra closing brace `}`.

## Verification Plan

### Automated Tests
I will run the following commands sequentially:
1.  `node --check src/routes/driver-dashboard.routes.js` to verify syntax.
2.  `node --check server.js` to verify syntax.
3.  `npm run typecheck` to run the project's syntax check script.
4.  `npm test` to run existing tests.

### Manual Verification
1.  **Startup**: Run `npm start` and verify the server starts correctly.
2.  **Health Check**: Access `http://localhost:3000/health` (or the configured port).
3.  **Admin Check**: Access `/admin/` and `/admin/hotels`.
4.  **Driver Dashboard**: Access a driver page (e.g., `/driver/TestDriver`).
5.  **Tour Editor**: Open the Tour editor and verify:
    *   Adding a cargo row works and dropdowns populate correctly.
    *   Adding a stop row works and hotel fields toggle correctly.
    *   Cargo history modal opens.

## Commit and Push
Once all tests pass, I will commit the changes with a descriptive message and provide the commit hash.
