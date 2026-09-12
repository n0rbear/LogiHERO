const { validateCanonicalSchema } = require('../schema-contract');
const { DRIVER_PWA_REQUIRED_COLUMNS } = require('../driver-pwa-schema');

async function verifyDriverPwaAuthSchema(client) {
    await validateCanonicalSchema(client);
    for (const [table, required] of Object.entries(DRIVER_PWA_REQUIRED_COLUMNS)) {
        const result = await client.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [table]
        );
        const actual = new Set(result.rows.map((row) => row.column_name));
        const missing = required.filter((column) => !actual.has(column));
        if (missing.length) {
            const error = new Error(`Schema drift: ${table} is missing ${missing.join(', ')}`);
            error.code = 'SCHEMA_DRIFT';
            throw error;
        }
    }
    const constraints = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid IN ('public.driver_accounts'::regclass, 'public.driver_web_sessions'::regclass)
    `);
    const names = new Set(constraints.rows.map((row) => row.conname));
    for (const name of ['driver_accounts_driver_uuid_key', 'driver_accounts_username_normalized_key', 'driver_web_sessions_token_hash_key']) {
        if (!names.has(name)) {
            const error = new Error(`Schema drift: missing constraint ${name}`);
            error.code = 'SCHEMA_DRIFT';
            throw error;
        }
    }
}

module.exports = {
    id: '007_driver_pwa_auth_foundation',
    description: 'Add driver web accounts and durable revocable browser sessions.',
    checksumFiles: ['../schema-contract.js', '../driver-pwa-schema.js'],
    async up(client) {
        await client.query(`
            CREATE TABLE driver_accounts (
                uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                driver_uuid UUID NOT NULL UNIQUE REFERENCES drivers(uuid),
                username TEXT NOT NULL,
                username_normalized TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                password_version INTEGER NOT NULL DEFAULT 1 CHECK (password_version > 0),
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                password_changed_at BIGINT,
                last_login_at BIGINT,
                CHECK (username_normalized = lower(btrim(username_normalized))),
                CHECK (char_length(username_normalized) BETWEEN 3 AND 64)
            )
        `);
        await client.query(`
            CREATE TABLE driver_web_sessions (
                uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                account_uuid UUID NOT NULL REFERENCES driver_accounts(uuid) ON DELETE CASCADE,
                token_hash CHAR(64) NOT NULL UNIQUE,
                csrf_token_hash CHAR(64) NOT NULL,
                password_version INTEGER NOT NULL CHECK (password_version > 0),
                created_at BIGINT NOT NULL,
                last_seen_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                revoked_at BIGINT,
                revoke_reason TEXT,
                user_agent TEXT,
                CHECK (expires_at > created_at)
            )
        `);
        await client.query('CREATE INDEX driver_web_sessions_account_active_idx ON driver_web_sessions (account_uuid, expires_at) WHERE revoked_at IS NULL');
        await client.query('CREATE INDEX driver_web_sessions_expiry_idx ON driver_web_sessions (expires_at)');
        await verifyDriverPwaAuthSchema(client);
    },
    verify: verifyDriverPwaAuthSchema
};

module.exports.verifyDriverPwaAuthSchema = verifyDriverPwaAuthSchema;
