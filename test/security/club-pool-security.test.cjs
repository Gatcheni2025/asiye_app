const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyClubJoin } = require('../../functions/club-pool-security');

test('server Club join adds only the authenticated passenger and recalculates pool state', () => {
  const pool = {
    type: 'club',
    capacity: 3,
    calculatedPrice: 300,
    status: 'pooling',
    passengers: {
      p1: { commuterId: 'p1', status: 'waiting_pool', price: 115 }
    }
  };

  const result = applyClubJoin(
    structuredClone(pool),
    'p2',
    {
      name: 'Passenger Two',
      pickupPin: '1234',
      pickupLat: -29.8,
      pickupLng: 31.0,
      destinationLat: -29.7,
      destinationLng: 30.9,
      paymentMethod: 'cash'
    },
    123456
  );

  assert.equal(result.joined, true);
  assert.equal(result.pool.passengerCount, 2);
  assert.equal(result.pool.remainingSeats, 1);
  assert.equal(result.pool.status, 'pooling');
  assert.equal(result.pool.poolReady, false);
  assert.equal(result.pool.passengers.p2.commuterId, 'p2');
  assert.equal(result.pool.passengers.p2.joinedAt, 123456);
  assert.equal(result.pool.passengers.p1.price, 115);
  assert.equal(result.pool.passengers.p2.price, 115);
});

test('server Club join becomes pool_ready at capacity', () => {
  const pool = {
    type: 'club',
    capacity: 2,
    marketReferenceFare: 200,
    passengers: {
      p1: { commuterId: 'p1', status: 'waiting_pool' }
    }
  };

  const result = applyClubJoin(
    structuredClone(pool),
    'p2',
    { name: 'Passenger Two', pickupPin: '1234' },
    999
  );

  assert.equal(result.pool.passengerCount, 2);
  assert.equal(result.pool.poolReady, true);
  assert.equal(result.pool.status, 'pool_ready');
  assert.equal(result.pool.poolReadyAt, 999);
  assert.equal(result.pool.pricePerPassenger, 115);
});

test('server Club join rejects over-capacity pools and is idempotent for existing passenger', () => {
  const full = {
    type: 'club',
    capacity: 1,
    passengers: {
      p1: { commuterId: 'p1', status: 'waiting_pool' }
    }
  };

  assert.throws(
    () => applyClubJoin(structuredClone(full), 'p2', {}, 1),
    error => error.code === 'club/full'
  );

  const same = applyClubJoin(structuredClone(full), 'p1', {}, 1);
  assert.equal(same.joined, false);
  assert.equal(Object.keys(same.pool.passengers).length, 1);
});
