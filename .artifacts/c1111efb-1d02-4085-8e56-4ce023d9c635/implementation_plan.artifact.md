# Implementation Plan - Sprint 3: Hotel Core

Implement a comprehensive Hotel Core module for LogiHERO, enabling hotel management linked to tours, separate hotel views, map integration, navigation, and offline access.

## User Review Required

> [!IMPORTANT]
> - **Non-destructive Migrations**: Existing `hotels` table data will be preserved. We will use `ALTER TABLE` to add new columns.
> - **HOTEL Stops Compatibility**: Existing `stops` of type `HOTEL` will be maintained. The `Hotel` entity is now the primary source for hotel-specific data (booking number, phone, etc.), while the `Stop` remains the primary source for routing/order in the tour.
> - **Tour Ownership**: All new hotels must be linked to a `Tour`.
> - **Idempotency**: All offline actions (check-in, etc.) will use `client_event_id` to prevent duplicates.
> - **Terminal States**: `CHECKED_OUT` and `CANCELLED` states are protected and cannot be reverted by older offline events.
> - **PII Protection**: NDP payloads will be strictly PII-free.
> - **Tour Completion Blocking**: Active `CHECKED_IN` status will block tour completion on the backend.

## Proposed Changes

### 1. Database & Backend API

#### [MODIFY] [init.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/database/init.js)
- Add columns to `hotels` table: `tour_id` (INT), `stop_id` (INT), `driver_id` (UUID), `address_line_1` (TEXT), `address_line_2` (TEXT), `postal_code` (TEXT), `city` (TEXT), `country` (TEXT), `latitude` (DOUBLE), `longitude` (DOUBLE), `phone` (TEXT), `booking_provider` (TEXT), `check_in_date` (TEXT), `check_in_time` (TEXT), `check_out_date` (TEXT), `check_out_time` (TEXT), `number_of_nights` (INT), `number_of_rooms` (INT), `status` (TEXT DEFAULT 'PLANNED'), `notes` (TEXT), `street_view_url` (TEXT), `external_map_url` (TEXT), `created_at` (BIGINT), `updated_at` (BIGINT), `deleted_at` (BIGINT).
- Add optional fields: `contact_name`, `email`, `reservation_name`, `breakfast_included` (BOOL), `parking_included` (BOOL), `late_check_in` (BOOL), `room_type`.
- [NEW] Create `hotel_events` table for auditing: `id`, `hotel_id`, `event_type`, `from_status`, `to_status`, `actor_type`, `actor_id`, `timestamp`, `reason`, `client_event_id` (UNIQUE), `metadata` (JSONB).

#### [MODIFY] [hotel.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/hotel.routes.js)
- Implement `GET /api/tours/:tourId/hotels` and `POST /api/tours/:tourId/hotels`.
- Implement `GET /api/hotels/:hotelId`, `PATCH /api/hotels/:hotelId`, `DELETE /api/hotels/:hotelId`.
- Implement status endpoints: `/confirm`, `/check-in`, `/check-out`, `/cancel`, `/report-problem`.
- Status endpoints will enforce idempotency using `client_event_id`.
- Terminal state protection: Prevent moving from `CHECKED_OUT` or `CANCELLED` unless it's an `ADMIN_OVERRIDE` with a mandatory `reason`.

#### [MODIFY] [tour-core.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/tour-core.routes.js)
- Update `PATCH /api/tours/:id` and completion logic to check for active `CHECKED_IN` hotels. Block completion if found.
- Trigger `ndp.trackEvent` for `tour_completion_blocked_by_hotel` if applicable.

### 2. Android (Mobile App)

#### [MODIFY] [Hotel.kt](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/app/src/main/java/com/example/driverassistant/domain/model/Hotel.kt)
- Expand Room entity with all new fields. Ensure `@SerializedName` matches backend.

#### [MODIFY] [DriverDao.kt](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/app/src/main/java/com/example/driverassistant/data/local/dao/DriverDao.kt)
- Add queries for tour-linked hotels and event persistence.

#### [NEW] [HotelDetailScreen.kt](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/app/src/main/java/com/example/driverassistant/ui/screen/HotelDetailScreen.kt)
- Full detail view: Hotel name, address, check-in/out info, booking number (copyable), phone (dialer intent), navigation (intent), and status actions.
- Coordinate check: Only show map/nav if coordinates are valid (not 0,0 or null).

#### [MODIFY] [HotelsViewModel.kt](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/app/src/main/java/com/example/driverassistant/ui/viewmodel/HotelsViewModel.kt)
- Manage offline action queue with `client_event_id`.
- Sync tour-linked hotels.

#### [MODIFY] [IntentUtils.kt](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/app/src/main/java/com/example/driverassistant/util/IntentUtils.kt)
- Re-use for phone dial (`ACTION_DIAL`) and map navigation.

### 3. Web (Admin Dashboard)

#### [NEW] [hotels.html](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/views/hotels.html)
- Operational view: List of today's, upcoming, and problematic hotels.
- Integrated Leaflet map showing active/upcoming hotel markers.
- Search and filter by hotel name, city, tour, driver, status, date range.

#### [MODIFY] [driver-dashboard.routes.js](file:///C:/Users/Norbi/AndroidStudioProjects/LogiHERO/src/routes/driver-dashboard.routes.js)
- Update Tours detail view to include a "Hotels" section for management (CRUD).
- Update Dashboard to show only a summary card for the "Next/Current Hotel".

## Verification Plan

### Automated Tests
- **Backend API Tests**: Test CRUD, status transitions, idempotency (`client_event_id`), and tour completion blocking.
- **Migration Tests**: Verify Room and PG migrations preserve existing data.
- **NDP Verification**: Check that events like `hotel_checked_in` contain no PII.

### Manual Verification
- **Android E2E (Emulator)**: Verify list, details, navigation, dialer, and offline sync.
- **Web E2E (Chrome)**: Verify hotel creation in Tours admin, operational map view, and filters.
- **Coordinate Validation**: Test with invalid coordinates (0.0, 0.0) to ensure no markers/broken links.

