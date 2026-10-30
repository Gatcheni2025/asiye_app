'use strict';
// Actual approval -> matching -> protected acceptance in an isolated RTDB emulator.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const admin=require('../../functions/node_modules/firebase-admin');
const projectId='demo-asiye-enrollment-dispatch';
const html=fs.readFileSync('../../assets/driver-v2/enrollment.html','utf8');
const categories=[...html.match(/<select name="vehicleType"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
const pickup={latitude:-29.85,longitude:30.95},destination={latitude:-29.80,longitude:30.99};
let app,db,handlers,originalVerify,originalGet;
before(()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
 assert.match(host||'',/^(127\.0\.0\.1|localhost):\d+$/);
 app=admin.initializeApp({projectId,databaseURL:`http://${host}?ns=${projectId}`});db=app.database();
 originalVerify=admin.auth().verifyIdToken;originalGet=admin.auth().getUser;
 admin.auth().verifyIdToken=async token=>({uid:token});
 admin.auth().getUser=async uid=>({uid,email:uid+'@example.test',displayName:'Test Driver',phoneNumber:'+27821234567'});
 handlers=require('../../functions/index');
});
beforeEach(async()=>{await db.ref().set({commuters:{passenger:{authUid:'passenger',name:'Test Passenger',email:'passenger@example.test',
 bookingFaceAuthUid:'passenger',bookingFaceSavedAt:1,profileImageUrl:'https://example.test/passenger.jpg'}}});});
after(async()=>{admin.auth().verifyIdToken=originalVerify;admin.auth().getUser=originalGet;await app.delete();});
const read=async path=>(await db.ref(path).once('value')).val();
async function call(endpoint,uid,body){
 const result={status:200};const headers={authorization:'Bearer '+uid};
 const res={status(n){result.status=n;return this;},set(){return this;},json(data){result.body=data;return this;},send(data){result.body=data;return this;}};
 await handlers[endpoint]({method:'POST',body,headers,get:key=>headers[key.toLowerCase()]||''},res);return result;
}
async function seedApplication(type){
 await db.ref('driverEnrollments/driver').set({version:2,status:'pending',authUid:'driver',fullName:'Test Driver',phone:'+27821234567',phoneVerified:true,
 residentialAddress:'10 Test Road, Durban',vehiclePending:{type,make:'Toyota',model:'Test Model',colour:'White',year:2025,registration:'ND12345',seats:4},
 profileImageUrl:'https://example.test/selfie.jpg',vehiclePhoto:'https://example.test/car.jpg',
 documents:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'owned/'+k])),
 documentUrls:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'https://example.test/'+k+'.jpg'])),submittedAt:1});
}
async function approve(type){
 await seedApplication(type);
 const reviewed=await handlers.reviewDriverEnrollmentSecure.run({auth:{uid:'reviewer',token:{enrollmentReviewer:true}},data:{uid:'driver',decision:'approved'}});
 assert.equal(reviewed.status,'approved');
 await db.ref('driverPaystackSubaccounts/driver').set({ownerUid:'driver',status:'verified',paystackDomain:'test',subaccountCode:'ACCT_enrolleddriver',platformCommissionPercent:20,accountLast4:'7890'});
 await db.ref('taxis/driver').update({...pickup,isOnline:true,isBroadcasting:true,lastSeen:Date.now()});
 return read('taxis/driver');
}
async function offer(method){
 await db.ref('requests/ride').set({requestId:'ride',commuterId:'passenger',type:'ehailing',rideType:'go',status:'pending',
 paymentMethod:method,negotiationEnabled:true,fareStatus:'passenger_offer',routeDistanceKm:10,routeDurationMinutes:0,
 commuterLocation:pickup,destinationCoords:destination});
 return call('submitGoFareOffer','passenger',{requestId:'ride',amount:65});
}
for(const category of categories)for(const method of ['cash','card'])test(`approved ${category} receives and accepts a ${method} Go offer after real enrollment review`,async()=>{
 const driver=await approve(category);
 assert.equal(driver.vehicleType,category);assert.equal(driver.vehicle.type,category);assert.equal(driver.carCategory,category);
 const submitted=await offer(method);assert.equal(submitted.status,200,JSON.stringify(submitted.body));
 assert.equal(submitted.body.dispatch.mode,'broadcast');
 assert.equal((await read('requests/ride')).driverFoundCount,1);
 assert.equal((await read('notifications/taxis/driver/ride')).passengerOffer,65);
 // Existing open offers use the separate retry endpoint; both callers must match.
 await db.ref('notifications/taxis/driver/ride').remove();
 const retry=await call('dispatchGoRideRequest','passenger',{requestId:'ride'});
 assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.mode,'broadcast');
 assert.equal((await read('notifications/taxis/driver/ride')).paymentMethod,method);
 const accepted=await call('acceptGoFareOffer','driver',{requestId:'ride',amount:65});
 assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert.equal(accepted.body.ok,true);
 const trip=await read('requests/ride');assert.equal(trip.taxiId,'driver');assert.equal(trip.fareStatus,'agreed');
 assert.equal(await read('taxis/driver/currentRequest'),'ride');
 assert.equal(trip.pickupPin,undefined,'Driver matching must not bypass payment or pickup PIN gates');
});
test('physical categories never bypass approval or online broadcasting requirements',async()=>{
 await approve('sedan');await db.ref('taxis/driver').update({vehicleApproved:false,vehicleApprovalStatus:'pending'});
 let response=await offer('cash');assert.equal(response.status,200);assert.equal(response.body.dispatch.mode,'none');
 assert.equal(await read('notifications/taxis/driver/ride'),null);
 await db.ref('taxis/driver').update({vehicleApproved:true,vehicleApprovalStatus:'approved',isBroadcasting:false});
 response=await call('dispatchGoRideRequest','passenger',{requestId:'ride'});assert.equal(response.body.mode,'none');
 assert.equal(await read('notifications/taxis/driver/ride'),null);
});

for(const type of ['suv','minibus'])test(`${type} cannot be approved, submitted as an update, dispatched or accepted`,async()=>{
 await seedApplication(type);
 await assert.rejects(()=>handlers.reviewDriverEnrollmentSecure.run({auth:{uid:'reviewer',token:{enrollmentReviewer:true}},
  data:{uid:'driver',decision:'approved'}}),e=>e.code==='invalid-argument'&&/Sedan and Hatchback/.test(e.message));
 assert.equal(await read('driverEnrollments/driver/status'),'pending');
 assert.equal(await read('taxis/driver'),null);
 const supported=await approve('sedan');
 const update=await call('submitDriverVehicleForReview','driver',{driverId:'driver',vehicle:{...supported.vehicle,type}});
 assert.equal(update.status,400);assert.match(update.body.error,/Sedan and Hatchback/);
 assert.equal(await read('taxis/driver/vehicle/type'),'sedan');
 // Older approved records must also be excluded, including a stale service label.
 await db.ref('taxis/driver').update({vehicle:{...supported.vehicle,type},vehicleType:'go'});
 const submitted=await offer('cash');assert.equal(submitted.status,200);assert.equal(submitted.body.dispatch.mode,'none');
 assert.equal(await read('notifications/taxis/driver/ride'),null);
 const retry=await call('dispatchGoRideRequest','passenger',{requestId:'ride'});
 assert.equal(retry.body.mode,'none');assert.equal(await read('notifications/taxis/driver/ride'),null);
 const accepted=await call('acceptGoFareOffer','driver',{requestId:'ride',amount:65});
 assert.notEqual(accepted.status,200);assert.equal((await read('requests/ride')).taxiId,undefined);
});
test('supported vehicle changes submit for review and put the driver offline',async()=>{
 const driver=await approve('sedan');
 const updated=await call('submitDriverVehicleForReview','driver',{driverId:'driver',vehicle:{...driver.vehicle,type:' HATCHBACK '}});
 assert.equal(updated.status,200,JSON.stringify(updated.body));
 const taxi=await read('taxis/driver');assert.equal(taxi.vehiclePending.type,'hatchback');
 assert.equal(taxi.vehicleApproved,false);assert.equal(taxi.isOnline,false);assert.equal(taxi.isBroadcasting,false);
});

test('fresh physical approval replaces stale unsupported category mirrors',async()=>{
 await db.ref('taxis/driver').set({authUid:'driver',carCategory:'minibus',vehicleType:'suv'});
 const driver=await approve('hatchback');
 assert.equal(driver.carCategory,'hatchback');assert.equal(driver.vehicleType,'hatchback');
 const response=await offer('cash');assert.equal(response.status,200);assert.equal(response.body.dispatch.mode,'broadcast');
});

for(const method of ['cash','card'])test(`${method}: unlinked banking blocks dispatch and stale offer acceptance`,async()=>{
 await approve('sedan');await db.ref('driverPaystackSubaccounts/driver').remove();
 await db.ref('taxis/driver').update({payoutStatus:'verified',bookingBankingReady:true});
 const submitted=await offer(method);assert.equal(submitted.status,200);
 assert.equal(submitted.body.dispatch.mode,'none');assert.equal(await read('notifications/taxis/driver/ride'),null);
 await db.ref('notifications/taxis/driver/ride').set({requestId:'ride'});
 const accepted=await call('acceptGoFareOffer','driver',{requestId:'ride',amount:65});
 assert.equal(accepted.status,409);assert.match(accepted.body.error,/banking details/);
 assert.equal((await read('requests/ride')).taxiId,undefined);assert.equal(await read('taxis/driver/currentRequest'),null);
});
test('pending, wrong-owner and other-environment banking cannot receive or queue new requests',async()=>{
 await approve('sedan');const account=await read('driverPaystackSubaccounts/driver');
 for(const patch of [{status:'pending_paystack_verification'},{ownerUid:'someone-else'},{paystackDomain:'live'},
  {paystackDomain:null},{subaccountCode:'RCP_oldtransfer'},{platformCommissionPercent:0}]){
  await db.ref('driverPaystackSubaccounts/driver').set({...account,...patch});
  const submitted=await offer('card');assert.equal(submitted.body.dispatch.mode,'none',JSON.stringify(patch));
  assert.equal(await read('notifications/taxis/driver/ride'),null);
 }
 await db.ref('taxis/driver/currentRequest').set('existing-trip');
 assert.equal((await offer('cash')).body.dispatch.mode,'none');assert.equal(await read('taxis/driver/bookingQueue/ride'),null);
});
test('verified banking unlocks the next dispatch retry for the same passenger booking',async()=>{
 await approve('sedan');const account=await read('driverPaystackSubaccounts/driver');
 await db.ref('driverPaystackSubaccounts/driver').remove();assert.equal((await offer('card')).body.dispatch.mode,'none');
 await db.ref('driverPaystackSubaccounts/driver').set(account);
 assert.equal((await call('dispatchGoRideRequest','passenger',{requestId:'ride'})).body.mode,'broadcast');
 assert.equal((await call('acceptGoFareOffer','driver',{requestId:'ride',amount:65})).status,200);
 assert.equal((await read('requests/ride')).status,'payment_required');
});
test('Club assignment waits for banking and acceptance rechecks it',async()=>{
 await approve('sedan');const account=await read('driverPaystackSubaccounts/driver');await db.ref('driverPaystackSubaccounts/driver').remove();
 const body={requestId:'pool-bank-gate',clubMode:'club4',paymentMethod:'cash',pickupAddress:'Pickup',pickupLat:pickup.latitude,pickupLng:pickup.longitude,
  destination:'Destination',destinationLat:destination.latitude,destinationLng:destination.longitude,departureTime:'08:00'};
 const created=await call('createClubBookingSecure','passenger',body);assert.equal(created.status,200,JSON.stringify(created.body));
 assert.equal((await read('requests/pool-bank-gate')).taxiId,undefined);
 await db.ref('driverPaystackSubaccounts/driver').set(account);
 await handlers.synchronizeClubBooking.run({before:{val:()=>null},after:{val:()=>({clubSecurityVersion:2})}},{params:{requestId:'pool-bank-gate'}});
 assert.equal((await read('requests/pool-bank-gate')).taxiId,'driver');await db.ref('driverPaystackSubaccounts/driver').remove();
 const accepted=await call('clubDriverActionSecure','driver',{requestId:'pool-bank-gate',action:'acceptWaiting'});
 assert.equal(accepted.status,409);assert.match(accepted.body.error,/banking details/);
});
