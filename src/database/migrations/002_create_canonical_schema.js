const {
    addMissingCanonicalColumns,
    createCanonicalTables
} = require('../schema-contract');

module.exports = {
    id: '002_create_canonical_schema',
    description: 'Create the complete LogiHERO schema without application seed data.',
    checksumFiles: ['../schema-contract.js'],
    async up(client) {
        await createCanonicalTables(client);
        await addMissingCanonicalColumns(client);
    }
};
