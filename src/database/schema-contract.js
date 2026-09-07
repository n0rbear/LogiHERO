const crypto = require('node:crypto');

const TABLES = [
    ['companies', [
        ['uuid', 'UUID DEFAULT gen_random_uuid() PRIMARY KEY'], ['name', 'TEXT UNIQUE NOT NULL'],
        ['slug', 'TEXT UNIQUE NOT NULL'], ['is_demo', 'BOOLEAN DEFAULT FALSE'], ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"]
    ]],
    ['drivers', [
        ['uuid', 'UUID DEFAULT gen_random_uuid() PRIMARY KEY'], ['company_uuid', 'UUID'], ['name', 'TEXT UNIQUE'],
        ['email', 'TEXT'], ['phone', 'TEXT'], ['whatsapp', 'TEXT'], ['telegram', 'TEXT'], ['license_plate', 'TEXT'],
        ['photo_url', 'TEXT'], ['is_active', 'BOOLEAN DEFAULT TRUE'], ['home_lat', 'DOUBLE PRECISION'], ['home_lng', 'DOUBLE PRECISION'],
        ['base_lat', 'DOUBLE PRECISION'], ['base_lng', 'DOUBLE PRECISION'], ['activation_code', 'TEXT UNIQUE'],
        ['profile_updated_at', 'BIGINT DEFAULT 0'], ['created_at', 'BIGINT'], ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['web_users', [
        ['uuid', 'UUID DEFAULT gen_random_uuid() PRIMARY KEY'], ['company_uuid', 'UUID'], ['name', 'TEXT NOT NULL'],
        ['email', 'TEXT UNIQUE NOT NULL'], ['role', 'TEXT NOT NULL'], ['is_active', 'BOOLEAN DEFAULT TRUE'],
        ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"]
    ]],
    ['role_permissions', [
        ['id', 'SERIAL PRIMARY KEY'], ['company_uuid', 'UUID'], ['role', 'TEXT NOT NULL'], ['module', 'TEXT NOT NULL'],
        ['can_view', 'BOOLEAN DEFAULT TRUE'], ['can_edit', 'BOOLEAN DEFAULT FALSE']
    ], ['UNIQUE (company_uuid, role, module)']],
    ['driver_devices', [
        ['id', 'SERIAL PRIMARY KEY'], ['driver_uuid', 'UUID'], ['device_id', 'TEXT UNIQUE NOT NULL'], ['device_name', 'TEXT'],
        ['is_active', 'BOOLEAN DEFAULT TRUE'], ['linked_at', 'BIGINT'], ['last_seen_at', 'BIGINT'], ['created_at', 'BIGINT'],
        ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'], ['sync_state', "TEXT DEFAULT 'SYNCED'"],
        ['revision', 'INTEGER DEFAULT 1'], ['device_token_hash', 'TEXT'], ['token_rotated_at', 'BIGINT']
    ]],
    ['live_updates', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['driver_photo', 'TEXT'], ['driver_phone', 'TEXT'], ['driver_email', 'TEXT'], ['license_plate', 'TEXT'],
        ['latitude', 'DOUBLE PRECISION'], ['longitude', 'DOUBLE PRECISION'], ['speed', 'DOUBLE PRECISION'], ['status', 'TEXT'], ['current_tour', 'TEXT'],
        ['next_stop', 'TEXT'], ['next_lat', 'DOUBLE PRECISION'], ['next_lng', 'DOUBLE PRECISION'], ['next_stop_dist', 'DOUBLE PRECISION'],
        ['next_stop_duration', 'BIGINT'], ['tour_remaining_dist', 'DOUBLE PRECISION'], ['tour_remaining_duration', 'BIGINT'],
        ['depot_name', 'TEXT'], ['depot_lat', 'DOUBLE PRECISION'], ['depot_lng', 'DOUBLE PRECISION'], ['timestamp', 'BIGINT'],
        ['include_rests', 'BOOLEAN DEFAULT TRUE'], ['next_break_in_seconds', 'BIGINT']
    ]],
    ['costs', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['amount', 'NUMERIC'], ['currency', 'TEXT'], ['category', 'TEXT'], ['notes', 'TEXT'], ['mileage', 'INTEGER'],
        ['status', "TEXT DEFAULT 'Rögzítve'"], ['photo_path', 'TEXT'], ['timestamp', 'BIGINT'], ['created_at', 'BIGINT'],
        ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'], ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['chat_messages', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['sender', 'TEXT'], ['message', 'TEXT'], ['timestamp', 'BIGINT']
    ]],
    ['work_times', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['type', 'TEXT'], ['start_time', 'BIGINT'], ['end_time', 'BIGINT'], ['mileage', 'INTEGER'],
        ['end_mileage', 'INTEGER'], ['license_plate', 'TEXT'], ['notes', 'TEXT'], ['date', 'TEXT'], ['created_at', 'BIGINT'],
        ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'], ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1'],
        ['work_day_uuid', 'UUID'], ['status', 'TEXT'], ['duration_ms', 'BIGINT DEFAULT 0'], ['source', "TEXT DEFAULT 'ANDROID'"],
        ['manual_edit', 'BOOLEAN DEFAULT FALSE'], ['correction_reason', 'TEXT'], ['approval_status', "TEXT DEFAULT 'PENDING'"]
    ]],
    ['work_days', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['tour_uuid', 'UUID'], ['work_date', 'TEXT NOT NULL'], ['start_time', 'BIGINT NOT NULL'], ['end_time', 'BIGINT'],
        ['status', "TEXT DEFAULT 'OPEN'"], ['start_location', 'TEXT'], ['end_location', 'TEXT'], ['notes', 'TEXT'],
        ['approval_status', "TEXT DEFAULT 'PENDING'"], ['admin_note', 'TEXT'], ['total_work_ms', 'BIGINT DEFAULT 0'],
        ['driving_ms', 'BIGINT DEFAULT 0'], ['break_ms', 'BIGINT DEFAULT 0'], ['rest_ms', 'BIGINT DEFAULT 0'],
        ['availability_ms', 'BIGINT DEFAULT 0'], ['anomaly_flags', "TEXT[] DEFAULT '{}'"],
        ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"],
        ['updated_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['work_time_entries', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['work_day_uuid', 'UUID NOT NULL'],
        ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'], ['driver_name', 'TEXT'], ['tour_uuid', 'UUID'], ['status', 'TEXT NOT NULL'],
        ['start_time', 'BIGINT NOT NULL'], ['end_time', 'BIGINT'], ['duration_ms', 'BIGINT DEFAULT 0'], ['source', "TEXT DEFAULT 'ANDROID'"],
        ['manual_edit', 'BOOLEAN DEFAULT FALSE'], ['correction_reason', 'TEXT'], ['approval_status', "TEXT DEFAULT 'PENDING'"],
        ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"],
        ['updated_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['work_time_audit', [
        ['id', 'SERIAL PRIMARY KEY'], ['event_uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['work_day_uuid', 'UUID'], ['entry_uuid', 'UUID'],
        ['event_type', 'TEXT NOT NULL'], ['old_value', 'JSONB'], ['new_value', 'JSONB'], ['actor_type', 'TEXT'], ['actor_id', 'TEXT'],
        ['request_id', 'TEXT'], ['occurred_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['reason', 'TEXT']
    ]],
    ['work_time_conflicts', [
        ['uuid', 'UUID DEFAULT gen_random_uuid() PRIMARY KEY'], ['work_day_uuid', 'UUID'], ['entry_uuid', 'UUID'], ['driver_uuid', 'UUID NOT NULL'],
        ['local_revision', 'INTEGER'], ['backend_revision', 'INTEGER'], ['local_value', 'JSONB'], ['backend_value', 'JSONB'],
        ['approval_status', 'TEXT'], ['admin_correction', 'BOOLEAN DEFAULT FALSE'], ['reason', 'TEXT NOT NULL'],
        ['resolution_status', "TEXT DEFAULT 'UNRESOLVED'"],
        ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['resolved_at', 'BIGINT'],
        ['updated_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['request_id', 'TEXT']
    ]],
    ['tours', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['driver_name', 'TEXT'], ['name', 'TEXT'], ['customer', 'TEXT'], ['date', 'BIGINT'], ['day_of_week', 'TEXT'], ['notes', 'TEXT'],
        ['is_closed', 'BOOLEAN'], ['is_current', 'BOOLEAN'], ['depot_name', 'TEXT'], ['depot_company', 'TEXT'], ['depot_street', 'TEXT'],
        ['depot_house_number', 'TEXT'], ['depot_postal_code', 'TEXT'], ['depot_city', 'TEXT'], ['depot_state', 'TEXT'], ['depot_country', 'TEXT'],
        ['depot_address_full', 'TEXT'], ['depot_lat', 'DOUBLE PRECISION'], ['depot_lng', 'DOUBLE PRECISION'], ['vehicle', 'TEXT'], ['trailer', 'TEXT'],
        ['return_depot_name', 'TEXT'], ['return_depot_address_full', 'TEXT'], ['return_depot_lat', 'DOUBLE PRECISION'], ['return_depot_lng', 'DOUBLE PRECISION'],
        ['planned_start_at', 'BIGINT'], ['planned_end_at', 'BIGINT'], ['actual_start_at', 'BIGINT'], ['actual_end_at', 'BIGINT'],
        ['tour_status', "TEXT DEFAULT 'PLANNED'"], ['current_stop_id', 'INTEGER'], ['next_stop_id', 'INTEGER'],
        ['last_driver_lat', 'DOUBLE PRECISION'], ['last_driver_lng', 'DOUBLE PRECISION'], ['last_driver_location_at', 'BIGINT'],
        ['planned_distance_km', 'DOUBLE PRECISION'], ['planned_duration_seconds', 'BIGINT'], ['remaining_distance_km', 'DOUBLE PRECISION'],
        ['remaining_duration_seconds', 'BIGINT'], ['completed_distance_km', 'DOUBLE PRECISION'], ['route_polyline', 'JSONB'],
        ['route_status', "TEXT DEFAULT 'NOT_CALCULATED'"], ['route_error', 'TEXT'], ['route_calculated_at', 'BIGINT'],
        ['terminal_mode', "TEXT DEFAULT 'NONE'"], ['created_at', 'BIGINT'], ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['stops', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['tour_id', 'INTEGER'], ['address', 'TEXT'], ['recipient', 'TEXT'], ['company', 'TEXT'], ['street', 'TEXT'], ['house_number', 'TEXT'],
        ['postal_code', 'TEXT'], ['city', 'TEXT'], ['state', 'TEXT'], ['country', 'TEXT'], ['address_full', 'TEXT'], ['contact_name', 'TEXT'],
        ['phone_number', 'TEXT'], ['email', 'TEXT'], ['time_window', 'TEXT'], ['notes', 'TEXT'], ['alternative_names', 'TEXT'],
        ['order_index', 'INTEGER'], ['latitude', 'DOUBLE PRECISION'], ['longitude', 'DOUBLE PRECISION'], ['is_completed', 'BOOLEAN'],
        ['arrival_time', 'BIGINT'], ['actual_departure_time', 'BIGINT'], ['photo_url', 'TEXT'], ['room_number', 'TEXT'], ['entry_code', 'TEXT'],
        ['booking_number', 'TEXT'], ['stop_date', 'BIGINT'], ['stop_status', "TEXT DEFAULT 'PENDING'"], ['stop_type', "TEXT DEFAULT 'DELIVERY'"],
        ['items', 'JSONB'], ['segment_distance_km', 'DOUBLE PRECISION'], ['segment_duration_seconds', 'BIGINT'],
        ['cumulative_distance_km', 'DOUBLE PRECISION'], ['cumulative_duration_seconds', 'BIGINT'], ['route_warning', 'TEXT'],
        ['created_at', 'BIGINT'], ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'], ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['hotels', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['tour_id', 'INTEGER REFERENCES tours(id)'], ['stop_id', 'INTEGER REFERENCES stops(id)'], ['driver_id', 'UUID'], ['driver_name', 'TEXT'], ['name', 'TEXT'], ['address', 'TEXT'],
        ['address_line_1', 'TEXT'], ['address_line_2', 'TEXT'], ['postal_code', 'TEXT'], ['city', 'TEXT'], ['country', 'TEXT'],
        ['latitude', 'DOUBLE PRECISION'], ['longitude', 'DOUBLE PRECISION'], ['phone', 'TEXT'], ['phone_number', 'TEXT'],
        ['booking_number', 'TEXT'], ['booking_provider', 'TEXT'], ['check_in_date', 'TEXT'], ['check_in_time', 'TEXT'],
        ['check_out_date', 'TEXT'], ['check_out_time', 'TEXT'], ['number_of_nights', 'INTEGER'], ['number_of_rooms', 'INTEGER'],
        ['status', "TEXT DEFAULT 'PLANNED'"], ['notes', 'TEXT'], ['street_view_url', 'TEXT'], ['external_map_url', 'TEXT'],
        ['contact_name', 'TEXT'], ['email', 'TEXT'], ['reservation_name', 'TEXT'], ['breakfast_included', 'BOOLEAN DEFAULT FALSE'],
        ['parking_included', 'BOOLEAN DEFAULT FALSE'], ['late_check_in', 'BOOLEAN DEFAULT FALSE'], ['room_type', 'TEXT'], ['room_number', 'TEXT'],
        ['entry_code', 'TEXT'], ['timestamp', 'BIGINT'], ['created_at', 'BIGINT'], ['updated_at', 'BIGINT'], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['hotel_events', [
        ['id', 'SERIAL PRIMARY KEY'], ['hotel_id', 'INTEGER REFERENCES hotels(id)'], ['event_type', 'TEXT NOT NULL'], ['from_status', 'TEXT'], ['to_status', 'TEXT'],
        ['actor_type', 'TEXT'], ['actor_id', 'TEXT'], ['timestamp', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"],
        ['reason', 'TEXT'], ['client_event_id', 'TEXT UNIQUE'], ['metadata', 'JSONB']
    ]],
    ['cargo', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['tour_id', 'INTEGER REFERENCES tours(id)'], ['pickup_stop_id', 'INTEGER REFERENCES stops(id)'], ['delivery_stop_id', 'INTEGER REFERENCES stops(id)'], ['pickup_stop_uuid', 'UUID'], ['delivery_stop_uuid', 'UUID'],
        ['type', "TEXT DEFAULT 'MACHINE'"], ['name', 'TEXT NOT NULL'], ['description', 'TEXT'], ['quantity', 'INTEGER DEFAULT 1'],
        ['unit', "TEXT DEFAULT 'pcs'"], ['serial_number', 'TEXT'], ['external_reference', 'TEXT'], ['customer_reference', 'TEXT'],
        ['weight_kg', 'DOUBLE PRECISION'], ['length_cm', 'DOUBLE PRECISION'], ['width_cm', 'DOUBLE PRECISION'], ['height_cm', 'DOUBLE PRECISION'],
        ['status', "TEXT DEFAULT 'PLANNED'"], ['condition_at_pickup', 'TEXT'], ['condition_at_delivery', 'TEXT'], ['notes', 'TEXT'],
        ['driver_name', 'TEXT'], ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"],
        ['updated_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"], ['deleted_at', 'BIGINT'],
        ['sync_state', "TEXT DEFAULT 'SYNCED'"], ['revision', 'INTEGER DEFAULT 1']
    ]],
    ['cargo_events', [
        ['id', 'SERIAL PRIMARY KEY'], ['uuid', 'UUID DEFAULT gen_random_uuid() UNIQUE'], ['company_uuid', 'UUID'], ['driver_uuid', 'UUID'],
        ['cargo_id', 'INTEGER REFERENCES cargo(id)'], ['event_type', 'TEXT NOT NULL'], ['from_status', 'TEXT'], ['to_status', 'TEXT'], ['actor_type', 'TEXT'],
        ['actor_id', 'TEXT'], ['stop_id', 'INTEGER REFERENCES stops(id)'], ['timestamp', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"],
        ['reason', 'TEXT'], ['client_event_id', 'TEXT UNIQUE'], ['metadata', 'JSONB']
    ]],
    ['sync_events', [
        ['id', 'SERIAL PRIMARY KEY'], ['request_id', 'TEXT'], ['entity', 'TEXT NOT NULL'], ['entity_uuid', 'TEXT'],
        ['direction', 'TEXT NOT NULL'], ['result', 'TEXT NOT NULL'], ['duration_ms', 'INTEGER'], ['details', 'JSONB'],
        ['created_at', "BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT"]
    ]]
];

const INDEXES = [
    ['idx_work_days_driver_uuid', 'work_days', 'driver_uuid'], ['idx_work_days_work_date', 'work_days', 'work_date'],
    ['idx_work_days_deleted_at', 'work_days', 'deleted_at'], ['idx_work_days_updated_at', 'work_days', 'updated_at'],
    ['idx_work_days_revision', 'work_days', 'revision'], ['idx_work_entries_work_day_uuid', 'work_time_entries', 'work_day_uuid'],
    ['idx_work_entries_driver_uuid', 'work_time_entries', 'driver_uuid'], ['idx_work_entries_start_time', 'work_time_entries', 'start_time'],
    ['idx_work_entries_deleted_at', 'work_time_entries', 'deleted_at'], ['idx_work_entries_updated_at', 'work_time_entries', 'updated_at'],
    ['idx_work_entries_revision', 'work_time_entries', 'revision'], ['idx_tours_driver_updated', 'tours', 'driver_uuid, updated_at'],
    ['idx_stops_tour_order', 'stops', 'tour_id, order_index'], ['idx_hotels_tour', 'hotels', 'tour_id'],
    ['idx_cargo_tour', 'cargo', 'tour_id'], ['idx_sync_events_created', 'sync_events', 'created_at']
];

const UNIQUE_CONSTRAINTS = [
    ['unique_worktime', 'work_times', 'driver_name, start_time'],
    ['unique_cost', 'costs', 'driver_name, timestamp, amount'],
    ['unique_hotel', 'hotels', 'driver_name, timestamp, name']
];

const COLUMN_DEFAULTS = [
    ['drivers', 'uuid', 'gen_random_uuid()'], ['drivers', 'is_active', 'true'], ['drivers', 'profile_updated_at', '0'],
    ['drivers', 'sync_state', "'SYNCED'::text"], ['drivers', 'revision', '1'],
    ['driver_devices', 'is_active', 'true'], ['driver_devices', 'sync_state', "'SYNCED'::text"], ['driver_devices', 'revision', '1'],
    ['tours', 'uuid', 'gen_random_uuid()'], ['tours', 'tour_status', "'PLANNED'::text"], ['tours', 'route_status', "'NOT_CALCULATED'::text"],
    ['tours', 'terminal_mode', "'NONE'::text"], ['tours', 'sync_state', "'SYNCED'::text"], ['tours', 'revision', '1'],
    ['stops', 'uuid', 'gen_random_uuid()'], ['stops', 'stop_status', "'PENDING'::text"], ['stops', 'stop_type', "'DELIVERY'::text"],
    ['stops', 'sync_state', "'SYNCED'::text"], ['stops', 'revision', '1'],
    ['hotels', 'uuid', 'gen_random_uuid()'], ['hotels', 'status', "'PLANNED'::text"], ['hotels', 'sync_state', "'SYNCED'::text"], ['hotels', 'revision', '1'],
    ['cargo', 'uuid', 'gen_random_uuid()'], ['cargo', 'type', "'MACHINE'::text"], ['cargo', 'quantity', '1'], ['cargo', 'unit', "'pcs'::text"],
    ['cargo', 'status', "'PLANNED'::text"], ['cargo', 'sync_state', "'SYNCED'::text"], ['cargo', 'revision', '1'],
    ['cargo_events', 'uuid', 'gen_random_uuid()'], ['costs', 'uuid', 'gen_random_uuid()'], ['costs', 'sync_state', "'SYNCED'::text"], ['costs', 'revision', '1'],
    ['work_times', 'uuid', 'gen_random_uuid()'], ['work_times', 'sync_state', "'SYNCED'::text"], ['work_times', 'revision', '1'],
    ['work_days', 'uuid', 'gen_random_uuid()'], ['work_days', 'sync_state', "'SYNCED'::text"], ['work_days', 'revision', '1'],
    ['work_time_entries', 'uuid', 'gen_random_uuid()'], ['work_time_entries', 'sync_state', "'SYNCED'::text"], ['work_time_entries', 'revision', '1']
];

const FOREIGN_KEYS = [
    ['hotels_tour_fk', 'hotels', 'tour_id', 'tours', 'id'],
    ['hotels_stop_fk', 'hotels', 'stop_id', 'stops', 'id'],
    ['hotel_events_hotel_fk', 'hotel_events', 'hotel_id', 'hotels', 'id'],
    ['cargo_tour_fk', 'cargo', 'tour_id', 'tours', 'id'],
    ['cargo_pickup_stop_fk', 'cargo', 'pickup_stop_id', 'stops', 'id'],
    ['cargo_delivery_stop_fk', 'cargo', 'delivery_stop_id', 'stops', 'id'],
    ['cargo_events_cargo_fk', 'cargo_events', 'cargo_id', 'cargo', 'id'],
    ['cargo_events_stop_fk', 'cargo_events', 'stop_id', 'stops', 'id']
];

const EXPECTED_TYPES = {
    uuid: 'uuid', text: 'text', boolean: 'boolean', bigint: 'bigint', integer: 'integer',
    serial: 'integer', numeric: 'numeric', real: 'real', 'double precision': 'double precision',
    jsonb: 'jsonb', 'text[]': 'text[]'
};

function baseType(definition) {
    const value = definition.toLowerCase().split(/\s+(?:default|primary|unique|not|null|references)\b/)[0].trim();
    return EXPECTED_TYPES[value] || value;
}

function createTableSql([table, columns, constraints = []]) {
    const definitions = columns.map(([name, definition]) => `${name} ${definition}`).concat(constraints);
    return `CREATE TABLE IF NOT EXISTS ${table} (${definitions.join(', ')})`;
}

function safeAdditionDefinition(definition) {
    return definition
        .replace(/\s+PRIMARY KEY/ig, '')
        .replace(/\s+UNIQUE/ig, '')
        .replace(/\s+NOT NULL/ig, '')
        .replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)/ig, '');
}

function normalizeDefault(value) {
    // PostgreSQL reports a default's function schema-qualified once the extension lives in
    // public (gen_random_uuid() is reported as public.gen_random_uuid()), so compare without
    // the qualifier rather than depending on where pgcrypto happens to be installed.
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/::(?:text|integer|boolean|uuid)/g, '')
        .replace(/\bpublic\./g, '');
}

async function createCanonicalTables(client) {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    for (const table of TABLES) await client.query(createTableSql(table));
    await client.query(`
        CREATE OR REPLACE FUNCTION set_current_tour(p_driver_name TEXT, p_tour_uuid UUID) RETURNS VOID AS $$
        BEGIN
            UPDATE tours SET is_current = false, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE driver_name = p_driver_name AND uuid != p_tour_uuid;
            UPDATE tours SET is_current = true, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE uuid = p_tour_uuid AND driver_name = p_driver_name;
        END;
        $$ LANGUAGE plpgsql
    `);
}

async function addMissingCanonicalColumns(client) {
    for (const [table, columns] of TABLES) {
        for (const [column, definition] of columns) {
            await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${safeAdditionDefinition(definition)}`);
        }
    }
}

async function currentColumns(client) {
    const result = await client.query(`
        SELECT c.table_name, c.column_name, format_type(a.atttypid, a.atttypmod) AS formatted_type
        FROM information_schema.columns c
        JOIN pg_class cl ON cl.relname = c.table_name
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
        JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.table_schema = 'public' AND c.table_name = ANY($1::text[])
        ORDER BY c.table_name, c.ordinal_position
    `, [TABLES.map(([table]) => table)]);
    return result.rows;
}

async function validateCanonicalSchema(client) {
    const rows = await currentColumns(client);
    const actual = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row.formatted_type.toLowerCase()]));
    const missing = [];
    const mismatched = [];
    for (const [table, columns] of TABLES) {
        for (const [column, definition] of columns) {
            const key = `${table}.${column}`;
            if (!actual.has(key)) missing.push(key);
            else if (actual.get(key) !== baseType(definition)) mismatched.push(`${key}:${actual.get(key)}!=${baseType(definition)}`);
        }
    }
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const existingIndexes = new Set(indexes.rows.map((row) => row.indexname));
    const missingIndexes = INDEXES.map(([name]) => name).filter((name) => !existingIndexes.has(name));
    const functionResult = await client.query("SELECT COUNT(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='set_current_tour'");
    const constraints = await client.query(`
        SELECT constraint_row.contype, source.relname AS source_table, source_attribute.attname AS source_column,
               target.relname AS target_table, target_attribute.attname AS target_column
        FROM pg_constraint constraint_row
        JOIN pg_class source ON source.oid=constraint_row.conrelid
        JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS source_key(attnum, ordinality) ON true
        JOIN pg_attribute source_attribute ON source_attribute.attrelid=source.oid AND source_attribute.attnum=source_key.attnum
        LEFT JOIN pg_class target ON target.oid=constraint_row.confrelid
        LEFT JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS target_key(attnum, ordinality) ON target_key.ordinality=source_key.ordinality
        LEFT JOIN pg_attribute target_attribute ON target_attribute.attrelid=target.oid AND target_attribute.attnum=target_key.attnum
        WHERE source.relnamespace='public'::regnamespace
    `);
    const missingForeignKeys = FOREIGN_KEYS.filter(([, sourceTable, sourceColumn, targetTable, targetColumn]) =>
        !constraints.rows.some((row) => row.contype === 'f' && row.source_table === sourceTable && row.source_column === sourceColumn && row.target_table === targetTable && row.target_column === targetColumn)
    ).map(([name]) => name);
    const nullable = await client.query(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public' AND is_nullable='YES'
          AND (table_name, column_name) IN (('drivers', 'uuid'), ('cargo_events', 'uuid'))
    `);
    const unexpectedlyNullable = nullable.rows.map((row) => `${row.table_name}.${row.column_name}`);
    const defaults = await client.query(`
        SELECT table_name, column_name, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name=ANY($1::text[])
    `, [TABLES.map(([table]) => table)]);
    const defaultMap = new Map(defaults.rows.map((row) => [`${row.table_name}.${row.column_name}`, normalizeDefault(row.column_default)]));
    const mismatchedDefaults = COLUMN_DEFAULTS
        .filter(([table, column, expected]) => defaultMap.get(`${table}.${column}`) !== normalizeDefault(expected))
        .map(([table, column]) => `${table}.${column}`);
    const uniqueRows = await client.query(`
        SELECT source.relname AS source_table, constraint_row.contype,
               array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS columns
        FROM pg_constraint constraint_row
        JOIN pg_class source ON source.oid=constraint_row.conrelid
        CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute ON attribute.attrelid=source.oid AND attribute.attnum=key_column.attnum
        WHERE source.relnamespace='public'::regnamespace AND constraint_row.contype IN ('p', 'u')
        GROUP BY source.relname, constraint_row.conname, constraint_row.contype
    `);
    const requiredUnique = [
        ['drivers', ['uuid']], ['cargo_events', ['uuid']],
        ...UNIQUE_CONSTRAINTS.map(([, table, columns]) => [table, columns.split(',').map((column) => column.trim())])
    ];
    const missingUniqueConstraints = requiredUnique
        .filter(([table, columns]) => !uniqueRows.rows.some((row) => row.source_table === table && JSON.stringify(row.columns) === JSON.stringify(columns)))
        .map(([table, columns]) => `${table}(${columns.join(',')})`);
    if (missing.length || mismatched.length || missingIndexes.length || missingForeignKeys.length || unexpectedlyNullable.length || mismatchedDefaults.length || missingUniqueConstraints.length || Number(functionResult.rows[0]?.count) !== 1) {
        const detail = { missing, mismatched, missingIndexes, missingForeignKeys, unexpectedlyNullable, mismatchedDefaults, missingUniqueConstraints, functionMissing: Number(functionResult.rows[0]?.count) !== 1 };
        const error = new Error(`Canonical schema validation failed: ${JSON.stringify(detail)}`);
        error.code = 'SCHEMA_DRIFT';
        error.details = detail;
        throw error;
    }
    return { tables: TABLES.length, columns: rows.length, indexes: INDEXES.length };
}

async function schemaFingerprint(client) {
    const columns = await currentColumns(client);
    const indexes = await client.query(`
        SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ANY($1::text[])
        ORDER BY tablename, indexname
    `, [TABLES.map(([table]) => table)]);
    const normalized = JSON.stringify({ columns, indexes: indexes.rows });
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = {
    COLUMN_DEFAULTS,
    FOREIGN_KEYS,
    INDEXES,
    TABLES,
    UNIQUE_CONSTRAINTS,
    addMissingCanonicalColumns,
    baseType,
    createCanonicalTables,
    currentColumns,
    schemaFingerprint,
    validateCanonicalSchema
};
