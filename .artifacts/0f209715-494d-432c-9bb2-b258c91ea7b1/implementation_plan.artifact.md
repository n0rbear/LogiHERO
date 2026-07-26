# Implementation Plan - Fix `company_uuid` Missing Column Error

The production deployment is failing because the `drivers` table is missing the `company_uuid` column, causing a fatal error during database initialization (`initDb`). Although the initialization script attempts to add this column, it seems to be failing or skipping it.

## User Review Required

> [!IMPORTANT]
> I will modify the database initialization logic to be more robust. Specifically, I will:
> 1. Make the column existence check schema-aware by specifying `table_schema = 'public'`.
> 2. Add explicit logging for each column addition to help diagnose future issues.
> 3. Ensure that the `company_uuid` column is added to all relevant tables if missing.

## Proposed Changes

### Database Initialization

#### [MODIFY] [init.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/database/init.js)

1.  **Refactor Column Check**: Update the `information_schema.columns` query to include `AND table_schema = 'public'`.
2.  **Add Logging**: Log when a column is being added to a table.
3.  **Ensure `company_uuid` exists**: Double-check that `company_uuid` is added to `drivers`, `live_updates`, `costs`, `chat_messages`, `work_times`, `hotels`, `tours`, and `stops`.

## Verification Plan

### Automated Tests
1.  **Syntax Check**: Run `node --check src/database/init.js`.
2.  **Local Startup (Simulated)**: I will verify the logic by running a dry-run or checking the query strings. *Note: Local DB might not be available, so I will focus on syntax and logic correctness.*

### Manual Verification
1.  **Deploy to Production**: After pushing the changes, I will monitor the Render logs to ensure `initDb` completes successfully.
2.  **Health Check**: Verify `https://logihero-backend.onrender.com/health` returns `status: ok` and `database: { status: ok }`.
