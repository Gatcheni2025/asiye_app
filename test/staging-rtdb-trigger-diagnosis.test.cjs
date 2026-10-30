'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {reasons,summarizeOperation,validInstance}=require('../scripts/diagnose_staging_rtdb_trigger.cjs');

test('classifies event trigger IAM permission without exposing raw identities',()=>{
  const entry={
    done:true,
    error:{code:9,message:'Eventarc: Permission iam.serviceAccounts.actAs denied to private-person@example.invalid; token=PRIVATE_SECRET'},
    metadata:{statusDetail:'Cloud Events trigger failed'}
  };
  const summary=summarizeOperation(entry);
  assert.equal(summary.code,9);
  assert.ok(summary.category.includes('ACT_AS_PERMISSION'));
  assert.ok(summary.category.includes('EVENTARC_TRIGGER'));
  assert.ok(!JSON.stringify(summary).includes('private-person'));
  assert.ok(!JSON.stringify(summary).includes('PRIVATE_SECRET'));
});
test('classifies Realtime Database location mismatch separately',()=>{
  const got=reasons('Database instance does not exist in region us-central1');
  assert.ok(got.includes('RTDB_SOURCE_LOCATION'));
  assert.ok(got.includes('RTDB_SOURCE_MISSING'));
});
test('code 9 alone is not assumed to identify missing permissions',()=>{
  const out=summarizeOperation({done:true,error:{code:9,message:'Precondition failed'}});
  assert.equal(out.code,9);
  assert.deepEqual(out.category,['UNCLASSIFIED']);
});
test('request is read only and project guarded',()=>{
  const txt=fs.readFileSync('scripts/diagnose_staging_rtdb_trigger.cjs','utf8');
  assert.match(txt,/projectNumber/);
  assert.match(txt,/PROJECT='asiye-paystack-staging'/);
  assert.match(txt,/METHOD_NOT_ALLOWED|method:'GET'|method:\s*'GET'|const response=await fetch/);
  assert.doesNotMatch(txt,/(?:functions|database):deploy|gcloud services enable|set-iam-policy/);
});

test('validates only the isolated staging instance metadata and exact project number',()=>{
  const expected={name:'projects/1000800408896/locations/us-central1/instances/asiye-paystack-staging-default-rtdb',state:'ACTIVE'};
  assert.deepEqual(validInstance(expected),{location:'us-central1',state:'ACTIVE'});
  assert.equal(validInstance({...expected,name:'projects/123/locations/us-central1/instances/asiye-paystack-staging-default-rtdb'}),null);
  assert.equal(validInstance({...expected,name:'projects/1000800408896/locations/us-central1/instances/asiye-80386-default-rtdb'}),null);
});
test('operation diagnostics run before RTDB metadata and API error does not abort both',()=>{
  const source=fs.readFileSync('scripts/diagnose_staging_rtdb_trigger.cjs','utf8');
  const start=source.indexOf('async function main()');
  const ops=source.indexOf('await operationMetadata(token)',start);
  const db=source.indexOf('await databaseMetadata(token)',start);
  assert.ok(ops>start && db>ops,'operation inspection must be independent and first');
  assert.match(source,/if\(!response\.ok\)return \{ok:false,status:response\.status\}/);
  assert.match(source,/No database writes, IAM changes, or function deployments were attempted/);
  assert.doesNotMatch(source,/method:\s*'POST'|gcloud services enable|add-iam-policy-binding|gcloud functions deploy/);
});
