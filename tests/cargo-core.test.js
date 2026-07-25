const test = require('node:test');
const assert = require('node:assert');

// Mocked validation logic for testing
function validateStopSequence(pickupIdx, deliveryIdx) {
    if (deliveryIdx < pickupIdx) throw new Error('DELIVERY_BEFORE_PICKUP');
}

function normalizeSerial(sn) {
    if (!sn) return null;
    return String(sn).trim().toUpperCase().replace(/[-\s]/g, '');
}

test('Cargo Stop Sequence Validation', (t) => {
    assert.doesNotThrow(() => validateStopSequence(1, 2));
    assert.throws(() => validateStopSequence(2, 1), /DELIVERY_BEFORE_PICKUP/);
    assert.doesNotThrow(() => validateStopSequence(1, 1)); // Same stop pickup/delivery allowed
});

test('Serial Number Normalization', (t) => {
    assert.strictEqual(normalizeSerial('  cat-123  '), 'CAT123');
    assert.strictEqual(normalizeSerial('ABC 456'), 'ABC456');
    assert.strictEqual(normalizeSerial(null), null);
});

test('Cargo status transition logic', (t) => {
    const validTransitions = {
        'PLANNED': ['READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED', 'DAMAGED', 'MISSING'],
        'READY_FOR_PICKUP': ['PICKED_UP', 'REJECTED', 'CANCELLED', 'DAMAGED', 'MISSING'],
        'PICKED_UP': ['IN_TRANSIT', 'DELIVERED', 'DAMAGED', 'MISSING', 'CANCELLED'],
        'IN_TRANSIT': ['DELIVERED', 'DAMAGED', 'MISSING', 'CANCELLED']
    };

    const check = (from, to) => validTransitions[from]?.includes(to);

    assert.strictEqual(check('PLANNED', 'READY_FOR_PICKUP'), true);
    assert.strictEqual(check('PICKED_UP', 'DELIVERED'), true);
    assert.strictEqual(check('DELIVERED', 'PLANNED'), undefined); // terminal
    assert.strictEqual(check('PICKED_UP', 'DAMAGED'), true);
});

test('Safe Deletion Check', (t) => {
    const isDeletable = (status) => ['PLANNED', 'READY_FOR_PICKUP', 'CANCELLED'].includes(status);

    assert.strictEqual(isDeletable('PLANNED'), true);
    assert.strictEqual(isDeletable('PICKED_UP'), false);
    assert.strictEqual(isDeletable('DELIVERED'), false);
    assert.strictEqual(isDeletable('IN_TRANSIT'), false);
});
