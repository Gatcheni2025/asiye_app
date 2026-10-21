'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,reason}=require('../scripts/diagnose_paystack_operations.cjs');

test('Cloud Functions operations are summarized without exposing messages, resource IDs or secrets',()=>{
  const data=[{
    name:'projects/asiye-paystack-staging/locations/us-central1/operations/PRIVATE_OPERATION',
    done:true,
    metadata:{
      createTime:'2026-10-21T14:34:12Z',
      target:'projects/asiye-paystack-staging/locations/us-central1/functions/createClubBookingSecure',
      verb:'CREATE_FUNCTION',
      statusDetail:'private account testuser@example.invalid secret=DO_NOT_LEAK',
      stages:[{name:'BUILD',state:'FAILED'}]
    },
    error:{code:8,message:'RESOURCE_EXHAUSTED quota exceeded secret=DO_NOT_LEAK'}
  },{
    done:true,
    metadata:{createTime:'2026-10-21T14:34:13Z',
      target:'projects/asiye-80386/locations/us-central1/functions/goTripActionSecure',
      verb:'CREATE_FUNCTION'}
  },{
    done:true,
    metadata:{createTime:'2026-10-20T14:34:12Z',
      target:'projects/asiye-paystack-staging/locations/us-central1/functions/getTripShare',
      verb:'CREATE_FUNCTION'}
  }];
  const result=summarize(data);
  assert.equal(result.length,1);
  assert.equal(result[0].name,'createClubBookingSecure');
  assert.equal(result[0].reason,'QUOTA_OR_RATE_LIMIT');
  assert.equal(result[0].grpc,'8');
  assert.deepEqual(result[0].stages,['BUILD']);
  assert.doesNotMatch(JSON.stringify(result),/DO_NOT_LEAK|testuser|PRIVATE_OPERATION|asiye-80386/i);
});
test('Operations classifier handles common safe categories',()=>{
  assert.equal(reason('permission denied to set IAM policy'),'IAM_OR_ACCESS');
  assert.equal(reason('CLOUD_RUN startup revision not ready'),'CLOUD_RUN_STARTUP');
  assert.equal(reason(''),'UNCLASSIFIED');
});
test('Cloud Functions v2 operations query does not send incompatible legacy v1 filter',()=>{
  const fs=require('node:fs');
  const content=fs.readFileSync('scripts/diagnose_paystack_operations.cjs','utf8');
  assert.match(content,/cloudfunctions\.googleapis\.com\/v2\/projects\//);
  assert.match(content,/u\.searchParams\.set\('pageSize','100'\)/);
  assert.doesNotMatch(content,/u\.searchParams\.set\('filter'/);
  assert.match(content,/gcloud\(\['config','get-value','project'\]\)/);
  assert.match(content,/gcloud\(\['projects','describe',PROJECT/);
});
