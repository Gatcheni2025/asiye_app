'use strict';
const {test,before,beforeEach,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,get,set,update}=require('firebase/database');
let env;
const rules=fs.readFileSync(path.join(__dirname,'../../database.rules.json'),'utf8');
before(async()=>{env=await initializeTestEnvironment({
 projectId:'asiye-parcel-security-validation',database:{rules}
});});
beforeEach(async()=>{
 await env.clearDatabase();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.database();
  await set(ref(db),{
   commuters:{p1:{authUid:'passenger-auth'}},
   taxis:{'driver-record':{authUid:'driver-auth',userUid:'driver-auth'}},
   requests:{'parcel-secure':{
    type:'delivery',rideType:'delivery',parcelSecurityVersion:2,commuterId:'p1',
    status:'pending',paymentMethod:'card',paymentStatus:'awaiting_driver',
    paymentsReady:false,finalAmount:100,calculatedPrice:100,commissionRate:0.2,
    requirePin:true,createdAt:1,commuterLocation:{latitude:-29.8,longitude:30.9},
    destinationCoords:{latitude:-29.7,longitude:30.8}
   }},
   parcelPrivate:{'parcel-secure':{passengerId:'p1',pin:'4729',expiresAt:5000000000000}},
   delivery_requests:{'parcel-secure':{type:'delivery',parcelSecurityVersion:2,commuterId:'p1',status:'pending'}}
  });
 });
});
after(async()=>{if(env)await env.cleanup();});
const db=uid=>env.authenticatedContext(uid).database();
test('PIN is readable only by Admin SDK and not by signed-in passenger or driver',async()=>{
 for(const uid of ['passenger-auth','driver-auth','other-auth'])
  await assertFails(get(ref(db(uid),'parcelPrivate/parcel-secure')));
 const pub=(await get(ref(db('passenger-auth'),'requests/parcel-secure'))).val();
 if(pub.pickupPin||pub.pin)throw Error('Public PIN leaked');
});
test('mobile clients cannot create a legacy client-generated delivery or alter secret',async()=>{
 await assertFails(set(ref(db('passenger-auth'),'requests/fake-parcel'),{
   type:'delivery',commuterId:'p1',status:'pending',pickupPin:'1111'
 }));
 await assertFails(set(ref(db('passenger-auth'),'parcelPrivate/parcel-secure/pin'),'2222'));
});
test('legitimate assigned driver can accept a ready card delivery',async()=>{
 await assertSucceeds(update(ref(db('driver-auth'),'requests/parcel-secure'),{
   taxiId:'driver-record',driverAuthUid:'driver-auth',
   status:'payment_required',paymentStatus:'payment_required'
 }));
});
test('passenger and driver cannot forge paid state, pickup, PIN or completed state',async()=>{
 for(const uid of ['passenger-auth','driver-auth']){
  const base='requests/parcel-secure';
  for(const patch of [
   {pinVerifiedAt:123},{status:'in_transit'},{status:'completed'},
   {arrivedAt:123},{paymentsReady:true},{paymentStatus:'held'},
   {pickupPin:'4729'},{parcelSecurityVersion:1},{finalAmount:1}
  ])await assertFails(update(ref(db(uid),base),patch));
  await assertFails(update(ref(db(uid),'delivery_requests/parcel-secure'),{status:'completed'}));
 }
});
test('driver cannot fabricate Parcel PIN verification after legitimately accepting',async()=>{
 await assertSucceeds(update(ref(db('driver-auth'),'requests/parcel-secure'),{
   taxiId:'driver-record',driverAuthUid:'driver-auth',
   status:'payment_required',paymentStatus:'payment_required'
 }));
 await assertFails(update(ref(db('driver-auth'),'requests/parcel-secure'),
   {status:'driver_on_way',pinVerifiedAt:123,tripStartedAt:123}));
 await assertFails(update(ref(db('passenger-auth'),'requests/parcel-secure'),
   {paymentStatus:'captured'}));
});
