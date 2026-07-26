module.exports = {
    id: '001_baseline_logihero_schema',
    description: 'Baseline current LogiHERO idempotent schema managed by db:init.',
    async up(_client) {
        // Baseline migration: existing production schema is created/maintained by db:init.
        // This records the baseline without destructive changes.
    }
};
