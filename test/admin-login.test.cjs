'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {create}=require('../assets/admin/auth.js');
const {makeEnrollmentConsole}=require('../functions/admin-enrollment-console');
const {reviewerClaims}=require('../scripts/grant_staging_driver_reviewer.cjs');
function client({project='asiye-paystack-staging',response={ok:true,uid:'reviewer'},reject=null}={}){
 const calls=[],passenger={uid:'passenger'},auth={currentUser:{uid:'reviewer'},setPersistence:async mode=>calls.push(['persistence',mode]),
  signInWithPopup:async provider=>{calls.push(['popup',provider]);return {user:auth.currentUser};}};
 class Provider{constructor(name){this.providerId=name||'google.com';this.scopes=[];}setCustomParameters(value){this.params=value;}addScope(value){this.scopes.push(value);}}
 const app={name:'asiye-admin',auth:()=>auth,functions:region=>({httpsCallable:name=>async data=>{
  calls.push([name,data,region]);if(reject)throw reject;return {data:response};
 }})};
 const firebase={apps:[{name:'[DEFAULT]',user:passenger}],initializeApp:(config,name)=>{calls.push(['initialize',name]);firebase.apps.push(app);return app;},
  auth:{Auth:{Persistence:{SESSION:'session'}},GoogleAuthProvider:Provider,OAuthProvider:Provider}};
 return {service:create(firebase,{projectId:project}),calls,passenger,firebase,auth};
}
test('admin Google/Apple login uses its own named Firebase app and session storage',async()=>{
 const h=client();await h.service.ready;
 assert.deepEqual(h.calls.slice(0,2),[['initialize','asiye-admin'],['persistence','session']]);
 for(const provider of ['google','apple'])await h.service.signIn(provider);
 const providers=h.calls.filter(x=>x[0]==='popup').map(x=>x[1]);
 assert.equal(providers[0].providerId,'google.com');assert.deepEqual(providers[0].params,{prompt:'select_account'});
 assert.equal(providers[1].providerId,'apple.com');assert.deepEqual(providers[1].scopes,['email','name']);
 assert.equal(h.firebase.apps[0].user.uid,'passenger');
});
test('staging role verification refreshes token, checks matching UID, and opens only enrollment scope',async()=>{
 const h=client();let refreshed=false;const user={uid:'reviewer',getIdToken:async force=>{refreshed=force;}};
 assert.equal(await h.service.authorize(user),'enrollments');assert.equal(refreshed,true);
 assert.ok(h.calls.some(x=>x[0]==='adminEnrollmentConsole'&&x[1].action==='session'&&x[2]==='us-central1'));
 const bad=client({response:{ok:true,uid:'another-user'}});
 await assert.rejects(()=>bad.service.authorize(user),/verified/);
});
test('a signed-in passenger is not given reviewer access and can retry without losing identity',async()=>{
 const h=client({reject:{code:'functions/permission-denied'}});
 await assert.rejects(()=>h.service.authorize({uid:'reviewer',getIdToken:async()=>{}}));
 assert.equal(h.auth.currentUser.uid,'reviewer');
 assert.match(h.service.errorMessage({code:'functions/permission-denied'}),/has not been assigned/);
});
test('existing production full-admin authorization keeps the original server gate',async()=>{
 const h=client({project:'asiye-80386'});
 assert.equal(await h.service.authorize({uid:'reviewer',getIdToken:async()=>{}}),'platform');
 assert.ok(h.calls.some(x=>x[0]==='adminWhoAmI'));
});
function backend(){
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const admin={database:()=>({ref:path=>({once:async()=>({exists:()=>false,val:()=>null}),orderByChild:key=>({limitToLast:limit=>({once:async()=>({val:()=>({driver:{status:'pending'}})})})})})})};
 const source=fs.readFileSync('functions/index.js','utf8');
 const guards=source.slice(source.indexOf('async function requireAsiyeAdmin('),source.indexOf('function safeAdminString('));
 const scope={admin,functions:{https:{HttpsError}}};vm.createContext(scope);vm.runInContext(guards,scope);
 const handler=makeEnrollmentConsole({admin,requireReviewer:scope.requireAsiyeEnrollmentReviewer,HttpsError});
 return {handler,scope};
}
test('actual server role gate denies signed-out/ordinary users and permits only protected enrollment reads',async()=>{
 const h=backend(),role={auth:{uid:'reviewer',token:{enrollmentReviewer:true}}};
 await assert.rejects(()=>h.handler({action:'session'},{}),e=>e.code==='unauthenticated');
 await assert.rejects(()=>h.handler({action:'session'},{auth:{uid:'passenger',token:{}}}),e=>e.code==='permission-denied');
 assert.equal((await h.handler({action:'session'},role)).scope,'enrollments');
 assert.equal((await h.handler({action:'list',resource:'driverEnrollments',limit:500},role)).data.driver.status,'pending');
 await assert.rejects(()=>h.handler({action:'list',resource:'walletPayments'},role),e=>e.code==='invalid-argument');
 await assert.rejects(()=>h.handler({action:'list',limit:1001},role),e=>e.code==='invalid-argument');
 await assert.rejects(()=>h.scope.requireAsiyeAdmin(role),e=>e.code==='permission-denied');
});
test('owner-only provisioning adds a reviewer claim, preserves current roles and rejects wrong or disabled accounts',()=>{
 const user={localId:'reviewer',email:'admin@example.test',emailVerified:true,customAttributes:JSON.stringify({example:'keep',admin:false})};
 assert.deepEqual(reviewerClaims(user,'admin@example.test'),{example:'keep',admin:false,enrollmentReviewer:true});
 for(const change of [{email:'other@example.test'},{emailVerified:false},{disabled:true},{localId:''}])
  assert.throws(()=>reviewerClaims({...user,...change},'admin@example.test'));
 const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules;
 assert.equal(rules.admins.$uid['.write'],false);
 for(const filename of ['assets/admin-login.html','assets/create-admin.html']){
  const html=fs.readFileSync(filename,'utf8');assert.match(html,/url=\/admin\//);assert.doesNotMatch(html,/signInWithEmailAndPassword|\.database\(/);
 }
});
test('admin UI contains social sign-in, access retry and Firebase popup CSP without client role grants',()=>{
 const html=fs.readFileSync('assets/admin/index.html','utf8'),source=fs.readFileSync('assets/admin/console.js','utf8');
 for(const id of ['adminGoogleLogin','adminAppleLogin','checkAdminAccess','switchAdminAccount'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/frame-src https:\/\/\*\.firebaseapp\.com/);assert.match(html,/https:\/\/apis.google.com/);
 assert.doesNotMatch(source,/firebase\.database\(|setCustomUserClaims/);
 assert.match(source,/accessScope==='enrollments'&&!\['enrollments','documents'\]\.includes\(next\)/);
 assert.match(source,/reviewDriverEnrollmentSecure/);
});

test('staging admin deployment selects exactly the two driver-review APIs',()=>{
 const {NAMES}=require('../scripts/deploy_staging_driver_admin.cjs');
 assert.deepEqual(NAMES,['adminEnrollmentConsole','reviewDriverEnrollmentSecure']);
 const {cleanupOnlyFailure}=require('../scripts/deploy_staging_auth_booking_flow.cjs');
 const stdout=NAMES.map(name=>'functions['+name+'(us-central1)] Successful create operation.').join('\n');
 assert.equal(cleanupOnlyFailure({status:1,stdout,stderr:'Error: Functions successfully deployed but could not set up cleanup policy in location us-central1.'},NAMES),true);
});
