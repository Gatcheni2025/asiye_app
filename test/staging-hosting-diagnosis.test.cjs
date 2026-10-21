'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {classifySites,logCategories}=require('../scripts/diagnose_paystack_hosting.cjs');
test('detects missing default Hosting site and ignores user sites',()=>{
  const a=classifySites([{name:'projects/asiye-paystack-staging/sites/test-secondary',type:'USER_SITE'}]);
  assert.equal(a.defaultSite,null);
  assert.equal(a.sites.length,1);
});
test('finds correct default Hosting site, even when secondary sites exist',()=>{
  const a=classifySites([
    {name:'projects/asiye-paystack-staging/sites/test-secondary',type:'USER_SITE'},
    {name:'projects/asiye-paystack-staging/sites/asiye-paystack-staging',type:'DEFAULT_SITE'}
  ]);
  assert.equal(a.defaultSite.id,'asiye-paystack-staging');
});
test('private CLI log is classified without printing secrets or raw messages',()=>{
  const input='Error: HTTP Error: 404, Hosting site not found Authorization: Bearer PRIVATE_SECRET account=test@example.invalid';
  const result=logCategories(input);
  assert.ok(result.classes.some(x=>x[0]==='HOSTING_SITE_NOT_FOUND'));
  assert.ok(result.classes.some(x=>x[0]==='CLI_ERROR_MARKER'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SECRET|example\.invalid|Bearer/);
});
test('Hosting read-only diagnosis checks staging identity, no mutation commands',()=>{
  const src=fs.readFileSync('scripts/diagnose_paystack_hosting.cjs','utf8');
  assert.match(src,/PROJECT='asiye-paystack-staging'/);
  assert.match(src,/NUMBER='1000800408896'/);
  assert.match(src,/firebasehosting\.googleapis\.com\/v1beta1\/projects\//);
  assert.match(src,/firebasehosting\.googleapis\.com\/v1beta1\/sites\//);
  assert.match(src,/method:'GET'/);
  assert.doesNotMatch(src,/firebase deploy|add-iam-policy-binding|hosting:sites:create|method:'POST'/);
});
