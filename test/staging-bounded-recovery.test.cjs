'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inventory,plan,PRIORITY,BASE_ACTIVE}=require('../scripts/recover_missing_paystack_staging.cjs');
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