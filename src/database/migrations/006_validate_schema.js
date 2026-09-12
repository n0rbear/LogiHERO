const { validateCanonicalSchema } = require('../schema-contract');

module.exports = {
    id: '006_validate_schema',
    description: 'Validate the canonical LogiHERO schema contract and migration head.',
    checksumFiles: ['../schema-contract.js'],
    async up(client) {
        await validateCanonicalSchema(client);
    },
    async verify(client) {
        return validateCanonicalSchema(client);
    }
};
