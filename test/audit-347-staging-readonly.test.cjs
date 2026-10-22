'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {canonical,hash,manifest,FILES,PROJECT,NUMBER,REGION}=require('../scripts/audit_347_staging_readonly.cjs');
test('read-only audit pins isolated staging identity',()=>{
  assert.equal(PROJECT,'asiye-paystack-staging');
  assert.equal(NUMBER,'1000800408896');
  assert.equal(REGION,'us-central1');
  assert.equal(manifest().length,37);
});
test('canonical RTDB rule hashing is order-insensitive but detects changed rules',()=>{
  const x={rules:{users:{'.read':'auth !== null','.write':false},status:123}};
  const y={rules:{status:123,users:{'.write':false,'.read':'auth !== null'}}};
  assert.deepEqual(canonical(x),canonical(y));
  assert.equal(hash(x),hash(y));
  assert.notEqual(hash(x),hash({rules:{status:123,users:{'.read':true,'.write':false}}}));
});
test('staging hosted assets include login pages and client scripts for both roles',()=>{
  for(const file of ['passenger-v2/login.html','passenger-v2/js/login.js','passenger-v2/js/firebase.js',
    'driver-v2/login.html','driver-v2/js/login.js','driver-v2/js/firebase.js'])
    assert.ok(FILES.includes(file),file);
});
test('audit only uses read-only Firebase and Hosting calls',()=>{
  const s=fs.readFileSync('scripts/audit_347_staging_readonly.cjs','utf8');
  assert.match(s,/ensureProject\(\)/);
  assert.match(s,/auth','print-access-token/);
  assert.match(s,/\.settings\/rules\.json/);
  assert.match(s,/noindex/);
  assert.match(s,/NOT_ATTESTED/);
  assert.match(s,/PAYSTACK_LIVE: NOT_AUTHORIZED/);
  assert.doesNotMatch(s,/['"]POST['"]|['"]PUT['"]|['"]PATCH['"]|['"]DELETE['"]/);
  assert.doesNotMatch(s,/firebase deploy|functions deploy|projects add-iam-policy-binding/i);
});
