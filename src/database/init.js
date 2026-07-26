const pool = require('./pool');

const initDb = async () => {
    console.log('[STARTUP] initDb started');
    await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // 1. Core tables
    const coreQueries = [
        `CREATE TABLE IF NOT EXISTS companies (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            is_demo BOOLEAN DEFAULT FALSE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS drivers (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            company_uuid UUID,
            name TEXT UNIQUE,
            email TEXT,
            phone TEXT,
            whatsapp TEXT,
            telegram TEXT,
            license_plate TEXT,
            photo_url TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            home_lat DOUBLE PRECISION,
            home_lng DOUBLE PRECISION,
            base_lat DOUBLE PRECISION,
            base_lng DOUBLE PRECISION,
            activation_code TEXT UNIQUE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS web_users (
            uuid UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            company_uuid UUID,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS role_permissions (
            id SERIAL PRIMARY KEY,
            company_uuid UUID,
            role TEXT NOT NULL,
            module TEXT NOT NULL,
            can_view BOOLEAN DEFAULT TRUE,
            can_edit BOOLEAN DEFAULT FALSE,
            UNIQUE(company_uuid, role, module)
        )`,
        `CREATE TABLE IF NOT EXISTS driver_devices (
            id SERIAL PRIMARY KEY,
            driver_uuid UUID,
            device_id TEXT UNIQUE NOT NULL,
            device_name TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            linked_at BIGINT,
            last_seen_at BIGINT
        )`,
        `CREATE TABLE IF NOT EXISTS live_updates (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            driver_photo TEXT,
            driver_phone TEXT,
            driver_email TEXT,
            license_plate TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            speed FLOAT,
            status TEXT,
            current_tour TEXT,
            next_stop TEXT,
            next_lat DOUBLE PRECISION,
            next_lng DOUBLE PRECISION,
            next_stop_dist FLOAT,
            next_stop_duration BIGINT,
            tour_remaining_dist FLOAT,
            tour_remaining_duration BIGINT,
            depot_name TEXT,
            depot_lat DOUBLE PRECISION,
            depot_lng DOUBLE PRECISION,
            timestamp BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS costs (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            amount DECIMAL,
            currency TEXT,
            category TEXT,
            notes TEXT,
            mileage INT,
            status TEXT DEFAULT 'Rögzítve',
            photo_path TEXT,
            timestamp BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            sender TEXT,
            message TEXT,
            timestamp BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS work_times (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            type TEXT,
            start_time BIGINT,
            end_time BIGINT,
            mileage INT,
            end_mileage INT,
            license_plate TEXT,
            notes TEXT,
            date TEXT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS tours (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            name TEXT,
            customer TEXT,
            date BIGINT,
            day_of_week TEXT,
            notes TEXT,
            is_closed BOOLEAN,
            is_current BOOLEAN,
            depot_name TEXT,
            depot_company TEXT,
            depot_street TEXT,
            depot_house_number TEXT,
            depot_postal_code TEXT,
            depot_city TEXT,
            depot_state TEXT,
            depot_country TEXT,
            depot_address_full TEXT,
            depot_lat DOUBLE PRECISION,
            depot_lng DOUBLE PRECISION,
            deleted_at BIGINT,
            updated_at BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS stops (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            tour_id INT,
            address TEXT,
            recipient TEXT,
            company TEXT,
            street TEXT,
            house_number TEXT,
            postal_code TEXT,
            city TEXT,
            state TEXT,
            country TEXT,
            address_full TEXT,
            contact_name TEXT,
            phone_number TEXT,
            email TEXT,
            time_window TEXT,
            notes TEXT,
            alternative_names TEXT,
            order_index INT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            is_completed BOOLEAN,
            arrival_time BIGINT,
            photo_url TEXT,
            deleted_at BIGINT,
            updated_at BIGINT,
            stop_type TEXT DEFAULT 'DELIVERY',
            items JSONB,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS hotels (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            driver_name TEXT,
            name TEXT,
            address TEXT,
            booking_number TEXT,
            timestamp BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS hotel_events (
            id SERIAL PRIMARY KEY,
            hotel_id INT REFERENCES hotels(id),
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            actor_type TEXT,
            actor_id TEXT,
            timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
            reason TEXT,
            client_event_id TEXT UNIQUE,
            metadata JSONB
        )`,
        `CREATE TABLE IF NOT EXISTS cargo (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            tour_id INT REFERENCES tours(id),
            pickup_stop_id INT REFERENCES stops(id),
            delivery_stop_id INT REFERENCES stops(id),
            pickup_stop_uuid UUID,
            delivery_stop_uuid UUID,
            type TEXT DEFAULT 'MACHINE',
            name TEXT NOT NULL,
            description TEXT,
            quantity INT DEFAULT 1,
            unit TEXT DEFAULT 'pcs',
            serial_number TEXT,
            external_reference TEXT,
            customer_reference TEXT,
            weight_kg DOUBLE PRECISION,
            length_cm DOUBLE PRECISION,
            width_cm DOUBLE PRECISION,
            height_cm DOUBLE PRECISION,
            status TEXT DEFAULT 'PLANNED',
            condition_at_pickup TEXT,
            condition_at_delivery TEXT,
            notes TEXT,
            driver_name TEXT,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
            updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
            deleted_at BIGINT,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS cargo_events (
            id SERIAL PRIMARY KEY,
            uuid UUID DEFAULT gen_random_uuid() UNIQUE,
            company_uuid UUID,
            driver_uuid UUID,
            cargo_id INT REFERENCES cargo(id),
            event_type TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT,
            actor_type TEXT,
            actor_id TEXT,
            stop_id INT REFERENCES stops(id),
            timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
            reason TEXT,
            client_event_id TEXT UNIQUE,
            metadata JSONB,
            UNIQUE(uuid)
        )`,
        `CREATE TABLE IF NOT EXISTS sync_events (
            id SERIAL PRIMARY KEY,
            request_id TEXT,
            entity TEXT NOT NULL,
            entity_uuid TEXT,
            direction TEXT NOT NULL,
            result TEXT NOT NULL,
            duration_ms INT,
            details JSONB,
            created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )`,
        `CREATE OR REPLACE FUNCTION set_current_tour(p_driver_name TEXT, p_tour_uuid UUID) RETURNS VOID AS $$
        BEGIN
            UPDATE tours SET is_current = false, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE driver_name = p_driver_name AND uuid != p_tour_uuid;
            UPDATE tours SET is_current = true, updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
            WHERE uuid = p_tour_uuid AND driver_name = p_driver_name;
        END;
        $$ LANGUAGE plpgsql;`
    ];

    for (let q of coreQueries) {
        await pool.query(q);
    }

    // 2. Non-destructive migrations (Column check helper)
    const ensureColumn = async (table, column, type) => {
        const check = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
            [table, column]
        );
        if (check.rows.length === 0) {
            console.log(`[MIGRATION] column added: ${table}.${column} (${type})`);
            await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
            return true;
        }
        return false;
    };

    const migrations = [
        ['stops', 'items', 'JSONB'],
        ['stops', 'stop_type', 'TEXT DEFAULT \'DELIVERY\''],
        ['stops', 'photo_url', 'TEXT'],
        ['stops', 'room_number', 'TEXT'],
        ['stops', 'entry_code', 'TEXT'],
        ['stops', 'booking_number', 'TEXT'],
        ['stops', 'stop_date', 'BIGINT'],
        ['stops', 'stop_status', 'TEXT DEFAULT \'PENDING\''],
        ['stops', 'actual_departure_time', 'BIGINT'],
        ['stops', 'segment_distance_km', 'DOUBLE PRECISION'],
        ['stops', 'segment_duration_seconds', 'BIGINT'],
        ['stops', 'cumulative_distance_km', 'DOUBLE PRECISION'],
        ['stops', 'cumulative_duration_seconds', 'BIGINT'],
        ['stops', 'route_warning', 'TEXT'],
        ['tours', 'depot_company', 'TEXT'],
        ['tours', 'depot_street', 'TEXT'],
        ['tours', 'depot_house_number', 'TEXT'],
        ['tours', 'depot_postal_code', 'TEXT'],
        ['tours', 'depot_city', 'TEXT'],
        ['tours', 'depot_state', 'TEXT'],
        ['tours', 'depot_country', 'TEXT'],
        ['tours', 'depot_address_full', 'TEXT'],
        ['tours', 'vehicle', 'TEXT'],
        ['tours', 'trailer', 'TEXT'],
        ['tours', 'return_depot_name', 'TEXT'],
        ['tours', 'return_depot_address_full', 'TEXT'],
        ['tours', 'return_depot_lat', 'DOUBLE PRECISION'],
        ['tours', 'return_depot_lng', 'DOUBLE PRECISION'],
        ['tours', 'planned_start_at', 'BIGINT'],
        ['tours', 'planned_end_at', 'BIGINT'],
        ['tours', 'actual_start_at', 'BIGINT'],
        ['tours', 'actual_end_at', 'BIGINT'],
        ['tours', 'tour_status', 'TEXT DEFAULT \'PLANNED\''],
        ['tours', 'current_stop_id', 'INT'],
        ['tours', 'next_stop_id', 'INT'],
        ['tours', 'last_driver_lat', 'DOUBLE PRECISION'],
        ['tours', 'last_driver_lng', 'DOUBLE PRECISION'],
        ['tours', 'last_driver_location_at', 'BIGINT'],
        ['tours', 'planned_distance_km', 'DOUBLE PRECISION'],
        ['tours', 'planned_duration_seconds', 'BIGINT'],
        ['tours', 'remaining_distance_km', 'DOUBLE PRECISION'],
        ['tours', 'remaining_duration_seconds', 'BIGINT'],
        ['tours', 'completed_distance_km', 'DOUBLE PRECISION'],
        ['tours', 'route_polyline', 'JSONB'],
        ['tours', 'route_status', 'TEXT DEFAULT \'NOT_CALCULATED\''],
        ['tours', 'route_error', 'TEXT'],
        ['tours', 'route_calculated_at', 'BIGINT'],
        ['stops', 'company', 'TEXT'],
        ['stops', 'state', 'TEXT'],
        ['stops', 'country', 'TEXT'],
        ['live_updates', 'driver_photo', 'TEXT'],
        ['live_updates', 'depot_name', 'TEXT'],
        ['live_updates', 'depot_lat', 'DOUBLE PRECISION'],
        ['live_updates', 'depot_lng', 'DOUBLE PRECISION'],
        ['live_updates', 'next_stop_duration', 'BIGINT'],
        ['live_updates', 'tour_remaining_duration', 'BIGINT'],
        ['live_updates', 'include_rests', 'BOOLEAN DEFAULT TRUE'],
        ['live_updates', 'next_break_in_seconds', 'BIGINT'],
        ['live_updates', 'company_uuid', 'UUID'],
        ['live_updates', 'driver_uuid', 'UUID'],
        ['costs', 'company_uuid', 'UUID'],
        ['costs', 'driver_uuid', 'UUID'],
        ['costs', 'photo_path', 'TEXT'],
        ['chat_messages', 'company_uuid', 'UUID'],
        ['chat_messages', 'driver_uuid', 'UUID'],
        ['work_times', 'company_uuid', 'UUID'],
        ['work_times', 'driver_uuid', 'UUID'],
        ['hotels', 'company_uuid', 'UUID'],
        ['hotels', 'driver_uuid', 'UUID'],
        ['hotels', 'tour_id', 'INT REFERENCES tours(id)'],
        ['hotels', 'stop_id', 'INT REFERENCES stops(id)'],
        ['hotels', 'driver_id', 'UUID'],
        ['hotels', 'address_line_1', 'TEXT'],
        ['hotels', 'address_line_2', 'TEXT'],
        ['hotels', 'postal_code', 'TEXT'],
        ['hotels', 'city', 'TEXT'],
        ['hotels', 'country', 'TEXT'],
        ['hotels', 'latitude', 'DOUBLE PRECISION'],
        ['hotels', 'longitude', 'DOUBLE PRECISION'],
        ['hotels', 'phone', 'TEXT'],
        ['hotels', 'booking_provider', 'TEXT'],
        ['hotels', 'check_in_date', 'TEXT'],
        ['hotels', 'check_in_time', 'TEXT'],
        ['hotels', 'check_out_date', 'TEXT'],
        ['hotels', 'check_out_time', 'TEXT'],
        ['hotels', 'number_of_nights', 'INT'],
        ['hotels', 'number_of_rooms', 'INT'],
        ['hotels', 'status', 'TEXT DEFAULT \'PLANNED\''],
        ['hotels', 'notes', 'TEXT'],
        ['hotels', 'street_view_url', 'TEXT'],
        ['hotels', 'external_map_url', 'TEXT'],
        ['hotels', 'created_at', 'BIGINT'],
        ['hotels', 'updated_at', 'BIGINT'],
        ['hotels', 'deleted_at', 'BIGINT'],
        ['hotels', 'contact_name', 'TEXT'],
        ['hotels', 'email', 'TEXT'],
        ['hotels', 'reservation_name', 'TEXT'],
        ['hotels', 'breakfast_included', 'BOOLEAN DEFAULT FALSE'],
        ['hotels', 'parking_included', 'BOOLEAN DEFAULT FALSE'],
        ['hotels', 'late_check_in', 'BOOLEAN DEFAULT FALSE'],
        ['hotels', 'room_type', 'TEXT'],
        ['hotels', 'room_number', 'TEXT'],
        ['hotels', 'entry_code', 'TEXT'],
        ['hotels', 'booking_number', 'TEXT'],
        ['hotels', 'phone_number', 'TEXT'],
        ['hotels', 'email', 'TEXT'],
        ['hotels', 'notes', 'TEXT'],
        ['tours', 'company_uuid', 'UUID'],
        ['tours', 'driver_uuid', 'UUID'],
        ['stops', 'company_uuid', 'UUID'],
        ['stops', 'driver_uuid', 'UUID'],
        ['cargo', 'company_uuid', 'UUID'],
        ['cargo', 'driver_uuid', 'UUID'],
        ['cargo_events', 'company_uuid', 'UUID'],
        ['cargo_events', 'driver_uuid', 'UUID'],
        ['drivers', 'company_uuid', 'UUID'],
        ['drivers', 'photo_url', 'TEXT'],
        ['drivers', 'profile_updated_at', 'BIGINT DEFAULT 0'],
        ['drivers', 'updated_at', 'BIGINT'],
        ['drivers', 'deleted_at', 'BIGINT'],
        ['drivers', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['drivers', 'revision', 'INT DEFAULT 1'],
        ['drivers', 'home_lat', 'DOUBLE PRECISION'],
        ['drivers', 'home_lng', 'DOUBLE PRECISION'],
        ['drivers', 'base_lat', 'DOUBLE PRECISION'],
        ['drivers', 'base_lng', 'DOUBLE PRECISION'],
        ['drivers', 'whatsapp', 'TEXT'],
        ['drivers', 'telegram', 'TEXT'],
        ['drivers', 'activation_code', 'TEXT UNIQUE'],
        ['drivers', 'created_at', 'BIGINT'],
        ['driver_devices', 'device_name', 'TEXT'],
        ['driver_devices', 'is_active', 'BOOLEAN DEFAULT TRUE'],
        ['driver_devices', 'linked_at', 'BIGINT'],
        ['driver_devices', 'last_seen_at', 'BIGINT'],
        ['driver_devices', 'created_at', 'BIGINT'],
        ['driver_devices', 'updated_at', 'BIGINT'],
        ['driver_devices', 'deleted_at', 'BIGINT'],
        ['driver_devices', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['driver_devices', 'revision', 'INT DEFAULT 1'],
        ['tours', 'created_at', 'BIGINT'],
        ['tours', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['tours', 'revision', 'INT DEFAULT 1'],
        ['stops', 'created_at', 'BIGINT'],
        ['stops', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['stops', 'revision', 'INT DEFAULT 1'],
        ['hotels', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['hotels', 'revision', 'INT DEFAULT 1'],
        ['cargo', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['cargo', 'revision', 'INT DEFAULT 1'],
        ['work_times', 'created_at', 'BIGINT'],
        ['work_times', 'updated_at', 'BIGINT'],
        ['work_times', 'deleted_at', 'BIGINT'],
        ['work_times', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['work_times', 'revision', 'INT DEFAULT 1'],
        ['costs', 'created_at', 'BIGINT'],
        ['costs', 'updated_at', 'BIGINT'],
        ['costs', 'deleted_at', 'BIGINT'],
        ['costs', 'sync_state', 'TEXT DEFAULT \'SYNCED\''],
        ['costs', 'revision', 'INT DEFAULT 1']
    ];

    for (const [t, c, type] of migrations) {
        await ensureColumn(t, c, type);
    }

    // 3. Default company setup
    await pool.query(`
        INSERT INTO companies (name, slug, is_demo)
        VALUES ('Demo Company', 'demo-company', true)
        ON CONFLICT (slug) DO NOTHING
    `);
    const defaultCompany = (await pool.query("SELECT uuid FROM companies WHERE slug = 'demo-company' LIMIT 1")).rows[0];

    if (defaultCompany) {
        const companyUuid = defaultCompany.uuid;

        const companyLinkedTables = ['drivers', 'live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours', 'cargo', 'cargo_events', 'stops'];
        const driverNamedTables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours', 'cargo'];

        // Helper to check column before update
        const hasColumn = async (table, column) => {
            const res = await pool.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
                [table, column]
            );
            return res.rows.length > 0;
        };

        // Fill company_uuid
        for (const table of companyLinkedTables) {
            if (await hasColumn(table, 'company_uuid')) {
                await pool.query(`UPDATE ${table} SET company_uuid = $1 WHERE company_uuid IS NULL`, [companyUuid]);
            }
        }

        // Fill driver_uuid based on driver_name
        for (const table of driverNamedTables) {
            if (await hasColumn(table, 'driver_uuid') && await hasColumn(table, 'driver_name')) {
                await pool.query(`
                    UPDATE ${table} t
                    SET driver_uuid = d.uuid
                    FROM drivers d
                    WHERE t.driver_uuid IS NULL AND t.driver_name = d.name
                `);
            }
        }

        // Specific backfills
        // Stops backfill from tours
        if (await hasColumn('stops', 'company_uuid') && await hasColumn('stops', 'driver_uuid')) {
            await pool.query(`
                UPDATE stops s
                SET company_uuid = t.company_uuid, driver_uuid = t.driver_uuid
                FROM tours t
                WHERE s.tour_id = t.id AND (s.company_uuid IS NULL OR s.driver_uuid IS NULL)
            `);
        }

        // Cargo_events backfill from cargo
        if (await hasColumn('cargo_events', 'company_uuid')) {
            console.log('[MIGRATION] backfill completed: cargo_events.company_uuid');
            await pool.query(`
                UPDATE cargo_events ce
                SET company_uuid = c.company_uuid, driver_uuid = c.driver_uuid
                FROM cargo c
                WHERE ce.cargo_id = c.id AND (ce.company_uuid IS NULL OR ce.driver_uuid IS NULL)
            `);
        }

        const now = Date.now();
        const syncTables = ['drivers', 'driver_devices', 'tours', 'stops', 'hotels', 'cargo', 'work_times', 'costs'];
        for (const table of syncTables) {
            const fallbackColumn = await hasColumn(table, 'timestamp') ? 'timestamp' : 'NULL';
            if (await hasColumn(table, 'created_at')) {
                await pool.query(`UPDATE ${table} SET created_at = COALESCE(created_at, updated_at, ${fallbackColumn}, $1) WHERE created_at IS NULL`, [now]);
            }
            if (await hasColumn(table, 'updated_at')) {
                await pool.query(`UPDATE ${table} SET updated_at = COALESCE(updated_at, ${fallbackColumn}, created_at, $1) WHERE updated_at IS NULL`, [now]);
            }
            if (await hasColumn(table, 'sync_state')) {
                await pool.query(`UPDATE ${table} SET sync_state = COALESCE(sync_state, 'SYNCED') WHERE sync_state IS NULL`);
            }
            if (await hasColumn(table, 'revision')) {
                await pool.query(`UPDATE ${table} SET revision = COALESCE(revision, 1) WHERE revision IS NULL`);
            }
        }

        // Permissions
        const permissionRows = [
            ['CEO', 'tours', true, true],
            ['CEO', 'live_status', true, false],
            ['CEO', 'fuel', true, false],
            ['CEO', 'costs', true, true],
            ['CEO', 'chat', false, false],
            ['CEO', 'reports', true, false],
            ['DISPATCHER', 'tours', true, true],
            ['DISPATCHER', 'live_status', true, false],
            ['DISPATCHER', 'fuel', false, false],
            ['DISPATCHER', 'costs', false, false],
            ['DISPATCHER', 'chat', true, true],
            ['DISPATCHER', 'reports', true, false]
        ];
        for (const [role, module, canView, canEdit] of permissionRows) {
            await pool.query(`
                INSERT INTO role_permissions (company_uuid, role, module, can_view, can_edit)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (company_uuid, role, module) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
                [companyUuid, role, module, canView, canEdit]);
        }
    }

    // 4. Constraints (Idempotent)
    const constraints = [
        ['work_times', 'unique_worktime', 'UNIQUE (driver_name, start_time)'],
        ['costs', 'unique_cost', 'UNIQUE (driver_name, timestamp, amount)'],
        ['hotels', 'unique_hotel', 'UNIQUE (driver_name, timestamp, name)']
    ];
    for (const [t, name, def] of constraints) {
        try {
            const check = await pool.query("SELECT conname FROM pg_constraint WHERE conname = $1", [name]);
            if (check.rows.length === 0) {
                console.log(`[SCHEMA] adding constraint ${name} to ${t}`);
                await pool.query(`ALTER TABLE ${t} ADD CONSTRAINT ${name} ${def}`);
            }
        } catch (e) {
            console.error(`[SCHEMA] Skip constraint ${name}:`, e.message);
        }
    }

    // 5. Schema Audit
    const auditTables = ['live_updates', 'costs', 'chat_messages', 'work_times', 'hotels', 'tours', 'cargo', 'cargo_events', 'stops', 'drivers'];
    for (const table of auditTables) {
        const res = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_uuid'",
            [table]
        );
        if (res.rows.length === 0) {
            throw new Error(`FATAL: Schema audit failed - table ${table} is missing company_uuid`);
        }
    }
    console.log('[STARTUP] initDb finished');
};

module.exports = initDb;
