'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {keyDomain, requireLaunchApproval, requireTransactionDomain, refundableCancellation} =
  require('../functions/paystack-payment-safety');

test('live checkout requires explicit provider approval and validation evidence; test keys cannot authorize live transactions', () => {
  assert.equal(keyDomain('sk_test_example'), 'test');
  assert.equal(keyDomain('sk_live_example'), 'live');
  for (const key of ['', 'pk_live_example', 'arbitrary']) assert.throws(() => keyDomain(key));
  assert.doesNotThrow(() => requireLaunchApproval('test', null));
  for (const launch of [null, {}, {liveEnabled: true},
    {liveEnabled: true, approvalReference: 'Grace approval'},
    {liveEnabled: false, approvalReference: 'Grace approval', validationReference: 'staging-run'}]) {
    assert.throws(() => requireLaunchApproval('live', launch), {code: 'payment/launch-not-approved'});
  }
  assert.doesNotThrow(() => requireLaunchApproval('live', {
    liveEnabled: true, approvalReference: 'provider-approval', validationReference: 'accepted-staging-run'
  }));
  for (const domain of [undefined, 'live'])
    assert.throws(() => requireTransactionDomain({paystackDomain: 'test'}, {domain}, 'test'));
  assert.doesNotThrow(() => requireTransactionDomain({paystackDomain: 'test'}, {domain: 'test'}, 'live'));
});

test('automatic refunds require a cancelled unstarted trip or cancelled unboarded Work member', () => {
  for (const status of ['accepted', 'driver_on_way', 'arrived', 'in_transit', 'completed'])
    assert.equal(refundableCancellation({status}, 'sender'), false);
  for (const status of ['cancelled_by_commuter', 'cancelled_by_driver', 'cancelled_by_admin', 'rejected', 'expired'])
    assert.equal(refundableCancellation({status}, 'sender'), true);
  assert.equal(refundableCancellation({status: 'cancelled_by_admin', pinVerifiedAt: 1}, 'sender'), false);
  assert.equal(refundableCancellation({type: 'club', status: 'driver_waiting',
    passengers: {sender: {status: 'cancelled_by_commuter'}, member: {status: 'waiting'}}}, 'sender'), true);
  assert.equal(refundableCancellation({type: 'club', status: 'driver_waiting',
    passengers: {sender: {status: 'cancelled_by_commuter', pinVerifiedAt: 1}}}, 'sender'), false);
});
