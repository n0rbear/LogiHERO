# LogiHERO table-based admin input plan

Date: 2026-07-25

## Current Input Surfaces

Drivers:

- UI: fleet/admin view in `src/routes/root.routes.js` and driver dashboard admin section in `src/routes/driver-dashboard.routes.js`.
- Fields: name, license plate, email, phone, WhatsApp, Telegram, photo URL, active state, activation code.
- APIs: `/admin/save-driver`, `/admin/delete-driver`, `/admin/unlink-driver-devices`, `/api/activate-driver`, `/api/upload-photo`.
- Current validation: mostly required/implicit database constraints; admin token on `/admin/*`.
- Save logic: create/update driver, propagate renamed `driver_name` across linked tables.

Tours and stops:

- UI: driver dashboard tour forms.
- Fields: tour name, customer, date, day, notes, current/closed state, depot address fields, stop address/contact/time/window/items/hotel fields.
- APIs: `/admin/save-tour`, `/admin/delete-tour`, `/admin/transfer-tour`, `/api/sync-tours/:driverName`, `/api/get-tours/:driverName`.
- Current validation: limited request checks and import engine normalization.
- Save logic: `ImportEngine.processTour()` upserts tour and stop rows, with soft delete behavior for missing mobile sync stops.

Costs:

- UI: driver dashboard cost form and Android Costs screen.
- Fields: driver, amount, currency, category, notes, mileage, status, timestamp, photo path.
- APIs: `/admin/save-cost`, `/admin/update-cost-status`, `/api/sync-costs`, `/api/get-costs/:driverName`.
- Current validation: amount/timestamp/driver fields are expected, detailed row-level errors are not standardized.
- Save logic: backend inserts/updates by UUID or unique driver/timestamp/amount constraints.

Hotels:

- UI: driver dashboard hotel form.
- Fields: driver, name, address, room number, entry code, booking number, phone, email, notes, timestamp.
- APIs: `/admin/save-hotel-record`, `/admin/delete-hotel-record`, `/api/sync-hotels`, `/api/get-hotels/:driverName`.
- Current validation: basic required fields only.
- Save logic: hotel rows and stop-derived hotel rows are merged in read models.

Work time and live status:

- UI: driver dashboard status/history views and Android dashboard.
- Fields: work type, start/end, mileage, license plate, notes, date, live coordinates/status.
- APIs: `/api/sync-worktimes`, `/api/live-update`, `/api/get-worktimes/:driverName`, `/api/live-status/:driverName`.
- Current validation: mobile sync payload shape is trusted.
- Save logic: upsert-like sync by UUID and status engine calculations.

Chat:

- UI: driver dashboard and Android chat.
- Fields: driver, sender, message, timestamp.
- APIs: `/api/send-chat`, `/api/get-chat/:driverName`.
- Current validation: minimal.
- Save logic: append message rows.

## Table Editing Model

Use a staged edit model:

- Rows have stable client row IDs.
- Existing rows carry backend UUID or ID.
- New rows are marked `new`.
- Edited rows are marked `dirty`.
- Deleted rows are marked `deleted` until save.
- Invalid cells carry a field-level error object.
- Save sends only changed rows.
- Undo restores the previous snapshot before server save.

## Required UX

- Editable cells for low-risk scalar fields.
- Add one row.
- Add multiple empty rows.
- Paste CSV-like tabular data.
- Mark modified rows.
- Highlight invalid cells.
- Validate one row after edit.
- Validate the whole table before save.
- Bulk create, update, and delete.
- Manual save button.
- Undo unsaved changes.
- CSV import.
- XLSX import.
- Import preview.
- Export invalid rows.
- Transaction mode selector: all-or-nothing or partial success.

## Required APIs

Suggested endpoint shape:

- `POST /admin/bulk/drivers/validate`
- `POST /admin/bulk/drivers/save`
- `POST /admin/bulk/tours/validate`
- `POST /admin/bulk/tours/save`
- `POST /admin/bulk/stops/validate`
- `POST /admin/bulk/stops/save`
- `POST /admin/bulk/costs/validate`
- `POST /admin/bulk/costs/save`
- `POST /admin/import/:entity/preview`
- `POST /admin/import/:entity/save`

Every response should include:

- client row ID
- backend ID/UUID when available
- accepted/rejected state
- field errors
- normalized value preview
- warning list

## Implementation Order

1. Drivers table.
2. Costs table.
3. Hotels table.
4. Tours table.
5. Stops nested inside tours.
6. CSV/XLSX import preview.
7. Bulk transaction and rollback reporting.

Drivers should go first because they are the identity anchor for later data. Tours/stops should wait until tenant scoping and import preview are mature.

## Validation Priorities

- Driver names must not collide across LogiHERO and Driver Assistant while names remain global.
- UUIDs must be preserved for updates.
- Required fields must be checked before database writes.
- Amount/date/mileage fields must be normalized before save.
- Email and phone fields should be format-checked but not over-rejected.
- Tour and stop imports must report row-level address and date problems before saving.

## NDP Events

Add events later for:

- import preview started/finished
- row validation failed
- bulk save started/finished
- partial save
- rollback
- export invalid rows

Do not include full personal data, tokens, raw import files, or complete database records in NDP payloads.
