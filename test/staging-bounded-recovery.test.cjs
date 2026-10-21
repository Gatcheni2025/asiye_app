'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inventory,plan,selectBatch,reconcileBatch,PRIORITY,BASE_ACTIVE}=require('../scripts/recover_missing_paystack_staging.cjs');
const manifest=require('../scripts/paystack_function_manifest.json');
const entry=name=>({name:'projects/asiye-paystack-staging/locations/us-central1/functions/'+name,state:'ACTIVE'});
test('staging recovery chooses only the first three currently absent endpoints',()=>{
  const seen=inventory(BASE_ACTIVE.map(entry));
  assert.equal(seen.active.length,16);
  assert.equal(seen.missing.length,21);
  assert.deepEqual(plan(seen),['goTripActionSecure','submitGoFareOffer','counterGoFare']);
  assert.ok(!plan(seen).some(x=>BASE_ACTIVE.includes(x)));
});
test('recovery planner excludes functions that have since become active',()=>{
  const newly=[...BASE_ACTIVE,'goTripActionSecure','submitGoFareOffer'];
  const seen=inventory(newly.map(entry));
  assert.deepEqual(plan(seen),['counterGoFare','acceptGoFareOffer','acceptGoFareCounter']);
});
test('recovery refuses missing baseline or nonactive resources',()=>{
  const without=inventory(BASE_ACTIVE.slice(1).map(entry));
  assert.throws(()=>plan(without),/previously active|baseline|refusing/i);
  const x=inventory([...BASE_ACTIVE.map(entry),{
    name:'projects/asiye-paystack-staging/locations/us-central1/functions/goTripActionSecure',
    state:'FAILED'
  }]);
  assert.throws(()=>plan(x),/Non-ACTIVE/);
});
test('no production resource can appear in the reviewed deployment manifest',()=>{
  assert.equal(PRIORITY.length,21);
  assert.equal(new Set(PRIORITY).size,21);
  assert.ok(PRIORITY.every(x=>manifest.includes(x)));
  assert.ok(BASE_ACTIVE.every(x=>manifest.includes(x)));
});
test('deployment is gated, noninteractive is scoped, and logged privately',()=>{
  const s=fs.readFileSync('scripts/recover_missing_paystack_staging.cjs','utf8');
  assert.match(s,/--deploy-first-batch/);
  assert.match(s,/DEPLOY-MISSING-STAGING/);
  assert.match(s,/MAX_BATCH=3/);
  assert.match(s,/functions:'\+n/);
  assert.match(s,/--only',only/);
  assert.match(s,/Number|NUMBER/);
  assert.match(s,/PROJECT='asiye-paystack-staging'/);
  assert.match(s,/BASE_ACTIVE\.some/);
  assert.match(s,/fs\.openSync\(logfile,'wx',0o600\)/);
  assert.doesNotMatch(s,/firebase deploy --only functions(?!:)/);
});
test('provisioned batch is recognized even if Firebase CLI exits nonzero',()=>{
  const before=inventory(BASE_ACTIVE.map(entry));
  const batch=plan(before);
  const after=inventory([...BASE_ACTIVE,...batch].map(entry));
  const result=reconcileBatch(batch,before,after,false);
  assert.equal(result.status,'ACTIVE_WITH_CLI_WARNING');
  assert.deepEqual(result.verified,batch);
  assert.deepEqual(result.remaining,[]);
  assert.deepEqual(result.lost,[]);
});
test('clean CLI exit and all ACTIVE functions produces COMPLETE',()=>{
  const before=inventory(BASE_ACTIVE.map(entry));
  const batch=plan(before);
  const after=inventory([...BASE_ACTIVE,...batch].map(entry));
  assert.equal(reconcileBatch(batch,before,after,true).status,'COMPLETE');
});
test('partial provisioning remains incomplete and never assumes full success',()=>{
  const before=inventory(BASE_ACTIVE.map(entry));
  const batch=plan(before);
  const after=inventory([...BASE_ACTIVE,batch[0]].map(entry));
  const result=reconcileBatch(batch,before,after,false);
  assert.equal(result.status,'INCOMPLETE');
  assert.deepEqual(result.remaining,batch.slice(1));
});
test('prior active function regression blocks completion regardless of CLI exit',()=>{
  const before=inventory(BASE_ACTIVE.map(entry));
  const batch=plan(before);
  const after=inventory([...BASE_ACTIVE.slice(1),...batch].map(entry));
  const result=reconcileBatch(batch,before,after,true);
  assert.equal(result.status,'INVESTIGATE_STATE_CHANGE');
  assert.deepEqual(result.lost,[BASE_ACTIVE[0]]);
});

test('single-endpoint staging recovery selects only continueGoAfterPayment',()=>{
  const currentlyActive=manifest.filter(n=>![
    'disburseCompletedCardTrips','continueGoAfterPayment','getClubPickupPin',
    'clubDriverActionSecure','synchronizeClubBooking','expireClubWaiting',
    'submitWorkEarlyDepartureOffer','refreshClubPaymentReadinessAfterSafetyShare',
    'createTripShareToken','getTripShare'].includes(n));
  const current=inventory(currentlyActive.map(entry));
  assert.equal(current.active.length,27);
  assert.deepEqual(selectBatch(current,'--deploy-one'),['continueGoAfterPayment']);
  assert.deepEqual(selectBatch(current,'--deploy-first-batch'),
    ['continueGoAfterPayment','getClubPickupPin','clubDriverActionSecure']);
  assert.deepEqual(selectBatch(current,'--plan'),
    ['continueGoAfterPayment','getClubPickupPin','clubDriverActionSecure']);
});
test('targeted deployment checks Cloud Functions agent binding and deploys one target',()=>{
  const source=fs.readFileSync('scripts/recover_missing_paystack_staging.cjs','utf8');
  assert.match(source,/function confirmFunctionServiceAgentBinding/);
  assert.match(source,/roles\/cloudfunctions\.serviceAgent/);
  assert.match(source,/gcf-admin-robot\.iam\.gserviceaccount\.com/);
  assert.match(source,/if\(batch\.includes\('continueGoAfterPayment'\)\)confirmFunctionServiceAgentBinding\(\)/);
  assert.match(source,/mode==='--deploy-one' \? candidates\.slice\(0,1\)/);
  assert.match(source,/const check=selectBatch\(now,flag\)/);
  assert.doesNotMatch(source,/add-iam-policy-binding|set-iam-policy|gcloud services enable/);
});
