const { TABLES, schemaFingerprint, validateCanonicalSchema } = require('./schema-contract');
const { verifyMigrations } = require('./migration-runtime');

const LOGIHERO_TABLES = ['schema_migrations', ...TABLES.map(([table]) => table)];
const UUID_TABLES = ['companies', 'drivers', 'web_users', 'live_updates', 'costs', 'chat_messages', 'work_times', 'work_days', 'work_time_entries', 'work_time_audit', 'work_time_conflicts', 'tours', 'stops', 'hotels', 'cargo', 'cargo_events'];

function assertLocalDatabaseUrl(databaseUrl, purpose) {
    const parsed = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
        throw new Error(`${purpose} is restricted to a local PostgreSQL host`);
    }
    return parsed;
}

async function rowCounts(client) {
    const counts = {};
    for (const table of LOGIHERO_TABLES) {
        counts[table] = Number((await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count);
    }
    return counts;
}

async function uuidIntegrity(client) {
    const result = {};
    for (const table of UUID_TABLES) {
        const key = table === 'work_time_audit' ? 'event_uuid' : 'uuid';
        const columns = await client.query(`
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name=$2
        `, [table, key]);
        if (!columns.rowCount) continue;
        result[table] = Number((await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${key} IS NULL`)).rows[0].count);
    }
    return result;
}

async function relationshipIntegrity(client) {
    const checks = {
        stopsWithoutTour: 'SELECT COUNT(*)::int AS count FROM stops s LEFT JOIN tours t ON t.id=s.tour_id WHERE s.tour_id IS NOT NULL AND t.id IS NULL',
        hotelsWithoutTour: 'SELECT COUNT(*)::int AS count FROM hotels h LEFT JOIN tours t ON t.id=h.tour_id WHERE h.tour_id IS NOT NULL AND t.id IS NULL',
        cargoWithoutTour: 'SELECT COUNT(*)::int AS count FROM cargo c LEFT JOIN tours t ON t.id=c.tour_id WHERE c.tour_id IS NOT NULL AND t.id IS NULL',
        cargoEventsWithoutCargo: 'SELECT COUNT(*)::int AS count FROM cargo_events e LEFT JOIN cargo c ON c.id=e.cargo_id WHERE e.cargo_id IS NOT NULL AND c.id IS NULL',
        invalidDeviceTokenHashes: "SELECT COUNT(*)::int AS count FROM driver_devices WHERE device_token_hash IS NOT NULL AND length(device_token_hash) <> 64"
    };
    const result = {};
    for (const [name, sql] of Object.entries(checks)) result[name] = Number((await client.query(sql)).rows[0].count);
    return result;
}

async function sequenceIntegrity(client) {
    const rows = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema='public' AND column_default LIKE 'nextval(%'
          AND table_name=ANY($1::text[])
        ORDER BY table_name, column_name
    `, [LOGIHERO_TABLES]);
    const result = {};
    for (const row of rows.rows) {
        const sequence = (await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [`public.${row.table_name}`, row.column_name])).rows[0]?.name;
        const maximum = Number((await client.query(`SELECT COALESCE(MAX(${row.column_name}), 0)::bigint AS maximum FROM ${row.table_name}`)).rows[0].maximum);
        const sequenceState = sequence ? (await client.query(`SELECT last_value::bigint, is_called FROM ${sequence}`)).rows[0] : null;
        result[`${row.table_name}.${row.column_name}`] = {
            maximum,
            lastValue: sequenceState ? Number(sequenceState.last_value) : null,
            isCalled: sequenceState?.is_called ?? null,
            valid: !sequenceState || sequenceState.last_value >= maximum
        };
    }
    return result;
}

async function inspectDatabase(client) {
    await verifyMigrations(client);
    await validateCanonicalSchema(client);
    const counts = await rowCounts(client);
    const fingerprint = await schemaFingerprint(client);
    const uuids = await uuidIntegrity(client);
    const relationships = await relationshipIntegrity(client);
    const sequences = await sequenceIntegrity(client);
    const invalidUuids = Object.entries(uuids).filter(([, count]) => count > 0);
    const invalidRelationships = Object.entries(relationships).filter(([, count]) => count > 0);
    const invalidSequences = Object.entries(sequences).filter(([, state]) => !state.valid);
    if (invalidUuids.length || invalidRelationships.length || invalidSequences.length) {
        throw new Error(`Database integrity validation failed: ${JSON.stringify({ invalidUuids, invalidRelationships, invalidSequences })}`);
    }
    return { counts, fingerprint, uuids, relationships, sequences };
}

module.exports = {
    LOGIHERO_TABLES,
    UUID_TABLES,
    assertLocalDatabaseUrl,
    inspectDatabase,
    relationshipIntegrity,
    rowCounts,
    sequenceIntegrity,
    uuidIntegrity
};
