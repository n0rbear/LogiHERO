const SYNC_TABLES = {
    drivers: {
        entity: 'drivers',
        table: 'drivers',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'name', 'email', 'phone', 'whatsapp', 'telegram', 'license_plate', 'photo_url', 'is_active', 'activation_code', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    tours: {
        entity: 'tours',
        table: 'tours',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'driver_name', 'name', 'customer', 'date', 'day_of_week', 'notes', 'is_closed', 'is_current', 'depot_name', 'depot_address_full', 'depot_lat', 'depot_lng', 'tour_status', 'route_status', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    stops: {
        entity: 'stops',
        table: 'stops',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'tour_id', 'address', 'recipient', 'company', 'street', 'house_number', 'postal_code', 'city', 'country', 'address_full', 'contact_name', 'phone_number', 'email', 'time_window', 'notes', 'order_index', 'latitude', 'longitude', 'is_completed', 'arrival_time', 'stop_type', 'stop_status', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    hotels: {
        entity: 'hotels',
        table: 'hotels',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'tour_id', 'stop_id', 'driver_uuid', 'driver_name', 'name', 'address', 'address_line_1', 'address_line_2', 'postal_code', 'city', 'country', 'latitude', 'longitude', 'phone', 'booking_number', 'booking_provider', 'check_in_date', 'check_out_date', 'status', 'notes', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    cargo: {
        entity: 'cargo',
        table: 'cargo',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'tour_id', 'pickup_stop_uuid', 'delivery_stop_uuid', 'type', 'name', 'description', 'quantity', 'unit', 'serial_number', 'external_reference', 'customer_reference', 'weight_kg', 'status', 'notes', 'driver_name', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    devices: {
        entity: 'devices',
        table: 'driver_devices',
        watermark: 'updated_at',
        fields: ['driver_uuid', 'device_id', 'device_name', 'is_active', 'linked_at', 'last_seen_at', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    work_times: {
        entity: 'work_times',
        table: 'work_times',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'driver_name', 'work_day_uuid', 'type', 'status', 'start_time', 'end_time', 'duration_ms', 'source', 'manual_edit', 'correction_reason', 'approval_status', 'mileage', 'end_mileage', 'license_plate', 'notes', 'date', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    work_days: {
        entity: 'work_days',
        table: 'work_days',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'driver_name', 'tour_uuid', 'work_date', 'start_time', 'end_time', 'status', 'start_location', 'end_location', 'notes', 'approval_status', 'admin_note', 'total_work_ms', 'driving_ms', 'break_ms', 'rest_ms', 'availability_ms', 'anomaly_flags', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    work_time_entries: {
        entity: 'work_time_entries',
        table: 'work_time_entries',
        watermark: 'updated_at',
        fields: ['uuid', 'work_day_uuid', 'company_uuid', 'driver_uuid', 'driver_name', 'tour_uuid', 'status', 'start_time', 'end_time', 'duration_ms', 'source', 'manual_edit', 'correction_reason', 'approval_status', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    },
    costs: {
        entity: 'costs',
        table: 'costs',
        watermark: 'updated_at',
        fields: ['uuid', 'company_uuid', 'driver_uuid', 'driver_name', 'amount', 'currency', 'category', 'notes', 'mileage', 'status', 'photo_path', 'timestamp', 'created_at', 'updated_at', 'deleted_at', 'sync_state', 'revision']
    }
};

module.exports = { SYNC_TABLES };
