'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {FUNCTIONS,FUNDING_OFF,SECRET_CONSUMERS,renderEntry}=require('../scripts/production_release_scope.cjs');
const {checkAuthorization,reviewedDigest,privateBucket,assertOff,stagedLive,neededFunctions,promote,main}=require('../scripts/deploy_production_release.cjs');
const hosting=require('../scripts/production_release_hosting.cjs');
const {PROJECT,NUMBER}=require('../scripts/production_card_preflight.cjs');
test('the promotion wrapper exposes the reviewed 44 endpoints and preserves unrelated deployed functions',()=>{
 const params={declaredParams:['PAYSTACK_SECRET_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER'].map(name=>({name}))};
 const original=Object.fromEntries([...FUNCTIONS,'unrelated'].map(name=>[name,()=>name]));
 const context={module:{exports:{}},require:name=>name==='./index.js'?original:params};
 vm.runInNewContext(renderEntry(),context);
 assert.deepEqual(Object.keys(context.module.exports),FUNCTIONS);
 assert.equal(Object.hasOwn(context.module.exports,'adminStagingTestConsole'),false);
 assert.equal(Object.hasOwn(context.module.exports,'unrelated'),false);
 assert.deepEqual(params.declaredParams.map(p=>p.name),['PAYSTACK_SECRET_KEY']);
 assert.equal(SECRET_CONSUMERS.length,9);
});
test('the runtime freeze rejects a different payload, target or checkout-enabled instruction',()=>{
 const record=require('../scripts/production_release_authorization.json'),digest=reviewedDigest();
 assert.doesNotThrow(()=>checkAuthorization(record,digest));
 for(const patch of [{runtimeSha256:'other'},{project:'asiye-paystack-staging'},{projectNumber:'other'},{checkoutMustRemainOff:false}])
  assert.throws(()=>checkAuthorization({...record,...patch},digest),/AUTHORIZATION_MISMATCH/);
});
test('only a project-owned uniform private bucket qualifies for source/config backups',()=>{
 const meta={projectNumber:NUMBER,iamConfiguration:{uniformBucketLevelAccess:{enabled:true}}};
 assert.equal(privateBucket(meta,{bindings:[{members:['serviceAccount:deployer@example.test']}]}),true);
 for(const member of ['allUsers','allAuthenticatedUsers'])assert.equal(privateBucket(meta,{bindings:[{members:[member]}]}),false);
 assert.equal(privateBucket({...meta,projectNumber:'other'},{bindings:[]}),false);
 assert.equal(privateBucket({...meta,iamConfiguration:{}},{bindings:[]}),false);
});
test('an enabled checkout gate or wrong project stops the promotion without writes',async()=>{
 const calls=[];
 await assert.rejects(assertOff(async(method,url)=>{calls.push({method,url});return{liveEnabled:true};}),/CHECKOUT_MUST_BE_OFF/);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
 let reads=0;await assert.rejects(main(['--apply'],{command:()=> 'asiye-paystack-staging',fetch:async()=>{reads++;}}),/PROJECT_IDENTITY_MISMATCH/);
 assert.equal(reads,0);
});
test('the staged LIVE version authenticates read-only and a changed version cannot continue deployment',async()=>{
 const secret='sk_live_TEST_PRIVATE_KEY',calls=[];
 const api=async(method,url)=>{assert.equal(method,'GET');assert.match(url,/projects\/asiye-80386\/secrets\/PAYSTACK_SECRET_KEY\/versions\/latest:access$/);
  return{name:'projects/'+NUMBER+'/secrets/PAYSTACK_SECRET_KEY/versions/2',payload:{data:Buffer.from(secret).toString('base64')}};};
 const http=async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+secret);
  return{ok:true,json:async()=>({status:true})};};
 assert.equal(await stagedLive(api,http),'2');
 await assert.rejects(stagedLive(api,http,'3'),/VERSION_UNAVAILABLE_OR_CHANGED/);assert.equal(calls.length,1);
});
test('source-matching endpoints are skipped on resume; only stale secret bindings are redeployed',()=>{
 const items=FUNCTIONS.map(name=>({name:'projects/'+PROJECT+'/locations/us-central1/functions/'+name}));
 const versions=Object.fromEntries(SECRET_CONSUMERS.map(name=>[name,'2']));
 assert.deepEqual(neededFunctions({matched:FUNCTIONS},items,'2',versions),[]);
 assert.deepEqual(neededFunctions({matched:FUNCTIONS},items,'2',{...versions,paystackWebhook:'1'}),['paystackWebhook']);
 assert.deepEqual(neededFunctions({matched:FUNCTIONS.filter(n=>n!=='goTripActionSecure')},items,'2',versions),['goTripActionSecure']);
});
test('funding stops first; all function source and LIVE bindings are verified before rules or Hosting',async()=>{
 const events=[];
 await promote({needed:FUNCTIONS,guard:async()=>events.push('guard'),deploy:async names=>events.push(names),audit:async()=>events.push('source'),
  verify:async()=>events.push('keys'),rules:async()=>events.push('rules'),web:async()=>events.push('web')});
 assert.deepEqual(events[1],FUNDING_OFF);
 for(const batch of events.filter(Array.isArray))assert.ok(batch.length<=8);
 assert.ok(events.indexOf('source')<events.indexOf('keys'));
 assert.ok(events.indexOf('keys')<events.indexOf('rules'));
 assert.ok(events.indexOf('rules')<events.indexOf('web'));
});
test('a failed source proof prevents rules and public web rollout',async()=>{
 const events=[];
 await assert.rejects(promote({needed:[],guard:async()=>{},deploy:async()=>assert.fail('Unexpected redeploy'),audit:async()=>{throw Error('source mismatch');},
  verify:async()=>events.push('keys'),rules:async()=>events.push('rules'),web:async()=>events.push('web')}),/source mismatch/);
 assert.deepEqual(events,[]);
});
test('only app resources are packaged; homepage, unrelated CSS, secrets and staging test UI are excluded',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-hosting-scope-'));
 try{
  for(const [p,value]of Object.entries({'index.html':'homepage','style.css':'website css','.env':'private','admin/testing.js':'test UI','driver-v2/js/app.js':'new driver','member-pages.js':'new history'})){
   const file=path.join(root,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);
  }
  const result=hosting.assetsForHosting(root);
  assert.deepEqual(Object.keys(result.files).sort(),['/driver-v2/js/app.js','/member-pages.js']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function hostingFixture({changed=false,foreignUpload=false}={}){
 const a='a'.repeat(64),b='b'.repeat(64),old='sites/'+PROJECT+'/versions/old',fresh='sites/'+PROJECT+'/versions/new';
 const previous={name:old,config:{headers:[{glob:'**',headers:{'Cache-Control':'max-age=0'}}],rewrites:[{glob:'**',path:'/index.html'}]},
  files:{'/index.html':a,'/privacy-policy.html':a,'/style.css':a,'/driver-v2/js/app.js':a,'/admin/testing.js':a}};
 const versions=new Map([[old,previous],[fresh,{name:fresh,files:{}}]]),calls=[];let current=old,releaseReads=0;
 const api=async(method,url,body)=>{
  calls.push({method,url,body});
  if(method==='GET'&&url.includes('/releases?')){releaseReads++;return{releases:[{version:{name:changed&&releaseReads>=2?'sites/'+PROJECT+'/versions/other':current}}]};}
  const version=url.includes('/versions/new')?fresh:old;
  if(method==='GET'&&url.includes('/files?'))return{files:Object.entries(versions.get(version).files).map(([path,hash])=>({path,hash}))};
  if(method==='GET')return versions.get(version);
  if(method==='POST'&&url.endsWith('/versions')){versions.get(fresh).config=body.config;return{name:fresh};}
  if(method==='POST'&&url.endsWith(':populateFiles')){versions.get(fresh).files=body.files;return{uploadRequiredHashes:[b],uploadUrl:foreignUpload?'https://attacker.example/upload':'https://upload-firebasehosting.googleapis.com/upload/'+fresh+'/files'};}
  if(method==='POST'&&url.startsWith('https://upload-firebasehosting.googleapis.com/'))return{};
  if(method==='PATCH')return{status:'FINALIZED'};
  if(method==='POST'&&url.includes('/releases?')){current=fresh;return{};}
  assert.fail('Unexpected Hosting request: '+method+' '+url);
 };
 return {api,previous,calls,assets:{files:{'/driver-v2/js/app.js':b},uploads:new Map([[b,Buffer.from('gzip')]])},reviewConfig:{headers:[{source:'/admin',headers:[{key:'Cache-Control',value:'private,no-store'}]}]},source:'reviewed',assertOff:async()=>{}};
}
test('Hosting promotion preserves merchant pages and unknown files and removes staging-only test UI',async()=>{
 const h=hostingFixture(),result=await hosting.promoteHosting(h);
 const population=h.calls.find(c=>c.url.endsWith(':populateFiles')).body.files;
 assert.equal(population['/index.html'],h.previous.files['/index.html']);
 assert.equal(population['/privacy-policy.html'],h.previous.files['/privacy-policy.html']);
 assert.equal(population['/style.css'],h.previous.files['/style.css']);
 assert.equal(Object.hasOwn(population,'/admin/testing.js'),false);
 assert.equal(result.preservedFiles,3);
 assert.ok(h.calls.find(c=>c.url.endsWith('/versions')).body.config.rewrites.some(r=>r.path==='/index.html'));
});
test('another Hosting release or a foreign upload URL stops publication',async()=>{
 for(const options of [{changed:true},{foreignUpload:true}]){
  const h=hostingFixture(options);await assert.rejects(hosting.promoteHosting(h),/HOSTING_RELEASE_CHANGED|HOSTING_UPLOAD_URL_INVALID/);
  assert.equal(h.calls.some(c=>c.method==='POST'&&c.url.includes('/releases?')),false);
  assert.equal(h.calls.some(c=>c.url.startsWith('https://attacker.example')),false);
 }
});
