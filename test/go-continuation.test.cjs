'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {activate, action, paymentReady, arrived, clearRequestPointer} = require('../functions/go-continuation');

test('cancelled booking cleanup retries the empty cache and never removes a newer booking',()=>{
  assert.equal(clearRequestPointer(null,'old'),null);
  assert.equal(clearRequestPointer('old','old'),null);
  assert.equal(clearRequestPointer('new','old'),undefined);
});

test('repeated cancellation is safe while an arrived booking remains protected',()=>{
  const trip={commuterId:'passenger',status:'cancelled_by_commuter',cancelledAt:10};
  assert.deepEqual(action(trip,'cancel',{}, {role:'passenger'},20),trip);
  assert.throws(()=>action({...trip,status:'arrived',arrivedAt:1},'cancel',{}, {role:'passenger'},20));
});
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
test('PIN verified after arrival starts trip without mandatory WhatsApp share; wrong attempts lock', () => {
  const e = evidence('cash');
  let trip = activate(base('cash'), e.agreement, e.payment, '4831', 100);
  assert.throws(() => action(trip, 'verifyPin', {pin: '4831'}, e, 101));
  assert.throws(() => action(trip, 'shareComplete', {}, {...e, shareIssued: true}, 101));
  trip = action(trip, 'onWay', {}, e, 102);
  trip = action(trip, 'arrive', {}, e, 103);
  assert.equal(trip.safetyShareCompleted, false);
  assert.equal(trip.safetyShareRequired, false);
  assert.throws(() => action(trip, 'shareComplete', {}, e, 104));
  const bad = action(trip, 'verifyPin', {pin: '0000'}, e, 106);
  assert.equal(bad.pinAttempts, 1);
  assert.equal(bad.status, 'arrived');
  const started = action(bad, 'verifyPin', {pin: '4831'}, e, 107);
  assert.equal(started.status, 'in_transit');
  assert.equal(started.pinVerifiedAt, 107);
  assert.equal(started.safetyShareCompleted, false);
  assert.deepEqual(action(started, 'verifyPin', {pin: '4831'}, e, 108), started);
  let locked = trip;
  for (let i = 0; i < 5; i++) locked = action(locked, 'verifyPin', {pin: '0000'}, e, 106 + i);
  assert.throws(() => action(locked, 'verifyPin', {pin: '4831'}, e, 120), /locked/);
  const shared = action(trip, 'shareComplete', {}, {...e, shareIssued:true}, 105);
  assert.equal(shared.safetyShareCompleted, true);
  assert.equal(action(shared, 'verifyPin', {pin:'4831'}, e, 107).status, 'in_transit');
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
  // Cash payment remains due until verified departure and destination arrival; WhatsApp is optional.
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

test('sharing is not a protected settlement gate and includes a live tracking URL without the PIN', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const functions = fs.readFileSync(path.join(root,'functions/index.js'), 'utf8');
  const start = functions.indexOf('async function settleProtectedGoFinancials');
  const settlement = functions.slice(start, start + 1050);
  assert.ok(start >= 0);
  assert.match(settlement, /trip\.paymentsReady !== true/);
  assert.doesNotMatch(settlement, /trip\.safetyShareCompleted !== true/);
  const booking = fs.readFileSync(path.join(root,'assets/passenger-v2/js/booking.js'), 'utf8');
  const share = booking.slice(booking.indexOf('    async requireTripShare({'), booking.indexOf('    async createLiveShareUrl('));
  assert.match(share, /Follow my trip live/);
  assert.doesNotMatch(share, /Safety PIN: \$\{pickupPin\}/);
  const ride = fs.readFileSync(path.join(root,'assets/passenger-v2/js/ride-controller.js'), 'utf8');
  const inTransit = ride.slice(ride.indexOf("document.getElementById('transitShare')"), ride.indexOf('    renderCompleted(request)'));
  assert.match(inTransit, /createLiveShareUrl\(this\.requestId\)/);
  assert.match(inTransit, /AsiyeTripShare\.require\(text\)/);
});
