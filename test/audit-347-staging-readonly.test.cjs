'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {canonical,hash,manifest,FILES,PROJECT,NUMBER,REGION}=require('../scripts/audit_347_staging_readonly.cjs');
test('read-only audit pins isolated staging identity',()=>{
  assert.equal(PROJECT,'asiye-paystack-staging');
  assert.equal(NUMBER,'1000800408896');
  assert.equal(REGION,'us-central1');
  assert.equal(manifest().length,42);
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
    'driver-v2/login.html','driver-v2/enrollment.html','driver-v2/js/login.js','driver-v2/js/firebase.js'])
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
test('public hosting audit rewrites reviewed source in memory and detects a stale native bridge',async()=>{
  const {auditHosted}=require('../scripts/audit_347_staging_readonly.cjs');
  const {rewrite,extractProductionWebConfig}=require('../scripts/build_staging_web_preview.cjs');
  const assets=path.resolve('assets');
  const prod=extractProductionWebConfig(path.join(assets,'passenger-v2/js/firebase.js'));
  const config={apiKey:'AIza'+'A'.repeat(26),authDomain:PROJECT+'.firebaseapp.com',
    databaseURL:'https://'+PROJECT+'-default-rtdb.firebaseio.com',projectId:PROJECT,
    storageBucket:PROJECT+'.firebasestorage.app',messagingSenderId:NUMBER,
    appId:'1:'+NUMBER+':web:abc123456789'};
  const originalFetch=global.fetch;
  let stale=false,calls=0;
  global.fetch=async(url,options)=>{
    assert.ok(url.startsWith('https://'+PROJECT+'.web.app/'));
    assert.equal(options.method,undefined,'Audit must only GET');
    calls++;
    const rel=new URL(url).pathname.slice(1);
    const source=fs.readFileSync(path.join(assets,rel),'utf8');
    const body=stale&&rel==='native-auth-session.js'?'old bridge':rewrite(source,prod,config);
    return new Response(body,{headers:{'x-robots-tag':'noindex, nofollow'}});
  };
  try{
    const good=await auditHosted(assets,config);
    assert.equal(good.matched,FILES.length);
    assert.deepEqual(good.fail,[]);
    stale=true;
    const bad=await auditHosted(assets,config);
    assert.equal(bad.matched,FILES.length-1);
    assert.deepEqual(bad.fail,['native-auth-session.js=CONTENT_MISMATCH']);
    assert.equal(calls,FILES.length*2);
  }finally{global.fetch=originalFetch;}
});
