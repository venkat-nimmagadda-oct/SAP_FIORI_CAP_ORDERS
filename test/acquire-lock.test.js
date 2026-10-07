const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test, before, after } = require('node:test');
const vm = require('node:vm');
const cds = require('@sap/cds');

const source = readFileSync(require.resolve('../srv/service.js'), 'utf8');
const lockFunction = source.slice(
    source.indexOf('    async function acquireLock('),
    source.indexOf('    async function releaseLock(')
);
const now = new Date('2026-10-07T12:00:00.000Z');
let db;
let acquireLock;

before(async () => {
    db = await cds.deploy({
        $sources: [],
        definitions: {
            Locks: {
                kind: 'entity',
                elements: {
                    supplierReferenceNumber: { key: true, type: 'cds.String' },
                    isProcessing: { type: 'cds.Boolean' },
                    lockedBy: { type: 'cds.String' },
                    lockedAt: { type: 'cds.Timestamp' },
                    lockExpiresAt: { type: 'cds.Timestamp' }
                }
            }
        }
    }).to('sqlite::memory:');
    acquireLock = vm.runInNewContext(`${lockFunction}; acquireLock`, {
        Date,
        UPDATE: cds.ql.UPDATE,
        SupplierOrdersReprocess: 'Locks',
        LOCK_EXPIRY_MINUTES: 11
    });
});

after(async () => {
    await db?.disconnect();
});

for (const [name, isProcessing, expiry, expected] of [
    ['unlocked', false, '2026-10-07T12:01:00Z', true],
    ['null processing flag', null, '2026-10-07T12:01:00Z', true],
    ['null expiry', true, null, true],
    ['expired', true, '2026-10-07T11:59:59Z', true],
    ['expires at request time', true, now.toISOString(), true],
    ['active', true, '2026-10-07T12:00:01Z', false]
]) {
    test(name, async () => {
        await db.run(cds.ql.INSERT.into('Locks').entries({
            supplierReferenceNumber: name,
            isProcessing,
            lockExpiresAt: expiry,
            lockedBy: 'previous-user'
        }));
        assert.equal(await acquireLock(name, 'request-user', now), expected);
        const row = await db.run(cds.ql.SELECT.one.from('Locks').where({
            supplierReferenceNumber: name
        }));
        assert.equal(row.lockedBy, expected ? 'request-user' : 'previous-user');
        if (expected) {
            assert.equal(row.isProcessing, true);
            assert.equal(new Date(row.lockedAt).getTime(), now.getTime());
            assert.equal(new Date(row.lockExpiresAt).getTime(), now.getTime() + 11 * 60 * 1000);
        }
    });
}

test('missing order', async () => {
    assert.equal(await acquireLock('missing', 'request-user', now), false);
});

test('competing acquisitions have only one winner', async () => {
    await db.run(cds.ql.INSERT.into('Locks').entries({
        supplierReferenceNumber: 'contended',
        isProcessing: false
    }));
    const results = await Promise.all([
        acquireLock('contended', 'first-user', now),
        acquireLock('contended', 'second-user', now)
    ]);
    assert.equal(results.filter(Boolean).length, 1);
});
