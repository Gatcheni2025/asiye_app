'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {verifyHostingConfig,activeFunctions}=require('../scripts/deploy_paystack_staging_hosting_only.cjs');
const manifest=require('../scripts/paystack_function_manifest.json');
const site={hosting:{public:'staging-preview',ignore:['firebase.json','**/.*','**/node_modules/**'],
  headers:[{source:'**',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'}]}]}};
test('Hosting config must target isolated generated preview and disable indexing',()=>{
  assert.equal(verifyHostingConfig(site),true);
  assert.throws(()=>verifyHostingConfig({hosting:{...site.hosting,public:'assets'}}),/not staging-preview/);
  assert.throws(()=>verifyHostingConfig({hosting:{...site.hosting,site:'asiye-80386'}}),/Unexpected Hosting site/);
  assert.throws(()=>verifyHostingConfig({hosting:{...site.hosting,rewrites:[{source:'**',function:'paystackWebhook'}]}}),/rewrite/);
  assert.throws(()=>verifyHostingConfig({hosting:{public:'staging-preview'}}),/no-index/);
});
test('all 37 functions must be ACTIVE and filtered by region',()=>{
  const active=manifest.map(n=>({name:'projects/asiye-paystack-staging/locations/us-central1/functions/'+n,state:'ACTIVE'}));
  assert.equal(activeFunctions(active).length,37);
  const partial=active.slice(0,36);
  partial.push({name:'projects/asiye-paystack-staging/locations/europe-west1/functions/'+manifest[36],state:'ACTIVE'});
  assert.equal(activeFunctions(partial).length,36);
});
test('only Hosting may be deployed; production identifiers, API secrets and raw logs are excluded',()=>{
  const src=fs.readFileSync('scripts/deploy_paystack_staging_hosting_only.cjs','utf8');
  assert.match(src,/--only','hosting'/);
  assert.match(src,/firebase\.staging\.generated\.json/);
  assert.match(src,/DEPLOY-STAGING-HOSTING/);
  assert.match(src,/if\(before\.match\).*Skipping deployment/);
  assert.match(src,/active\.length!==37/);
  assert.match(src,/digest\(remote\)!==digest\(local\)/);
  assert.match(src,/noindex/);
  assert.match(src,/No resources changed/);
  assert.doesNotMatch(src,/--only','functions'|--only','database'|gcloud.*add-iam-policy-binding|--only','storage'/);
  assert.doesNotMatch(src,/PAYSTACK_SECRET_KEY|print-access-token/);
});
