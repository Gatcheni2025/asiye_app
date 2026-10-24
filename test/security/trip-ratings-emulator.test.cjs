'use strict';
const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const admin=require('../../functions/node_modules/firebase-admin');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,update,remove}=require('firebase/database');
const projectId='demo-asiye-trip-ratings',id='completed-trip-rating-001';let app,db,env,handlers,verify,fetchBefore;
before(async()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;assert.match(host||'',/^(localhost|127\.0\.0\.1):\d+$/);
 env=await initializeTestEnvironment({projectId,database:{rules:fs.readFileSync('../../database.rules.json','utf8')}});
 app=admin.initializeApp({projectId,databaseURL:`http://${host}?ns=${projectId}`});db=app.database();
 verify=admin.auth().verifyIdToken;admin.auth().verifyIdToken=async token=>({uid:token});
 fetchBefore=global.fetch;global.fetch=async()=>{throw Error('Ratings must not call a payment provider.');};
 handlers=require('../../functions/index');
});
after(async()=>{global.fetch=fetchBefore;admin.auth().verifyIdToken=verify;await app.delete();await env.cleanup();});
beforeEach(async()=>{
 await db.ref().set({commuters:{p:{authUid:'p-auth'},p2:{authUid:'p2-auth'}},taxis:{d:{authUid:'d-auth',totalTrips:1,totalEarnings:68}},
  requests:{[id]:{type:'ehailing',status:'completed',commuterId:'p',taxiId:'d',driverAuthUid:'d-auth',tripStartedAt:1,
   goContinuationVersion:2,paymentSettlementStatus:'settled',tripCompletion:JSON.stringify({version:1,phase:'completed'}),finalAmount:85}},
  tripPayments:{[id]:{p:{method:'cash',amount:85,status:'cash_collected'}}}});
});
const read=async path=>(await db.ref(path).once('value')).val();
const record=async()=>JSON.parse(await read('requests/'+id+'/tripRatings'));
async function call(uid='d-auth',body={}){
 const result={status:200},headers={'x-firebase-auth':'Bearer '+uid};
 const response={status(n){result.status=n;return this;},set(){return this;},json(body){result.body=body;return this;},send(){return this;}};
 await handlers.goTripActionSecure({method:'POST',headers,get:key=>headers[key.toLowerCase()]||'',body:{requestId:id,action:'ratePassenger',passengerId:'p',score:5,...body}},response);
 return result;
}
test('the exported endpoint saves a rating after locks clear; concurrent retries cannot duplicate or alter it',async()=>{
 const before=await read('/');
 const results=await Promise.all([call(),call()]);
 for(const result of results)assert.equal(result.status,200,JSON.stringify(result.body));
 const saved=await record();assert.equal(saved.driverToPassenger.p.score,5);assert.equal(saved.driverToPassenger.p.driverUid,'d-auth');
 assert.equal((await call()).status,200);assert.deepEqual(await record(),saved);
 assert.equal((await call('d-auth',{score:4})).status,409);
 const after=await read('/');delete after.requests[id].tripRatings;assert.deepEqual(after,before,'No payment, earnings, profile or booking lock changed');
});
test('wrong drivers, passenger callers, unfinished trips and invalid scores cannot rate',async()=>{
 for(const uid of ['p-auth','stranger'])assert.equal((await call(uid)).status,403);
 assert.equal((await call('d-auth',{passengerId:'p2'})).status,403);
 for(const score of [0,6,1.5,'5'])assert.equal((await call('d-auth',{score})).status,400);
 await db.ref('requests/'+id+'/status').set('in_transit');assert.equal((await call()).status,409);
 assert.equal(await read('requests/'+id+'/tripRatings'),null);
});
test('a driver cannot rate their own passenger account or inherit another driver assignment',async()=>{
 await db.ref('commuters/p/authUid').set('d-auth');assert.equal((await call()).status,403);
 await db.ref('commuters/p/authUid').set('p-auth');await db.ref('requests/'+id+'/driverAuthUid').set('historical-driver');
 assert.equal((await call()).status,403);
});
test('Club members are rated separately; absent and cancelled members cannot receive a rating',async()=>{
 await db.ref('requests/'+id).update({type:'club',clubSecurityVersion:2,passengers:{p:{status:'completed',authUid:'p-auth'},p2:{status:'completed',authUid:'p2-auth'},left:{status:'cancelled_by_commuter'}}});
 assert.equal((await call()).status,200);assert.equal((await call('d-auth',{passengerId:'p2',score:3})).status,200);
 assert.equal((await call('d-auth',{passengerId:'left'})).status,403);
 assert.equal((await call('d-auth',{passengerId:'absent'})).status,403);
 assert.deepEqual(Object.keys((await record()).driverToPassenger).sort(),['p','p2']);
});
test('clients cannot forge, replace or delete the server-owned rating scalar; unrelated permitted updates still work',async()=>{
 await call();
 for(const uid of ['d-auth','p-auth']){
  const client=env.authenticatedContext(uid).database();
  for(const value of [null,{version:1,driverToPassenger:{p:{score:1}}},JSON.stringify({version:1,driverToPassenger:{p:{score:1}}})])
   await assertFails(update(ref(client,'requests/'+id),{tripRatings:value}));
  await assertFails(remove(ref(client,'requests/'+id+'/tripRatings')));
  await assertSucceeds(update(ref(client,'requests/'+id),{ratingReceiptViewedAt:Date.now()}));
 }
});
