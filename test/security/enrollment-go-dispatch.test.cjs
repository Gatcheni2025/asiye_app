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
async function approve(type){
 await db.ref('driverEnrollments/driver').set({version:2,status:'pending',authUid:'driver',fullName:'Test Driver',phone:'+27821234567',phoneVerified:true,
 residentialAddress:'10 Test Road, Durban',vehiclePending:{type,make:'Toyota',model:'Test Model',colour:'White',year:2025,registration:'ND12345',seats:4},
 profileImageUrl:'https://example.test/selfie.jpg',vehiclePhoto:'https://example.test/car.jpg',
 documents:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'owned/'+k])),
 documentUrls:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'https://example.test/'+k+'.jpg'])),submittedAt:1});
 const reviewed=await handlers.reviewDriverEnrollmentSecure.run({auth:{uid:'reviewer',token:{enrollmentReviewer:true}},data:{uid:'driver',decision:'approved'}});
 assert.equal(reviewed.status,'approved');
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
 assert.equal(driver.vehicleType,category);assert.equal(driver.vehicle.type,category);
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
