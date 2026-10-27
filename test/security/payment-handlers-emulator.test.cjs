'use strict';

// Executes the exported Firebase handlers against isolated RTDB namespaces.
// Only identity verification and Paystack HTTP are simulated; no live account,
// charge, Firebase deployment or mobile build is used by this suite.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const admin=require('../../functions/node_modules/firebase-admin');
const projectId='demo-asiye-payment-handlers';
const secret='sk_test_EMULATOR_ONLY_NO_NETWORK';
const account='ACCT_emulatordriver';
const pickup={latitude:-29.85,longitude:30.95,address:'Pickup'};
const destination={latitude:-29.80,longitude:30.99,address:'Destination'};
let db,app,handlers,originalFetch,originalVerify,originalSecret;
let initializations,verifications,transactions,onInitialize,verificationPatch;
let refunds,onRefund,refundPatch,subaccountPatch;

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
    assert.equal(options.headers.Authorization,'Bearer '+process.env.PAYSTACK_SECRET_KEY);
    let data;
    if(parsed.pathname.startsWith('/subaccount/')){
      data={subaccount_code:account,percentage_charge:20,is_verified:true,active:true,
        account_number:'1234567890',domain:'test',...subaccountPatch};
    }else if(parsed.pathname==='/transaction/initialize'){
      const body=JSON.parse(options.body);
      initializations.push(body);
      assert.equal(body.subaccount,account);
      assert.equal(body.bearer,'account');
      assert.deepEqual(body.channels,['card']);
      transactions.set(body.reference,{id:initializations.length,reference:body.reference,
        status:'success',domain:'test',currency:'ZAR',amount:Number(body.amount),channel:'card',
        subaccount:{subaccount_code:account,percentage_charge:20}});
      if(onInitialize)await onInitialize(body);
      data={reference:body.reference,authorization_url:'https://checkout.paystack.com/emulator',access_code:'test'};
    }else if(parsed.pathname.startsWith('/transaction/verify/')){
      const reference=decodeURIComponent(parsed.pathname.split('/').pop());
      verifications.push(reference);
      data={...transactions.get(reference),...verificationPatch};
    }else if(parsed.pathname==='/refund'&&options.method==='POST'){
      const body=JSON.parse(options.body);
      const transaction=[...transactions.values()].find(t=>String(t.id)===String(body.transaction)||t.reference===body.transaction);
      assert.ok(transaction,'Refund must identify an actual verified transaction');
      data={id:1000+refunds.length,transaction:{id:transaction.id,reference:transaction.reference},
        amount:body.amount,currency:'ZAR',domain:'test',status:'pending'};
      refunds.push(data);
      if(onRefund)await onRefund(data);
    }else if(parsed.pathname.startsWith('/refund/')){
      data={...refunds.find(r=>String(r.id)===parsed.pathname.split('/').pop()),...refundPatch};
    }else if(parsed.pathname==='/refund'){
      data=refunds.filter(r=>String(r.transaction.id)===parsed.searchParams.get('transaction')).map(r=>({...r,...refundPatch}));
    }else{
      throw Error('Unexpected Paystack operation: '+parsed.pathname);
    }
    return {ok:true,status:200,json:async()=>({status:true,data})};
  };
  handlers=require('../../functions/index');
});

beforeEach(async()=>{
  initializations=[];verifications=[];transactions=new Map();onInitialize=null;verificationPatch={};
  refunds=[];onRefund=null;refundPatch={};subaccountPatch={};process.env.PAYSTACK_SECRET_KEY=secret;
  const driver={authUid:'driver-auth',userUid:'driver-auth',name:'Driver',verificationStatus:'verified',
    vehicleApproved:true,vehicleType:'go',vehicleReg:'ND12345',vehicleMake:'Toyota',vehicleModel:'Corolla',
    vehicleColor:'White',vehicleYear:2025,vehicleSeats:4,vehiclePhoto:'https://example.test/car.jpg',
    profileImageUrl:'https://example.test/driver.jpg',phone:'0711234567',isOnline:true,
    isBroadcasting:true,latitude:pickup.latitude,longitude:pickup.longitude,lastSeen:Date.now()};
  await db.ref().set({
    commuters:{sender:{authUid:'sender-auth',bookingFaceAuthUid:'sender-auth',bookingFaceSavedAt:1,profileImageUrl:'https://example.test/face.jpg',name:'Sender',email:'sender@example.test'},
      member:{authUid:'member-auth',bookingFaceAuthUid:'member-auth',bookingFaceSavedAt:1,profileImageUrl:'https://example.test/face.jpg',name:'Member',email:'member@example.test'}},
    taxis:{driver,otherDriver:{...driver,authUid:'other-driver-auth',userUid:'other-driver-auth'}},
    driverPaystackSubaccounts:{driver:{ownerUid:'driver-auth',paystackDomain:'test',status:'verified',subaccountCode:account,
      platformCommissionPercent:20,accountLast4:'7890'},otherDriver:{ownerUid:'other-driver-auth',paystackDomain:'test',status:'verified',
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

test('Go forwards low offers and leaves the driver in control before passenger agreement',async()=>{
  const requestId='go-offer65-handler';
  await db.ref('requests/'+requestId).set({
    requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',
    routeDistanceKm:10,routeDurationMinutes:0,commuterLocation:pickup,destinationCoords:destination
  });
  await db.ref('commuters/sender/currentRequest').set(requestId);
  for(const amount of [0,1,40,64,-1,'not-a-fare',96]) assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount})).status,422);
  const offered=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(offered.status,200,JSON.stringify(offered.body));
  const pending=await read('requests/'+requestId);
  assert.equal(pending.minimumFareOffer,65);
  assert.equal(pending.recommendedMinimumFare,65);
  assert.equal(pending.driverNetFare,52);
  assert.equal(pending.platformCommission,13);
  assert.equal(pending.fareStatus,'passenger_offer');
  assert.equal(pending.lastGoFareDecision,undefined);
  await db.ref(`notifications/taxis/driver/${requestId}`).set({requestId,status:'pending'});
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:96})).status,422);
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:64})).status,422);
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:80,passengerOffer:70})).status,409);
  await db.ref('requests/'+requestId+'/driverCounterCount').set(2);
  const counter=await call('counterGoFare','driver-auth',{requestId,amount:80});
  assert.equal(counter.status,200,JSON.stringify(counter.body));
  assert.equal((await read('requests/'+requestId)).counterExpiresAt,undefined);
  assert.equal((await read('requests/'+requestId)).driverCounterCount,3,'The driver may make another counter after two rounds');
  assert.equal((await call('acceptGoFareCounter','member-auth',{requestId})).status,403);
  assert.equal((await call('acceptGoFareCounter','sender-auth',{requestId,amount:75})).status,409);
  assert.equal((await read('requests/'+requestId)).taxiId,undefined);
  await db.ref('requests/'+requestId+'/counterExpiresAt').set(Date.now()-120000);
  const accepted=await call('acceptGoFareCounter','sender-auth',{requestId,amount:80,negotiationRound:2});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal(accepted.body.agreedFare,80);
  assert.equal(accepted.body.driverNetFare,64);
  assert.equal(accepted.body.platformCommission,16);
  assert.equal((await read('requests/'+requestId)).taxiId,'driver');
  assert.equal(initializations.length,0,'Negotiation must not charge a card');
});

async function lowGoOffer(requestId='go-low-offer-reference'){
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
    commuterLocation:pickup,destinationCoords:destination});
  const offer=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(offer.status,200,JSON.stringify(offer.body));
  assert.equal(offer.body.dispatch.mode,'broadcast');
  assert.equal((await read(`notifications/taxis/driver/${requestId}`)).passengerOffer,65,'Submission itself delivers the 65% offer');
  return requestId;
}

test('a driver who comes online later receives the open offer in the real client listener and can accept it',async()=>{
  const requestId='go-late-online-driver';
  await db.ref('taxis/driver').update({isOnline:false,isBroadcasting:false,latitude:null,longitude:null});
  await db.ref('taxis/otherDriver').update({isOnline:false,isBroadcasting:false});
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
    commuterLocation:pickup,destinationCoords:destination});
  const submitted=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(submitted.status,200);assert.equal(submitted.body.dispatch.mode,'none');
  assert.equal((await read('requests/'+requestId)).driverFoundCount,0);
  const dom=new JSDOM('',{url:'https://example.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;let displayed;let opened;
  const incoming=new Promise(resolve=>{opened=resolve;});
  try {
    await db.ref('taxis/driver').update({...pickup,isOnline:true,isBroadcasting:true,lastSeen:Date.now()});
    w.AsiyeEnrollment={requireApproval:async()=>true};
    w.firebase={database:()=>db,auth:()=>({currentUser:{uid:'driver-auth'}})};
    w.AsiyeDriverBanking={isReady:()=>true,require:async()=>true};
    w.ASIYE_DRIVER={state:{driverId:'driver',driver:await read('taxis/driver')},
      ui:{hasApprovedVehicle:()=>true,showIncomingRequest:request=>{displayed=request;opened();},closeIncomingRequest(){},toast(){}},
      trip:{start(){}}};
    w.eval(fs.readFileSync('../../assets/driver-v2/js/requests.js','utf8'));
    const client=w.ASIYE_DRIVER.requests;client.playRequestSound=()=>{};
    client.postNegotiation=async(endpoint,body)=>{
      const result=await call(endpoint,'driver-auth',body);
      assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
    };
    client.listenToNotifications('driver');
    const dispatched=await call('dispatchGoRideRequest','sender-auth',{requestId});
    assert.equal(dispatched.status,200);assert.equal(dispatched.body.mode,'broadcast');
    let timer;try{await Promise.race([incoming,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Driver popup not delivered')),8000);})]);}finally{clearTimeout(timer);}
    assert.equal(displayed.requestId,requestId);assert.equal(displayed.passengerOffer,65);
    assert.equal((await read('requests/'+requestId)).driverFoundCount,1);
    const accepted=await client.accept(requestId);assert.equal(accepted.ok,true);
    assert.equal((await read('requests/'+requestId)).taxiId,'driver');
    assert.equal((await read('requests/'+requestId)).fareStatus,'agreed');
    assert.equal(await read('taxis/driver/currentRequest'),requestId);
    assert.equal(initializations.length,0);
  }finally{w.ASIYE_DRIVER?.requests?.stop();dom.window.close();}
});

test('Cash and Card offers at 65% are delivered during submission without a second client call',async()=>{
  for(const paymentMethod of ['cash','card']) {
    const requestId='go-submit-dispatch-'+paymentMethod;
    await db.ref('commuters/sender/currentRequest').remove();
    await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
      paymentMethod,negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
      commuterLocation:pickup,destinationCoords:destination});
    const result=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.dispatch.mode,'broadcast');
    assert.equal(result.body.pricing.status,'searching');
    const notification=await read(`notifications/taxis/driver/${requestId}`);
    assert.equal(notification.type,'ride_request');
    assert.equal(notification.fare,65);assert.equal(notification.passengerOffer,65);
    assert.equal(notification.suggestedFare,90);assert.equal(notification.maximumFareOffer,95);
    assert.equal((await read('requests/'+requestId)).fareStatus,'passenger_offer');
    assert.equal((await read('requests/'+requestId)).paymentsReady,false);
    assert.equal(initializations.length,0);
  }
});

test('a failed notification write preserves the offer and dispatch can retry without changing its round',async()=>{
  const requestId='go-dispatch-outage';
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
    commuterLocation:pickup,destinationCoords:destination});
  const proto=Object.getPrototypeOf(db.ref()),update=proto.update;
  let failed;
  try {
    proto.update=function(values,...rest){
      if(Object.keys(values).some(key=>key.startsWith('notifications/taxis/')))throw Error('Simulated notification outage');
      return update.call(this,values,...rest);
    };
    failed=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  } finally {proto.update=update;}
  assert.equal(failed.status,503,JSON.stringify(failed.body));assert.equal(failed.body.offerSaved,true);
  assert.equal(failed.body.pricing.driverFoundCount,0);
  assert.equal(await read('commuters/sender/currentRequest'),requestId);
  assert.equal((await read('requests/'+requestId)).passengerOffer,65);
  assert.equal((await read('requests/'+requestId)).fareStatus,'passenger_offer');
  const retry=await call('dispatchGoRideRequest','sender-auth',{requestId});
  assert.equal(retry.status,200,JSON.stringify(retry.body));
  assert.equal((await read(`notifications/taxis/driver/${requestId}`)).fare,65);
  assert.equal((await read('requests/'+requestId)).passengerOfferRound,1);
});

test('dispatch cannot forward an unvalidated draft or revive a cancelled offer',async()=>{
  const requestId='go-unvalidated-draft';
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
    paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',passengerOffer:65,
    routeDistanceKm:10,routeDurationMinutes:0,commuterLocation:pickup,destinationCoords:destination});
  assert.equal((await call('dispatchGoRideRequest','sender-auth',{requestId})).status,409);
  assert.equal(await read(`notifications/taxis/driver/${requestId}`),null);
  await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  await db.ref('requests/'+requestId+'/status').set('cancelled_by_commuter');
  assert.equal((await call('dispatchGoRideRequest','sender-auth',{requestId})).status,409);
  assert.equal((await read('requests/'+requestId)).status,'cancelled_by_commuter');
});

test('a driver can accept a low fare with the same 80/20 agreement',async()=>{
  const requestId=await lowGoOffer();
  const accepted=await call('acceptGoFareOffer','driver-auth',{requestId,amount:65});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  const agreement=await read('goFareAgreements/'+requestId);
  assert.equal(agreement.agreedFare,65);assert.equal(agreement.driverNetFare,52);assert.equal(agreement.platformCommission,13);
  assert.equal(agreement.driverId,'driver');assert.equal(initializations.length,0);
});

test('only a notified driver can decline; the passenger can continue with other drivers or a new offer',async()=>{
  const requestId=await lowGoOffer();
  await db.ref(`notifications/taxis/otherDriver/${requestId}`).remove();
  assert.equal((await call('declineGoFareOffer',null,{requestId})).status,401);
  assert.equal((await call('declineGoFareOffer','other-driver-auth',{requestId})).status,403);
  assert.equal((await call('declineGoFareOffer','sender-auth',{requestId})).status,403);
  const declined=await call('declineGoFareOffer','driver-auth',{requestId,amount:65,negotiationRound:1});
  assert.equal(declined.status,200,JSON.stringify(declined.body));
  assert.equal((await call('declineGoFareOffer','driver-auth',{requestId})).status,200,'Retry is idempotent');
  const trip=await read('requests/'+requestId);
  assert.equal(trip.status,'searching');assert.equal(trip.fareStatus,'passenger_offer');
  assert.equal(trip.lastGoFareDecision.driverId,'driver');assert.equal(trip.lastGoFareDecision.action,'declined');
  assert.equal(await read('commuters/sender/currentRequest'),requestId);
  assert.equal(await read(`notifications/taxis/driver/${requestId}`),null);
  const notices=Object.values(await read('notifications/commuters/sender'));
  assert.equal(notices.filter(n=>n.type==='go_fare_declined').length,1);
  assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:65})).status,200);
  assert.equal((await read('requests/'+requestId)).passengerOfferRound,1,'A duplicate offer must not erase the driver decision');
  assert.equal((await call('dispatchGoRideRequest','sender-auth',{requestId})).status,200);
  assert.equal(await read(`notifications/taxis/driver/${requestId}`),null,'The driver is not asked again about the same offer');
  assert.ok(await read(`notifications/taxis/otherDriver/${requestId}`));
  assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:70})).status,200);
  assert.equal((await call('dispatchGoRideRequest','sender-auth',{requestId})).status,200);
  assert.ok(await read(`notifications/taxis/driver/${requestId}`),'A changed offer can be considered again');
  assert.equal((await read('requests/'+requestId)).passengerOfferRound,2);
  assert.equal(initializations.length,0);
});

test('stale decline taps cannot reject a newer passenger offer',async()=>{
  const requestId=await lowGoOffer();
  assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:70})).status,200);
  assert.equal((await call('declineGoFareOffer','driver-auth',{requestId,amount:65,negotiationRound:1})).status,409);
  assert.equal((await read('requests/'+requestId)).lastGoFareDecision,undefined);
  assert.equal((await read('requests/'+requestId)).passengerOffer,70);
});

test('a driver may withdraw their counter and the passenger cannot accept it afterwards',async()=>{
  const requestId=await lowGoOffer();
  assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:80})).status,200);
  const retry=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(retry.status,200);assert.equal(retry.body.pricing.fareStatus,'driver_counter');
  assert.equal((await read('requests/'+requestId)).driverCounterFare,80,'A duplicate passenger request must preserve the driver counter');
  assert.equal((await call('declineGoFareOffer','driver-auth',{requestId,amount:65,negotiationRound:2})).status,200);
  const trip=await read('requests/'+requestId);
  assert.equal(trip.fareStatus,'passenger_offer');assert.equal(trip.driverCounterFare,undefined);
  assert.equal((await call('acceptGoFareCounter','sender-auth',{requestId,amount:80,negotiationRound:2})).status,409);
  assert.equal((await read('requests/'+requestId)).taxiId,undefined);
});

test('simultaneous driver acceptance and rejection produce one decision',async()=>{
  const requestId=await lowGoOffer();
  const [accepted,declined]=await Promise.all([
    call('acceptGoFareOffer','driver-auth',{requestId,amount:65}),
    call('declineGoFareOffer','driver-auth',{requestId,amount:65,negotiationRound:1})
  ]);
  const trip=await read('requests/'+requestId);
  if(accepted.status===200){
    assert.equal(declined.status,409);assert.equal(trip.fareStatus,'agreed');assert.equal(trip.lastGoFareDecision,undefined);
  }else{
    assert.equal(declined.status,200);assert.ok([403,409].includes(accepted.status));
    assert.equal(trip.taxiId,undefined);assert.equal(trip.lastGoFareDecision.action,'declined');
  }
  assert.equal(initializations.length,0);
});

test('Go cancellation before driver acceptance permits the second and third bookings without admin intervention',async()=>{
 for(const requestId of ['go-first-cancelled-reference','go-second-cancelled-reference','go-third-booking-reference']){
  assert.match(requestId,/^[A-Za-z0-9_-]{16,128}$/);
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
   paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
   commuterLocation:pickup,destinationCoords:destination});
  const offer=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
  assert.equal(offer.status,200,JSON.stringify(offer.body));
  assert.equal(await read('commuters/sender/currentRequest'),requestId);
  if(requestId==='go-third-booking-reference')continue;
  assert.equal((await call('goTripActionSecure','member-auth',{requestId,action:'cancel'})).status,403);
  const cancelled=await call('goTripActionSecure','sender-auth',{requestId,action:'cancel'});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
  assert.equal((await read('requests/'+requestId)).status,'cancelled_by_commuter');
  assert.equal(await read('commuters/sender/currentRequest'),null);
  assert.equal((await call('goTripActionSecure','sender-auth',{requestId,action:'cancel'})).status,200,'Cancellation retry must be idempotent');
  assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:80})).status,409,'Ended requests cannot be reactivated');
 }
 assert.equal(initializations.length,0);
});

test('legacy cancelled pointers self-heal while delayed cancellations preserve a newer active booking',async()=>{
 const oldId='go-old-cancelled-reference';
 await db.ref('requests/'+oldId).set({requestId:oldId,commuterId:'sender',type:'ehailing',rideType:'go',status:'cancelled',negotiationEnabled:true});
 await db.ref('commuters/sender/currentRequest').set(oldId);
 const requestId='go-new-booking-reference';
 await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
  paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
  commuterLocation:pickup,destinationCoords:destination});
 const offer=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
 assert.equal(offer.status,200,JSON.stringify(offer.body));
 assert.equal(await read('commuters/sender/currentRequest'),requestId);
 assert.equal((await call('goTripActionSecure','sender-auth',{requestId:oldId,action:'cancel'})).status,200);
 assert.equal(await read('commuters/sender/currentRequest'),requestId);
 await db.ref('requests/conflicting').set({...(await read('requests/'+requestId)),requestId:'conflicting'});
 const conflict=await call('submitGoFareOffer','sender-auth',{requestId:'conflicting',amount:70});
 assert.equal(conflict.status,409);assert.equal(conflict.body.activeRequestId,requestId);
});

test('offline drivers and cancelled rides cannot receive a new counter-offer',async()=>{
 const requestId='counter-availability';
 await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'searching',
  paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',passengerOffer:65,routeDistanceKm:10,routeDurationMinutes:0});
 await db.ref(`notifications/taxis/driver/${requestId}`).set({requestId});
 await db.ref('taxis/driver').update({isOnline:false,isBroadcasting:false});
 assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:80})).status,409);
 await db.ref('taxis/driver').update({isOnline:true,isBroadcasting:true});
 await db.ref('requests/'+requestId+'/status').set('cancelled_by_commuter');
 assert.equal((await call('counterGoFare','driver-auth',{requestId,amount:80})).status,409);
 assert.equal((await read('requests/'+requestId)).driverCounterFare,undefined);
});

test('driver acceptance rejects a fare that differs from the offer displayed on screen',async()=>{
 const requestId='changed-driver-offer';
 await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
  paymentMethod:'cash',negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
  commuterLocation:pickup,destinationCoords:destination});
 assert.equal((await call('submitGoFareOffer','sender-auth',{requestId,amount:75})).status,200);
 await db.ref(`notifications/taxis/driver/${requestId}`).set({requestId});
 assert.equal((await call('acceptGoFareOffer','driver-auth',{requestId,amount:65})).status,409);
 assert.equal((await read('requests/'+requestId)).taxiId,undefined);
 const accepted=await call('acceptGoFareOffer','driver-auth',{requestId,amount:75});
 assert.equal(accepted.status,200,JSON.stringify(accepted.body));
 assert.equal(accepted.body.agreedFare,75);
});

test('admin cancellation cleanup clears the matching pointer and preserves a newer booking',async()=>{
 const requestId='admin-cancelled';
 const status=db.ref('requests/'+requestId+'/status');
 await db.ref('requests/'+requestId).set({requestId,commuterId:'sender',type:'ehailing',status:'searching'});
 const before=await status.once('value');await status.set('cancelled_by_admin');
 const after=await status.once('value');
 await db.ref('commuters/sender/currentRequest').set(requestId);
 await handlers.releaseCancelledGoTripPayment.run({before,after},{params:{requestId}});
 assert.equal(await read('commuters/sender/currentRequest'),null);
 await db.ref('commuters/sender/currentRequest').set('new-active-booking');
 await handlers.releaseCancelledGoTripPayment.run({before,after},{params:{requestId}});
 assert.equal(await read('commuters/sender/currentRequest'),'new-active-booking');
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
  assert.equal(initializations[0].callback_url,
    `https://us-central1-${projectId}.cloudfunctions.net/paystackPaymentReturn`);
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

async function goCardForRefund() {
  const requestId='go-refund-handler-reference';
  await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',
    taxiId:'driver',status:'payment_required',paymentMethod:'card',agreedFare:100,finalAmount:100,
    negotiationEnabled:true,fareStatus:'agreed',goContinuationRequestedVersion:2,commissionRate:0.2,
    commuterLocation:pickup,destinationCoords:destination});
  await db.ref('goFareAgreements/'+requestId).set({driverId:'driver',agreedFare:100,
    paymentMethod:'card',commissionRate:0.2,currency:'ZAR'});
  const checkout=await call('prepareTripPayment','sender-auth',{requestId});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  assert.equal((await webhook(checkout.body.reference)).status,200);
  return {requestId,reference:checkout.body.reference};
}

async function refundWebhook(reference,valid=true) {
  const body={event:'refund.processed',data:{transaction_reference:reference,status:'processed',amount:'1'}};
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature=crypto.createHmac('sha512',secret).update(rawBody).digest('hex');
  return call('paystackWebhook',null,body,{rawBody,headers:{'x-paystack-signature':valid?signature:'forged'}});
}

test('live checkout defaults off and needs server-only provider approval plus validation evidence',async()=>{
  const {requestId}=await parcel('card');await accept(requestId);
  process.env.PAYSTACK_SECRET_KEY='sk_live_TESTING_NOT_A_REAL_KEY';
  for(const launch of [null,{liveEnabled:true},{liveEnabled:true,approvalReference:'provider-review'}]){
    await db.ref('paymentLaunch/paystack').set(launch);
    assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,503);
    assert.equal(await read(`tripPayments/${requestId}/sender`),null);
  }
  assert.equal(initializations.length,0);
  await db.ref('paymentLaunch/paystack').set({liveEnabled:true,approvalReference:'provider-review',
    validationReference:'accepted-staging-evidence'});
  subaccountPatch={domain:'live'};
  assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).paystackDomain,'live');
});

test('provider responses from a different mode cannot initialize checkout or unlock pickup',async()=>{
  const {requestId}=await parcel('card');await accept(requestId);
  subaccountPatch={domain:'live'};
  assert.equal((await call('prepareTripPayment','sender-auth',{requestId})).status,409);
  assert.equal(initializations.length,0);
  subaccountPatch={};
  const checkout=await call('prepareTripPayment','sender-auth',{requestId});
  verificationPatch={domain:'live'};
  assert.equal((await webhook(checkout.body.reference)).status,500);
  assert.equal((await read('requests/'+requestId)).paymentsReady,false);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'initialized');
});

test('an active booking cannot refund or settle before verified departure',async()=>{
  const {requestId}=await goCardForRefund();
  assert.equal((await call('releaseTripPayment',null,{requestId})).status,401);
  assert.equal((await call('releaseTripPayment','member-auth',{requestId})).status,403);
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).status,409);
  assert.equal((await call('settleTripPayment','driver-auth',{requestId})).status,409);
  assert.equal(refunds.length,0);
  await db.ref('requests/'+requestId).update({status:'cancelled_by_admin',pinVerifiedAt:1,tripStartedAt:1});
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).status,409);
  assert.equal(refunds.length,0);
});

test('concurrent client and cancellation-trigger refunds issue exactly one provider refund',async()=>{
  const {requestId,reference}=await goCardForRefund();
  const status=db.ref('requests/'+requestId+'/status');
  const before=await status.once('value');await status.set('cancelled_by_commuter');
  const after=await status.once('value');
  let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  onRefund=async()=>{enter();await pending;};
  const first=call('releaseTripPayment','sender-auth',{requestId});
  await entered;
  const duplicate=await call('releaseTripPayment','sender-auth',{requestId});
  assert.equal(duplicate.body.status,'refund_initializing');
  await handlers.releaseCancelledGoTripPayment.run({before,after},{params:{requestId}});
  assert.equal((await webhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refund_initializing');
  release();
  assert.equal((await first).body.status,'refund_pending');
  assert.equal(refunds.length,1);
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).body.status,'refund_pending');
  assert.equal(refunds.length,1);
});

test('unknown refund outcomes stay reserved and reconcile through verified provider data, never a second POST',async()=>{
  const {requestId,reference}=await goCardForRefund();
  await db.ref('requests/'+requestId+'/status').set('cancelled_by_commuter');
  onRefund=async()=>{throw Error('Simulated lost refund response after provider acceptance');};
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).status,502);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refund_unknown');
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).body.status,'refund_unknown');
  assert.equal(refunds.length,1);
  assert.equal((await refundWebhook(reference,false)).status,401);
  refundPatch={status:'processed',amount:1};
  assert.equal((await refundWebhook(reference)).status,500,'A signed event cannot override the actual refund amount');
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refund_unknown');
  refundPatch={status:'processed'};
  assert.equal((await refundWebhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  refundPatch={status:'pending'};
  assert.equal((await refundWebhook(reference)).status,200);
  assert.equal((await webhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  assert.equal((await read('requests/'+requestId)).status,'cancelled_by_commuter');
  assert.equal(refunds.length,1);
});

test('refund failure needs review; a verified processed result finishes it without reissuing a refund',async()=>{
  const {requestId,reference}=await goCardForRefund();
  await db.ref('requests/'+requestId+'/status').set('cancelled_by_commuter');
  assert.equal((await call('releaseTripPayment','sender-auth',{requestId})).body.status,'refund_pending');
  refundPatch={status:'failed'};
  assert.equal((await refundWebhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refund_review');
  refundPatch={status:'processed',currency:'NGN'};
  assert.equal((await refundWebhook(reference)).status,500);
  refundPatch={status:'processed'};
  assert.equal((await refundWebhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  assert.equal(refunds.length,1);
});

test('an unconfigured webhook cannot authenticate with an empty known HMAC key',async()=>{
  process.env.PAYSTACK_SECRET_KEY='';
  const body={event:'charge.success',data:{reference:'ASIYE-EMPTY-SECRET'}};
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature=crypto.createHmac('sha512','').update(rawBody).digest('hex');
  assert.equal((await call('paystackWebhook',null,body,{rawBody,
    headers:{'x-paystack-signature':signature}})).status,503);
});

test('support refunds performed in Paystack reconcile Parcel without enabling pickup or issuing another refund',async()=>{
  const {requestId,reference}=await paidParcel();
  const transaction=transactions.get(reference);
  refunds.push({id:9000,transaction:{id:transaction.id,reference},amount:transaction.amount,
    currency:'ZAR',domain:'test',status:'processed'});
  assert.equal((await refundWebhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  assert.equal((await read('requests/'+requestId)).paymentsReady,false);
  assert.equal((await action(requestId,'onWay')).status,409);
  assert.equal((await webhook(reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  assert.equal(refunds.length,1);
});

test('a Work refund affects only the cancelled member and preserves the other member payment',async()=>{
  const requestId='work-refund-handler-reference';
  await db.ref('requests/'+requestId).set({requestId,type:'club',clubMode:'club4',clubSecurityVersion:2,
    commuterId:'sender',taxiId:'driver',status:'driver_waiting',paymentMethod:'card',poolReady:true,
    driverAcceptedAt:Date.now(),pricePerPassenger:60,passengers:{
      sender:{price:60,paymentMethod:'card',status:'waiting'},member:{price:40,paymentMethod:'card',status:'waiting'}}});
  const checkouts=await Promise.all(['sender-auth','member-auth'].map(uid=>call('prepareTripPayment',uid,{requestId})));
  for(const checkout of checkouts)assert.equal((await webhook(checkout.body.reference)).status,200);
  await db.ref(`requests/${requestId}/passengers/sender/status`).set('cancelled_by_commuter');
  const released=await call('releaseTripPayment','sender-auth',{requestId});
  assert.equal(released.body.status,'refund_pending',JSON.stringify(released));
  refundPatch={status:'processed'};
  assert.equal((await refundWebhook(checkouts[0].body.reference)).status,200);
  assert.equal((await read(`tripPayments/${requestId}/sender`)).status,'refunded');
  assert.equal((await read(`tripPayments/${requestId}/member`)).status,'held');
  assert.equal((await read(`requests/${requestId}/passengers/member`)).paymentStatus,'held');
  assert.equal(refunds.length,1);assert.equal(refunds[0].amount,6000);
});

test('unverified passenger cannot create Parcel or submit a Go offer, lock or charge',async()=>{
 await db.ref('commuters/sender/bookingFaceSavedAt').remove();
 const rejected=await call('createParcelRequestSecure','sender-auth',{pickup,destination,paymentMethod:'cash'});
 assert.equal(rejected.status,403);assert.equal(await read('requests'),null);
 const requestId='go-no-face';
 await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
  paymentMethod:'cash',negotiationEnabled:true,routeDistanceKm:10,routeDurationMinutes:0,commuterLocation:pickup,destinationCoords:destination});
 const offered=await call('submitGoFareOffer','sender-auth',{requestId,amount:65});
 assert.equal(offered.status,403);assert.equal(offered.body.code,'passenger-face-required');
 assert.equal(await read('commuters/sender/currentRequest'),null);assert.equal(await read('notifications/taxis'),null);assert.equal(initializations.length,0);
});

test('agreed Card fare recovers missing TEST subaccount setup, charges the exact split and starts driver pickup after signed confirmation',async()=>{
 const vm=require('node:vm');
 const {makeStagingTestConsole,PROJECT}=require('../../functions/staging-test-console');
 const {HttpsError}=require('node:module').createRequire(require.resolve('../../functions/package.json'))('firebase-functions/v2/https');
 const requestId='go-card-setup-recovery';
 await db.ref('driverPaystackSubaccounts/driver').remove();
 await db.ref('requests/'+requestId).set({requestId,type:'ehailing',rideType:'go',commuterId:'sender',status:'pending',
  paymentMethod:'card',negotiationEnabled:true,goContinuationRequestedVersion:2,routeDistanceKm:15,routeDurationMinutes:0,
  commuterLocation:pickup,destinationCoords:destination});
 const offered=await call('submitGoFareOffer','sender-auth',{requestId,amount:100});
 assert.equal(offered.status,200,JSON.stringify(offered.body));
 const blocked=await call('acceptGoFareOffer','driver-auth',{requestId,amount:100});
 assert.equal(blocked.status,409);assert.match(blocked.body.error,/banking details/);assert.equal(initializations.length,0);
 assert.equal((await read('requests/'+requestId)).taxiId,undefined);
 const src=fs.readFileSync('../../functions/index.js','utf8');
 const eligible=vm.runInNewContext(src.slice(src.indexOf('function driverProfileCanReceiveRequests('),src.indexOf('async function nearbyWorkDrivers('))+'\ndriverProfileCanReceiveRequests;');
 const consoleApi=makeStagingTestConsole({admin,projectId:()=>PROJECT,paymentDomain:()=> 'test',HttpsError,driverEligible:eligible,
  paystackRequest:async path=>(await global.fetch('https://api.paystack.co'+path,{headers:{Authorization:'Bearer '+secret}})).json()});
 await consoleApi({action:'linkTestSubaccount',driverId:'driver',subaccountCode:account},{auth:{uid:'test-owner',token:{stagingTripTester:true}}});
 const accepted=await call('acceptGoFareOffer','driver-auth',{requestId,amount:100});
 assert.equal(accepted.status,200,JSON.stringify(accepted.body));
 const checkout=await call('prepareTripPayment','sender-auth',{requestId});assert.equal(checkout.status,200,JSON.stringify(checkout.body));
 assert.equal(initializations.length,1);assert.equal(initializations[0].amount,'10000');assert.equal(initializations[0].subaccount,account);
 assert.equal((await read('driverPaystackSubaccounts/driver')).platformCommissionPercent,20);
 assert.equal((await read('requests/'+requestId)).status,'payment_required');
 assert.equal((await read('requests/'+requestId)).pickupPin,undefined);
 assert.equal((await webhook(checkout.body.reference)).status,200);
 const paid=await read('requests/'+requestId);assert.equal(paid.status,'accepted');assert.equal(paid.paymentsReady,true);assert.match(paid.pickupPin,/^\d{4}$/);
 const browser={console,ASIYE_DRIVER:{state:{},ui:{toast(){}},map:{}},document:{getElementById:()=>null}};browser.window=browser;
 vm.createContext(browser);vm.runInContext(fs.readFileSync('../../assets/driver-v2/js/trip-controller.js','utf8'),browser);
 const trip=browser.ASIYE_DRIVER.trip;trip.requestId=requestId;trip.requestRef=db.ref('requests/'+requestId);let navigations=0;
 trip.goAction=async action=>{const result=await call('goTripActionSecure','driver-auth',{requestId,action});assert.equal(result.status,200,JSON.stringify(result.body));};
 trip.startPickupNavigation=async live=>{assert.equal(live.status,'driver_on_way');assert.equal(live.commuterLocation.latitude,pickup.latitude);navigations++;};
 await trip.resumeConfirmedCardPickup(paid);assert.equal(navigations,1);assert.equal((await read('requests/'+requestId)).status,'driver_on_way');
 await webhook(checkout.body.reference);assert.equal(initializations.length,1);assert.equal((await read('requests/'+requestId)).pickupPin,paid.pickupPin);
});
