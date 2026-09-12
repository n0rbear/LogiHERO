// Skipping a database test is only acceptable on a developer machine that has no local
// PostgreSQL running. Wherever the suite is expected to have a database — CI, or any run that
// sets REQUIRE_POSTGRES=1 — an unreachable database must fail the run loudly instead of quietly
// reducing coverage to a green tick. GitHub Actions sets CI=true for every job.
const POSTGRES_REQUIRED = process.env.REQUIRE_POSTGRES === '1' || process.env.CI === 'true';

async function ensurePostgres(t, pool) {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch (error) {
        const reason = `Local PostgreSQL unavailable: ${error.code || error.message}`;
        if (POSTGRES_REQUIRED) {
            throw new Error(`${reason}. PostgreSQL is required here (REQUIRE_POSTGRES/CI is set), so this test must not be skipped.`);
        }
        t.skip(reason);
        return false;
    }
}

module.exports = { POSTGRES_REQUIRED, ensurePostgres };
