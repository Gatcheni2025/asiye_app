'use strict';
// Exported handlers and real RTDB transactions/rules; only Auth is simulated.
const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const admin=require('../../functions/node_modules/firebase-admin');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {ref,update,remove}=require('firebase/database');
const projectId='demo-asiye-trip-end';let app,db,handlers,env,verify,fetchBefore;
const id='ride',uid='driver-auth',destination={latitude:-29.8,longitude:31};
before(async()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;assert.match(host||'',/^(localhost|127\.0\.0\.1):\d+$/);
 env=await initializeTestEnvironment({projectId,database:{rules:fs.readFileSync('../../database.rules.json','utf8')}});
 app=admin.initializeApp({projectId,databaseURL:`http://${host}?ns=${projectId}`});db=app.database();
 verify=admin.auth().verifyIdToken;admin.auth().verifyIdToken=async token=>({uid:token});
 fetchBefore=global.fetch;global.fetch=async()=>{throw Error('Early ending must not initialize a provider payment or refund.');};
 handlers=require('../../functions/index');
});
after(async()=>{global.fetch=fetchBefore;admin.auth().verifyIdToken=verify;await app.delete();await env.cleanup();});
const read=async p=>(await db.ref(p).once('value')).val();
beforeEach(async()=>{
 await db.ref().set({commuters:{p:{authUid:'p-auth',currentRequest:id},p2:{authUid:'p2-auth',currentRequest:id}},
  taxis:{d:{authUid:uid,userUid:uid,currentRequest:id,latitude:-29.9,longitude:31,lastSeen:Date.now()}}});
});
async function seed(method='card',club=false){
 const trip={requestId:id,type:club?'club':'ehailing',rideType:'go',commuterId:'p',taxiId:'d',driverAuthUid:uid,
  status:'in_transit',tripStartedAt:Date.now()-10000,pinVerifiedAt:Date.now()-10000,arrivedAt:1,
  destinationCoords:destination,agreedFare:100,finalAmount:100,paymentMethod:method,paymentsReady:true,
  negotiatedBookingFinalized:true,negotiationEnabled:!club,fareStatus:'agreed',goContinuationVersion:2,cashCollectionVersion:2};
 if(club){trip.clubSecurityVersion=2;delete trip.cashCollectionVersion;trip.driverAcceptedAt=1;
  trip.poolReady=true;trip.requiredPassengers=2;trip.workWaitExpiresAt=Date.now()-1000;
  trip.passengers={p:{authUid:'p-auth',price:50,paymentMethod:'cash',status:'in_transit',pinVerifiedAt:1,destinationLat:-29.8,destinationLng:31},
   p2:{authUid:'p2-auth',price:50,paymentMethod:'card',status:'in_transit',pinVerifiedAt:1,destinationLat:-29.8,destinationLng:31}};
 }
 await db.ref('requests/'+id).set(trip);
 await db.ref('goFareAgreements/'+id).set({driverId:'d',agreedFare:100,platformCommission:20,driverNetFare:80,commissionRate:.2,paymentMethod:method});
 await db.ref('tripPayments/'+id).set(club?{p:{method:'cash',amount:50,status:'cash_due'},p2:{method:'card',amount:50,status:'held'}}:
  {p:{method,amount:100,status:method==='cash'?'cash_due':'held',reference:'EXISTING_TEST_REFERENCE'}});
}
async function call(endpoint,actor,body){
 const result={status:200},headers={authorization:'Bearer '+actor};
 const res={status(n){result.status=n;return this;},set(){return this;},json(body){result.body=body;return this;},send(){return this;}};
 await handlers[endpoint]({method:'POST',headers,get:key=>headers[key.toLowerCase()]||'',body:{requestId:id,...body}},res);return result;
}
const action=(actor,name,body={})=>call('goTripActionSecure',actor,{action:name,...body});
async function request(){const r=await action(uid,'requestEarlyEnd',{warningConfirmed:true,cashCollected:true});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.endRequestId;}
const answer=(actor,endRequestId,accepted=true)=>action(actor,'respondEarlyEnd',{endRequestId,accepted});

for(const method of ['card','cash'])test(`${method} early completion needs both confirmations and credits/clears locks exactly once`,async()=>{
 await seed(method);const end=await request();
 let result=await call('settleTripPayment',uid,{endRequestId:end});assert.equal(result.status,409);
 assert.equal((await read('requests/'+id)).status,'in_transit');assert.equal(await read('taxis/d/totalTrips'),null);
 assert.equal((await answer('p-auth',end)).status,200);
 if(method==='cash')assert.equal((await action(uid,'collectCash',{cashCollected:true,endRequestId:end})).status,200);
 result=await call('settleTripPayment',uid,{endRequestId:end});assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(result.body.serverCompleted,true);
 const trip=await read('requests/'+id);assert.equal(trip.status,'completed');assert.equal(trip.tripCompletion.mode,'agreed_early_end');
 assert.equal(trip.dropoffArrivedAt,undefined);assert.equal(await read('taxis/d/currentRequest'),null);
 assert.equal(await read('commuters/p/currentRequest'),null);assert.equal(await read('taxis/d/totalTrips'),1);
 assert.equal(await read('taxis/d/commissionDebt'),method==='cash'?20:0);
 assert.equal((await call('settleTripPayment',uid,{endRequestId:end})).status,200);
 assert.equal(await read('taxis/d/totalTrips'),1);
});
test('decline, timeout and withdrawal leave the trip, payment and earnings active/unmodified',async()=>{
 for(const kind of ['decline','expire','withdraw']){
  await seed();const end=await request();
  if(kind==='decline')assert.equal((await answer('p-auth',end,false)).status,200);
  if(kind==='expire')await db.ref(`requests/${id}/tripEndSafety/expiresAt`).set(Date.now()-1);
  if(kind==='withdraw')assert.equal((await action(uid,'withdrawEarlyEnd',{endRequestId:end})).status,200);
  assert.equal((await call('settleTripPayment',uid,{endRequestId:end})).status,409);
  assert.equal(await read(`requests/${id}/status`),'in_transit');assert.equal(await read(`tripPayments/${id}/p/status`),'held');
  assert.equal(await read('taxis/d/totalTrips'),null);
 }
});
test('driver, strangers, stale confirmation IDs and pre-pickup requests cannot approve for the passenger',async()=>{
 await seed();const end=await request();
 for(const actor of [uid,'stranger'])assert.equal((await answer(actor,end)).status,403);
 assert.equal((await answer('p-auth','old-request')).status,409);
 await db.ref(`requests/${id}/status`).set('arrived');
 assert.equal((await action(uid,'requestEarlyEnd',{warningConfirmed:true})).status,409);
});
test('every Club/Work passenger must agree before any payment capture, earnings or completion',async()=>{
 await seed('cash',true);const end=await request();
 assert.equal((await answer('p-auth',end)).status,200);
 assert.equal((await call('settleTripPayment',uid,{endRequestId:end})).status,409);
 assert.equal(await read(`tripPayments/${id}/p2/status`),'held');
 assert.equal((await answer('p2-auth',end)).status,200);
 assert.equal((await call('settleTripPayment',uid,{endRequestId:end})).status,200);
 for(let i=0;i<2;i++){
  const result=await call('clubDriverActionSecure',uid,{action:'complete',endRequestId:end});
  assert.equal(result.status,200,JSON.stringify(result.body));
 }
 assert.equal(await read(`requests/${id}/status`),'completed');assert.equal(await read('taxis/d/totalEarnings'),80);
 assert.equal(await read('taxis/d/commissionDebt'),10);assert.equal(await read('commuters/p2/currentRequest'),null);
});
test('normal destination cash completion still works without an early-end request',async()=>{
 await seed('cash');await db.ref('taxis/d').update({...destination,lastSeen:Date.now()});
 assert.equal((await action(uid,'checkTripEnd')).body.requiresPassengerConfirmation,false);
 assert.equal((await action(uid,'collectCash',{cashCollected:true})).status,200);
 assert.equal((await call('settleTripPayment',uid,{})).status,200);
 assert.equal(await read(`requests/${id}/tripCompletion/mode`),'destination');
});
test('RTDB clients cannot forge, replace or delete consent/completion claims, or complete directly',async()=>{
 await seed();await request();
 for(const actor of [uid,'p-auth']){
  const dbClient=env.authenticatedContext(actor).database();
  for(const patch of [{tripEndSafety:{status:'approved'}},{tripEndSafety:null},{tripCompletion:{version:1,phase:'processing'}},
   {earlyDropoffConfirmedAt:Date.now()},{status:'completed'}])await assertFails(update(ref(dbClient,'requests/'+id),patch));
  await assertFails(remove(ref(dbClient,'requests/'+id)));
 }
});
