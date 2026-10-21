'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyze,functionNames,kinds}=require('../scripts/diagnose_paystack_deploy_log.cjs');

test('offline staging failure analyzer detects named provisioning failures without exposing secrets',()=>{
  const privateText='Authorization: Bearer DO_NOT_LEAK token=DO_NOT_LEAK';
  const sample=[
    '[info] functions: creating Node.js 22 (2nd Gen) function goTripActionSecure(us-central1)...',
    '[info] functions: updating Node.js 22 (2nd Gen) function prepareTripPayment(us-central1)...',
    '[error] Failed to create function projects/asiye-paystack-staging/locations/us-central1/functions/goTripActionSecure: Request had HTTP Error: 429, quota exceeded '+privateText,
    '[error] Failed to create function projects/asiye-paystack-staging/locations/us-central1/functions/createClubBookingSecure: Container Healthcheck failed '+privateText,
    'Error: There was an error deploying functions:',
    '    goTripActionSecure(us-central1)',
    '    createClubBookingSecure(us-central1)'
  ].join('\n');
  const data=analyze(sample);
  assert.ok(data.attemptedCreate.includes('goTripActionSecure'));
  assert.ok(data.attemptedUpdate.includes('prepareTripPayment'));
  assert.deepEqual(data.explicitFailed.sort(),['createClubBookingSecure','goTripActionSecure'].sort());
  assert.ok(data.terminalCodes.includes('429'));
  assert.ok(data.categories.some(x=>x[0]==='QUOTA_OR_RATE_LIMIT'));
  assert.ok(data.categories.some(x=>x[0]==='CLOUD_RUN_STARTUP'));
  assert.doesNotMatch(JSON.stringify(data),/DO_NOT_LEAK|Bearer|token=/i);
});

test('function name matching cannot confuse similar names or echo arbitrary customer data',()=>{
  assert.deepEqual(functionNames('getTripShareTokenNotExpected'),[]);
  assert.deepEqual(functionNames('Cannot create getTripShare'),['getTripShare']);
  assert.deepEqual(functionNames('GOOO SECRET PERSONAL_IDENTIFIER'),[]);
  assert.deepEqual(kinds('no errors here'),[]);
});

test('offline analyzer safely handles a log with no recognizable errors',()=>{
  const data=analyze('[info] functions: preparing 37 functions\n[info] deployment started');
  assert.deepEqual(data.explicitFailed,[]);
  assert.deepEqual(data.categories,[]);
});
