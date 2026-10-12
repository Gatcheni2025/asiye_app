'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {activate, action, paymentReady, arrived} = require('../functions/go-continuation');
const base = method => ({type: 'ehailing', rideType: 'go', negotiationEnabled: true,
  commuterId: 'passenger', taxiId: 'driver', status: 'payment_required', fareStatus: 'agreed',
  agreedFare: 113, finalAmount: 113, paymentMethod: method, safetyShareCompleted: false});
const agreement = method => ({driverId: 'driver', agreedFare: 113, commissionRate: 0.2, paymentMethod: method});
const ledger = (method, status) => ({method, amount: 113, status});
const evidence = method => ({role: 'driver', agreement: agreement(method), payment: ledger(method, method === 'cash' ? 'cash_due' : 'held'), nearPickup: true});

test('cash and reserved Wallet/voucher credits unlock pickup without pre-arrival sharing', () => {
  for (const method of ['cash', 'wallet']) {
    const trip = activate(base(method), agreement(method), evidence(method).payment, '4831', 100);
    assert.equal(trip.status, 'accepted');
    assert.equal(trip.paymentsReady, true);
    assert.equal(trip.safetyShareCompleted, false);
    assert.equal(trip.pickupPin, '4831');
    assert.equal(action(trip, 'onWay', {}, evidence(method), 101).status, 'driver_on_way');
  }
});
test('card stays locked for pending/failed/released/wrong-amount payment; confirmed payment immediately unlocks', () => {
  for (const status of ['pending', 'payment_required', 'failed', 'released'])
    assert.throws(() => activate(base('card'), agreement('card'), ledger('card', status), '4831', 100));
  for (const change of [{amount: 112.99}, {method: 'cash'}, {status: 'refunded'}])
    assert.equal(paymentReady(base('card'), agreement('card'), {...ledger('card', 'held'), ...change}), false);
  assert.equal(activate(base('card'), agreement('card'), ledger('card', 'held'), '4831', 100).status, 'accepted');
  assert.equal(paymentReady({...base('card'), paymentStatus: 'held', paymentsReady: true}, agreement('card'), null), false);
});
test('tampered fare, changed assigned driver, or incorrect commission cannot activate a booking', () => {
  for (const change of [{agreedFare: 1}, {finalAmount: 1}, {taxiId: 'other'}])
    assert.throws(() => activate({...base('cash'), ...change}, agreement('cash'), ledger('cash', 'cash_due'), '4831', 100));
  assert.throws(() => activate(base('cash'), {...agreement('cash'), commissionRate: 0}, ledger('cash', 'cash_due'), '4831', 100));
});
test('duplicate confirmation preserves PIN and advanced trip status; cancellation wins over late payment', () => {
  const trip = activate(base('card'), agreement('card'), ledger('card', 'held'), '4831', 100);
  for (const status of ['driver_on_way', 'arrived', 'in_transit']) {
    const live = {...trip, status, pinVerifiedAt: status === 'in_transit' ? 150 : undefined};
    assert.deepEqual(activate(live, agreement('card'), ledger('card', 'held'), '9999', 200), live);
  }
  const cancelled = {...trip, status: 'cancelled_by_commuter'};
  assert.deepEqual(activate(cancelled, agreement('card'), ledger('card', 'held'), '9999', 200), cancelled);
});
test('both roles may cancel before arrival, but arrival and departure close cancellation', () => {
  const trip = activate(base('cash'), agreement('cash'), ledger('cash', 'cash_due'), '4831', 100);
  assert.equal(action(trip, 'cancel', {}, {role: 'passenger'}, 101).status, 'cancelled_by_commuter');
  assert.equal(action(trip, 'cancel', {}, {role: 'driver'}, 101).status, 'cancelled_by_driver');
  for (const role of ['passenger', 'driver']) {
    for (const change of [{status: 'arrived'}, {arrivedAt: 102}, {status: 'in_transit'}, {tripStartedAt: 102}])
      assert.throws(() => action({...trip, ...change}, 'cancel', {}, {role}, 103));
  }
  assert.equal(arrived({...trip, arrivedAt: 0}), false);
});
test('arrival, sharing and server PIN verification precede departure; wrong PIN attempts persist and lock', () => {
  const e = evidence('cash');
  let trip = activate(base('cash'), e.agreement, e.payment, '4831', 100);
  assert.throws(() => action(trip, 'verifyPin', {pin: '4831'}, e, 101));
  assert.throws(() => action(trip, 'shareComplete', {}, {...e, shareIssued: true}, 101));
  trip = action(trip, 'onWay', {}, e, 102);
  trip = action(trip, 'arrive', {}, e, 103);
  assert.throws(() => action(trip, 'verifyPin', {pin: '4831'}, e, 104));
  assert.throws(() => action(trip, 'shareComplete', {}, e, 104));
  trip = action(trip, 'shareComplete', {}, {...e, shareIssued: true}, 105);
  const bad = action(trip, 'verifyPin', {pin: '0000'}, e, 106);
  assert.equal(bad.pinAttempts, 1);
  assert.equal(bad.status, 'arrived');
  const started = action(bad, 'verifyPin', {pin: '4831'}, e, 107);
  assert.equal(started.status, 'in_transit');
  assert.equal(started.pinVerifiedAt, 107);
  assert.deepEqual(action(started, 'verifyPin', {pin: '4831'}, e, 108), started);
  let locked = trip;
  for (let i = 0; i < 5; i++) locked = action(locked, 'verifyPin', {pin: '0000'}, e, 106 + i);
  assert.throws(() => action(locked, 'verifyPin', {pin: '4831'}, e, 120), /locked/);
});

test('cash remains due at pickup; receipt is confirmed only after verified departure and destination arrival', () => {
  const {requireCashDropoff} = require('../functions/go-continuation');
  const e = {...evidence('cash'), nearDestination:true};
  let trip = activate({...base('cash'), cashCollectionVersion:2}, e.agreement, e.payment, '4831', 100);
  assert.equal(trip.paymentStatus,'cash_due');
  assert.equal(trip.cashCollectedAt,undefined);
  assert.throws(() => action(trip,'collectCash',{cashCollected:true},e,101), /pickup PIN/);
  trip = action(trip,'onWay',{},e,102);
  trip = action(trip,'arrive',{},e,103);
  trip = action(trip,'shareComplete',{}, {...e, shareIssued:true},104);
  assert.throws(() => action(trip,'collectCash',{cashCollected:true},e,105), /pickup PIN/);
  trip = action(trip,'verifyPin',{pin:'4831'},e,106);
  assert.equal(trip.pinVerifiedAt,106);
  assert.throws(() => requireCashDropoff(trip), /after drop-off/);
  assert.throws(() => action(trip,'collectCash',{cashCollected:true}, {...e,nearDestination:false},107), /destination/);
  assert.throws(() => action(trip,'collectCash',{},e,107), /destination/);
  const collected = action(trip,'collectCash',{cashCollected:true},e,108);
  requireCashDropoff(collected);
  assert.equal(collected.cashCollectedAt,108);
  assert.equal(collected.pinVerifiedAt,106);
  assert.equal(collected.cashCollectionStatus,'collected');
  assert.deepEqual(action(collected,'collectCash',{cashCollected:true},e,109),collected);
});
