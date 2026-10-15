'use strict';

// Executes the exported Firebase handlers against isolated RTDB namespaces.
// Only identity verification and Paystack HTTP are simulated; no live account,
// charge, Firebase deployment or mobile build is used by this suite.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const admin=require('../../functions/node_modules/firebase-admin');
const projectId='demo-asiye-payment-handlers';
const secret='sk_test_EMULATOR_ONLY_NO_NETWORK';
const account='ACCT_emulatordriver';
const pickup={latitude:-29.85,longitude:30.95,address:'Pickup'};
const destination={latitude:-29.80,longitude:30.99,address:'Destination'};
let db,app,handlers,originalFetch,originalVerify,originalSecret;
let initializations,verifications,transactions,onInitialize,verificationPatch;

before(()=>{
  const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  assert.match(host||'',/^(127\.0\.0\.1|localhost):\d+$/,'Local database emulator required');
  app=admin.initializeApp({projectId,databaseURL:`http://${host}?ns=${projectId}`});
  db=app.database();
  originalVerify=admin.auth().verifyIdToken;
  admin.auth().verifyIdToken=async token=>({uid:token});
  originalFetch=global.fetch;
  originalSecret=process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY=secret;
  global.fetch=async(url,options={})=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://api.paystack.co','Unexpected external request');
    assert.equal(options.headers.Authorization,'Bearer '+secret);
    let data;
    if(parsed.pathname.startsWith('/subaccount/')){
      data={subaccount_code:account,percentage_charge:20,is_verified:true,active:true,
        account_number:'1234567890',domain:'test'};
    }else if(parsed.pathname==='/transaction/initialize'){
      const body=JSON.parse(options.body);
      initializations.push(body);
      assert.equal(body.subaccount,account);
      assert.equal(body.bearer,'account');
      assert.deepEqual(body.channels,['card']);
      transactions.set(body.reference,{id:initializations.length,reference:body.reference,
        status:'success',currency:'ZAR',amount:Number(body.amount),channel:'card',
        subaccount:{subaccount_code:account,percentage_charge:20}});
      if(onInitialize)await onInitialize(body);
      data={reference:body.reference,authorization_url:'https://checkout.paystack.com/emulator',access_code:'test'};
    }else if(parsed.pathname.startsWith('/transaction/verify/')){
      const reference=decodeURIComponent(parsed.pathname.split('/').pop());
      verifications.push(reference);
      data={...transactions.get(reference),...verificationPatch};
    }else{
      throw Error('Unexpected Paystack operation: '+parsed.pathname);
    }
    return {ok:true,status:200,json:async()=>({status:true,data})};
  };
  handlers=require('../../functions/index');
});

beforeEach(async()=>{
  initializations=[];verifications=[];transactions=new Map();onInitialize=null;verificationPatch={};
  const driver={authUid:'driver-auth',userUid:'driver-auth',name:'Driver',verificationStatus:'verified',
    vehicleApproved:true,vehicleType:'go',vehicleReg:'ND12345',vehicleMake:'Toyota',vehicleModel:'Corolla',
    vehicleColor:'White',vehicleYear:2025,vehicleSeats:4,vehiclePhoto:'https://example.test/car.jpg',
    profileImageUrl:'https://example.test/driver.jpg',phone:'0711234567',isOnline:true,
    isBroadcasting:true,latitude:pickup.latitude,longitude:pickup.longitude,lastSeen:Date.now()};
  await db.ref().set({
    commuters:{sender:{authUid:'sender-auth',name:'Sender',email:'sender@example.test'},
      member:{authUid:'member-auth',name:'Member',email:'member@example.test'}},
    taxis:{driver,otherDriver:{...driver,authUid:'other-driver-auth',userUid:'other-driver-auth'}},
    driverPaystackSubaccounts:{driver:{status:'verified',subaccountCode:account,
      platformCommissionPercent:20,accountLast4:'7890'},otherDriver:{status:'verified',
      subaccountCode:account,platformCommissionPercent:20,accountLast4:'7890'}}
  });
});

after(async()=>{
  global.fetch=originalFetch;
  admin.auth().verifyIdToken=originalVerify;
  if(originalSecret===undefined)delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY=originalSecret;
  await app.delete();
});

async function call(name,uid,body={},extra={}){
  const headers={...(uid?{authorization:'Bearer '+uid}:{}),...extra.headers};
  const result={status:200,headers:{}};
  const response={status(n){result.status=n;return this;},
    set(k,v){result.headers[k]=v;return this;},
    json(value){result.body=value;return this;},send(value){result.body=value;return this;}};
  await handlers[name]({method:'POST',body,headers,get:key=>headers[key.toLowerCase()]||'',...extra},response);
  return result;
}
const read=async path=>(await db.ref(path).once('value')).val();
async function parcel(method='cash'){
  const result=await call('createParcelRequestSecure','sender-auth',{
    pickup,destination,routeDistanceKm:9,routeDurationMinutes:17,paymentMethod:method,
    recipientName:'Recipient',recipientPhone:'0711234567',parcelDescription:'Documents',
    finalAmount:1,pickupPin:'0000',taxiId:'forged-driver'
  });
  assert.equal(result.status,200,JSON.stringify(result.body));
  return result.body;
}
async function accept(id,driver='driver',uid='driver-auth'){
  const result=await call('acceptParcelRequestSecure',uid,{requestId:id,driverId:driver});
  if(result.status!==200)console.log('Acceptance result:',result.body);
  return result;
}
const action=(id,name,pin)=>call('parcelTripActionSecure','driver-auth',{requestId:id,action:name,pin});
async function webhook(reference,valid=true){
  const body={event:'charge.success',data:{reference,amount:1,status:'success'}};
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature=crypto.createHmac('sha512',secret).update(rawBody).digest('hex');
  return call('paystackWebhook',null,body,{rawBody,headers:{'x-paystack-signature':valid?signature:'forged'}});
}
async function paidParcel(){
  const result=await parcel('card');
  assert.equal((await accept(result.requestId)).status,200);
  const checkout=await call('prepareTripPayment','sender-auth',{requestId:result.requestId});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  assert.equal((await webhook(checkout.body.reference)).status,200);
  return {...result,reference:checkout.body.reference};
}
async function pickupParcel(result){
  assert.equal((await action(result.requestId,'onWay')).status,200);
  assert.equal((await action(result.requestId,'arrive')).status,200);
  const verified=await action(result.requestId,'verifyPin',result.pickupPin);
  assert.equal(verified.status,200,JSON.stringify(verified.body));
  assert.equal(verified.body.pinValid,true);
}

test('Parcel creation, private PIN access and duplicate booking use real handlers',async()=>{
  assert.equal((await call('createParcelRequestSecure',null)).status,401);
  const result=await parcel();
  const id=result.requestId,trip=await read('requests/'+id);
  assert.equal(trip.parcelSecurityVersion,2);
  assert.equal(trip.pickupPin,undefined);
  assert.equal(trip.taxiId,undefined);
  assert.ok(trip.finalAmount>1);
  assert.equal(await read('commuters/sender/currentRequest'),id);
  assert.equal((await read(`tripPayments/${id}/sender`)).status,'cash_due');
  assert.equal((await read(`delivery_requests/${id}`)).status,'pending');
  for(const uid of [null,'driver-auth','member-auth'])
    assert.ok([401,403].includes((await call('getParcelPickupPinSecure',uid,{requestId:id})).status));
  const pin=await call('getParcelPickupPinSecure','sender-auth',{requestId:id});
  assert.equal(pin.body.pickupPin,result.pickupPin);
  assert.match(pin.headers['Cache-Control'],/no-store/);
  const duplicate=await call('createParcelRequestSecure','sender-auth',{
    pickup,destination,routeDistanceKm:9,routeDurationMinutes:17,
    recipientName:'R',recipientPhone:'0711234567',parcelDescription:'Documents'});
  assert.equal(duplicate.status,409);
  assert.equal(Object.keys(await read('requests')).length,1);
});

test('concurrent driver acceptance reserves exactly one eligible driver',async()=>{
  const {requestId}=await parcel();
  const results=await Promise.all([accept(requestId),accept(requestId,'otherDriver','other-driver-auth')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=(await read('requests/'+requestId)).taxiId;
  assert.equal(await read(`taxis/${winner}/currentRequest`),requestId);
  assert.equal(await read(`taxis/${winner==='driver'?'otherDriver':'driver'}/currentRequest`),null);
});

test('five concurrent wrong PIN attempts lock pickup and reject the correct PIN afterwards',async()=>{
  const result=await parcel();
  assert.equal((await accept(result.requestId)).status,200);
  assert.equal((await action(result.requestId,'onWay')).status,200);
  assert.equal((await action(result.requestId,'arrive')).status,200);
  const wrong=result.pickupPin==='1111'?'2222':'1111';
  const results=await Promise.all(Array.from({length:5},()=>action(result.requestId,'verifyPin',wrong)));
  assert.ok(results.every(r=>r.status===200&&r.body.pinValid===false));
  assert.equal((await read('requests/'+result.requestId)).pinAttempts,5);
  assert.equal((await action(result.requestId,'verifyPin',result.pickupPin)).status,429);
  assert.equal((await read('requests/'+result.requestId)).status,'arrived');
});

for(const method of ['cash','card'])test(`${method} Parcel handlers enforce GPS/PIN and complete/credit/clean up once`,async()=>{
  const result=method==='card'?await paidParcel():await parcel();
  const id=result.requestId;
  if(method==='cash')assert.equal((await accept(id)).status,200);
  assert.equal((await action(id,'complete')).status,409);
  assert.equal((await action(id,'onWay')).status,200);
  assert.equal((await call('parcelTripActionSecure','other-driver-auth',{requestId:id,action:'arrive'})).status,403);
  for(const lastSeen of [Date.now()-180000,Date.now()+180000]){
    await db.ref('taxis/driver/lastSeen').set(lastSeen);
    assert.equal((await action(id,'arrive')).status,403);
  }
  await db.ref('taxis/driver').update({...destination,lastSeen:Date.now()});
  assert.equal((await action(id,'arrive')).status,403);
  await db.ref('taxis/driver').update({...pickup,lastSeen:Date.now()});
  assert.equal((await action(id,'arrive')).status,200);
  assert.equal((await action(id,'verifyPin',result.pickupPin)).body.pinValid,true);
  assert.equal((await call('settleTripPayment','driver-auth',{requestId:id})).body.settled,true);
  assert.equal((await action(id,'complete')).status,403);
  await db.ref('taxis/driver').update({...destination,lastSeen:Date.now()});
  assert.equal((await action(id,'complete')).status,200);
  const driver=await read('taxis/driver');
  assert.equal(driver.totalTrips,1);
  assert.equal(JSON.parse(driver.parcelTripCredits)[id],true);
  assert.equal(driver.currentRequest,undefined);
  assert.equal(await read('commuters/sender/currentRequest'),null);
  assert.equal((await read('delivery_requests/'+id)).status,'completed');
  // A delayed retry must not clear a newer active booking or pay twice.
  await db.ref('taxis/driver/currentRequest').set('new-booking');
  await db.ref('commuters/sender/currentRequest').set('new-booking');
  assert.equal((await action(id,'complete')).status,200);
  assert.equal((await read('taxis/driver')).totalTrips,1);
  assert.equal((await read('taxis/driver')).totalEarnings,driver.totalEarnings);
  assert.equal(await read('taxis/driver/currentRequest'),'new-booking');
  assert.equal(await read('commuters/sender/currentRequest'),'new-booking');
  if(method==='card'){
    assert.equal((await webhook(result.reference)).status,200);
    assert.equal((await read(`tripPayments/${id}/sender`)).status,'captured');
    assert.equal((await read('requests/'+id)).status,'completed');
    assert.equal(initializations.length,1);
  }
});

test('legacy actions cannot cancel or refund secure Parcel, and checkout initializes once under concurrency',async()=>{
  const {requestId}=await parcel('card');
  assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,409);
  assert.equal(initializations.length,0);
  assert.equal((await accept(requestId)).status,200);
  const results=await Promise.all(Array.from({length:2},()=>call('prepareTripPayment','sender-auth',{requestId})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const success=results.find(r=>r.status===200);
  const again=await call('prepareTripPayment','sender-auth',{requestId});
  assert.equal(again.body.reference,success.body.reference);
  assert.equal(initializations.length,1);
  assert.equal((await call('goTripActionSecure','sender-auth',{requestId,action:'cancel'})).status,409);
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).status,409);
  assert.equal((await call('cancelParcelBookingSecure','sender-auth',{requestId})).status,409);
  assert.equal((await read('requests/'+requestId)).status,'payment_required');
});

test('provider failures keep one durable reference and a late verified callback can recover it',async()=>{
  const {requestId}=await parcel('card');
  await accept(requestId);
  onInitialize=async()=>{throw TypeError('Simulated lost provider response');};
  assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,500);
  const payment=await read(`tripPayments/${requestId}/sender`);
  assert.equal(payment.status,'initialization_unknown');
  assert.equal((await read('tripPaymentReferences/'+payment.reference)).requestId,requestId);
  assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,409);
  assert.equal(initializations.length,1);
  assert.equal((await webhook(payment.reference)).status,200);
  assert.equal((await read('requests/'+requestId)).status,'accepted');
});

test('signed webhook re-verifies provider amount, currency, split and failures before fulfillment',async()=>{
  const {requestId}=await parcel('card');await accept(requestId);
  const checkout=await call('prepareTripPayment','sender-auth',{requestId});
  const reference=checkout.body.reference;
  const browserReturn=await call('paystackPaymentReturn',null,{},
    {method:'GET',query:{reference}});
  assert.equal(browserReturn.status,200);
  assert.match(browserReturn.body,/asiye:\/\/payment-complete/);
  assert.doesNotMatch(browserReturn.body,/updating your wallet/i);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'initialized');
  assert.equal((await webhook(reference,false)).status,401);
  assert.equal(verifications.length,0);
  for(const patch of [{amount:1},{currency:'USD'},{status:'failed'},
    {subaccount:{subaccount_code:'ACCT_wrong',percentage_charge:20}}]){
    verificationPatch=patch;
    assert.equal((await webhook(reference)).status,500);
    assert.equal((await read('requests/'+requestId)).paymentsReady,false);
    assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'initialized');
  }
  verificationPatch={};
  const duplicates=await Promise.all([webhook(reference),webhook(reference)]);
  assert.ok(duplicates.every(r=>r.status===200));
  assert.equal((await read('requests/'+requestId)).status,'accepted');
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'held');
});

test('cancellation during slow checkout stays cancelled; duplicate charge cannot reverse a refund',{timeout:15000},async()=>{
  const {requestId}=await parcel('card');await accept(requestId);
  let entered,release;
  const initialized=new Promise(resolve=>{entered=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  onInitialize=async()=>{entered();await held;};
  const checkout=call('prepareTripPayment','sender-auth',{requestId});
  await initialized;
  await db.ref('requests/'+requestId).update({status:'cancelled_by_admin'});
  release();
  assert.equal((await checkout).status,500);
  const {reference}=await read(`tripPayments/${requestId}/sender`);
  assert.equal((await webhook(reference)).status,200);
  assert.equal((await read('requests/'+requestId)).status,'cancelled_by_admin');
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refund_review');
  assert.equal((await read('taxis/driver')).totalTrips,undefined);
  await db.ref(`tripPayments/${requestId}/sender/status`).set('refunded');
  assert.equal((await webhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  const verified=await call('verifyTripCardPayment','sender-auth',{requestId,reference});
  assert.equal(verified.body.ready,false);
  assert.equal(verified.body.status,'refunded');
});

test('Go permits 65% offers, rejects lower fares and lets an eligible driver counter before passenger agreement',async()=>{
  const requestId='go-offer65-handler';
  await db.ref('requests/'+requestId).set({
    requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',
    routeDistanceKm:10,routeDurationMinutes:0,commuterLocation:pickup,destinationCoords:destination
  });
  await db.ref('commuters/sender/currentRequest').set(requestId);
  assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:64})).status,422);
  const offered=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(offered.status,200,JSON.stringify(offered.body));
  assert.equal((await read('requests/'+requestId)).minimumFareOffer,65);
  assert.equal((await read('requests/'+requestId)).driverNetFare,52);
  assert.equal((await read('requests/'+requestId)).platformCommission,13);
  await db.ref(`notifications/taxis/driver/${requestId}`).set({requestId,status:'pending'});
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:96})).status,422);
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:64})).status,422);
  const counter=await call('counterGoFare','driver-auth',{requestId,amount:80});
  assert.equal(counter.status,200,JSON.stringify(counter.body));
  assert.equal((await call('acceptGoFareCounter','member-auth',{requestId})).status,403);
  const accepted=await call('acceptGoFareCounter','sender-auth',{requestId});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal(accepted.body.agreedFare,80);
  assert.equal(accepted.body.driverNetFare,64);
  assert.equal(accepted.body.platformCommission,16);
  assert.equal((await read('requests/'+requestId)).taxiId,'driver');
  assert.equal(initializations.length,0,'Negotiation must not charge a card');
});

test('Go agreed fare passes the same checkout and signed provider verification handlers',async()=>{
  const requestId='go-handler-reference-01';
  await db.ref('commuters/sender/email').remove();
  await db.ref('requests/'+requestId).set({
    requestId,type:'ehailing',rideType:'go',commuterId:'sender',taxiId:'driver',
    status:'payment_required',paymentMethod:'card',agreedFare:100,finalAmount:100,
    negotiationEnabled:true,fareStatus:'agreed',goContinuationRequestedVersion:2,
    commissionRate:0.2,commuterLocation:pickup,destinationCoords:destination
  });
  await db.ref('goFareAgreements/'+requestId).set({
    driverId:'driver',agreedFare:100,paymentMethod:'card',commissionRate:0.2,currency:'ZAR'
  });
  await db.ref('taxis/driver/currentRequest').set(requestId);
  const checkout=await call('prepareTripPayment','sender-auth',{requestId});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  assert.equal(initializations[0].amount,'10000');
  assert.match(initializations[0].email,/^[^\s@]+@asiye\.cloud$/);
  assert.equal((await webhook(checkout.body.reference)).status,200);
  assert.equal((await read('requests/'+requestId)).status,'accepted');
  const verified=await call('verifyTripCardPayment','sender-auth',{requestId,reference:checkout.body.reference});
  assert.equal(verified.body.ready,true);
  assert.equal(initializations.length,1);
});

test('Work charges each member separately after driver acceptance through the same subaccount',async()=>{
  const requestId='work-handler-reference-01';
  await db.ref('requests/'+requestId).set({
    requestId,type:'club',clubMode:'club4',clubSecurityVersion:2,commuterId:'sender',taxiId:'driver',
    status:'driver_waiting',paymentMethod:'card',poolReady:true,driverAcceptedAt:Date.now(),
    pricePerPassenger:60,passengers:{sender:{price:60,paymentMethod:'card',status:'waiting'},
      member:{price:40,paymentMethod:'card',status:'waiting'}}
  });
  const results=await Promise.all(['sender-auth','member-auth'].map(uid=>
    call('prepareTripPayment',uid,{requestId})));
  assert.ok(results.every(r=>r.status===200),JSON.stringify(results));
  assert.equal(new Set(results.map(r=>r.body.reference)).size,2);
  assert.deepEqual(initializations.map(r=>Number(r.amount)).sort((a,b)=>a-b),[4000,6000]);
  assert.ok(initializations.every(r=>r.subaccount===account));
  assert.equal((await webhook(results[0].body.reference)).status,200);
  assert.equal((await read('requests/'+requestId)).paymentsReady,false);
  assert.equal((await webhook(results[1].body.reference)).status,200);
  assert.equal((await read('requests/'+requestId)).paymentsReady,true);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'held');
  assert.equal((await read(`tripPayments/${requestId}/member`)).status,'held');
});

test('cancellation retries repair interrupted cleanup and preserve newer locks',async()=>{
  const {requestId}=await parcel();await accept(requestId);
  await db.ref('requests/'+requestId).update({status:'cancelled_by_commuter',cancelledAt:1});
  const retry=await call('cancelParcelBookingSecure','sender-auth',{requestId});
  assert.equal(retry.status,200);
  assert.equal(await read('commuters/sender/currentRequest'),null);
  assert.equal(await read('taxis/driver/currentRequest'),null);
  await db.ref('commuters/sender/currentRequest').set('new-booking');
  await db.ref('taxis/driver/currentRequest').set('new-booking');
  assert.equal((await call('cancelParcelBookingSecure','sender-auth',{requestId})).status,200);
  assert.equal(await read('commuters/sender/currentRequest'),'new-booking');
  assert.equal(await read('taxis/driver/currentRequest'),'new-booking');
});
