'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const safety=require('../functions/trip-end-safety');
const now=Date.now(),id='ride',uid='driver-auth';
const base=method=>({type:'ehailing',commuterId:'p',taxiId:'d',driverAuthUid:uid,status:'in_transit',
 tripStartedAt:now-10000,pinVerifiedAt:now-10000,agreedFare:100,paymentMethod:method,
 destinationCoords:{latitude:-29.8,longitude:31}});
const taxi=(near=false)=>({authUid:uid,currentRequest:id,latitude:near?-29.8:-29.9,longitude:31,lastSeen:now});
const request=(trip=base('card'))=>safety.action(trip,'requestEarlyEnd',{warningConfirmed:true,cashCollected:true},
 {role:'driver',uid},safety.destination(trip,taxi(),id,now),now,'end-one');
const respond=(trip,p='p',accepted=true,time=now+1)=>safety.action(trip,'respondEarlyEnd',
 {endRequestId:trip.tripEndSafety.id,accepted},{role:'passenger',uid:p+'-auth',passengerId:p},{},time);

test('persisted confirmations and completion claims round-trip as immutable scalars',()=>{
 const trip=respond(request());const frozen=safety.claim(trip,taxi(),id,uid,'end-one',now+2);
 const stored=safety.encode(frozen);
 assert.equal(typeof stored.tripEndSafety,'string');assert.equal(typeof stored.tripCompletion,'string');
 assert.deepEqual(safety.decode(stored),frozen);
 assert.deepEqual(safety.decode([1,2]),[1,2]);
 assert.throws(()=>safety.decode({tripEndSafety:'broken json'}));
});

test('fresh destination evidence permits normal completion; stale, unknown and mismatched GPS requires passenger consent',()=>{
 assert.equal(safety.check(base('card'),taxi(true),id,uid,now).requiresPassengerConfirmation,false);
 for(const d of [taxi(),{...taxi(true),lastSeen:now-120001},
  {...taxi(true),latitude:null},{...taxi(true),lastSeen:now+60000}]){
  assert.equal(safety.check(base('card'),d,id,uid,now).requiresPassengerConfirmation,true);
  assert.throws(()=>safety.claim(base('card'),d,id,uid,null,now),/passenger/);
 }
 assert.equal(safety.destination({...base('card'),destinationCoords:{latitude:null,longitude:31}},taxi(true),id,now).locationAvailable,false);
});
test('only a started PIN-verified trip and its reserved driver can request completion',()=>{
 for(const patch of [{status:'arrived'},{pinVerifiedAt:null},{tripStartedAt:null},{type:'delivery'}])
  assert.throws(()=>request({...base('card'),...patch}));
 assert.throws(()=>safety.check(base('card'),taxi(),id,'stranger',now),/reserved driver/);
 assert.throws(()=>safety.check(base('card'),{...taxi(),currentRequest:'new'},id,uid,now));
 assert.throws(()=>safety.action(base('card'),'requestEarlyEnd',{warningConfirmed:true},{role:'passenger'}, {},now,'end'));
 assert.throws(()=>safety.action(base('card'),'requestEarlyEnd',{}, {role:'driver',uid},{},now,'end'));
});
for(const method of ['card','cash'])test(`${method}: both confirmations authorize an early end without claiming destination arrival`,()=>{
 const pending=request(base(method));assert.equal(pending.status,'in_transit');
 assert.throws(()=>safety.claim(pending,taxi(),id,uid,'end-one',now+1));
 const approved=respond(pending);assert.equal(approved.tripEndSafety.status,'approved');
 const claimed=safety.claim(approved,taxi(),id,uid,'end-one',now+2);
 assert.equal(claimed.status,'in_transit');assert.equal(claimed.tripCompletion.mode,'agreed_early_end');
 assert.equal(claimed.dropoffArrivedAt,undefined);assert.equal(claimed.paymentSettlementStatus,undefined);
 assert.equal(safety.completed(claimed,now+3).phase,'completed');
 assert.deepEqual(safety.claim(claimed,taxi(),id,uid,'end-one',now+safety.TTL+1),claimed,'A frozen completion can retry after consent expiry');
});
test('declining, withdrawing, expiry, old IDs and changed assignments cannot authorize completion',()=>{
 const pending=request(),declined=respond(pending,'p',false);
 assert.equal(declined.status,'in_transit');assert.equal(declined.tripEndSafety.status,'declined');
 const withdrawn=safety.action(pending,'withdrawEarlyEnd',{endRequestId:'end-one'},{role:'driver',uid},{},now+1);
 for(const trip of [pending,declined,withdrawn])assert.throws(()=>safety.claim(trip,taxi(),id,uid,'end-one',now+2));
 const approved=respond(pending);
 assert.throws(()=>safety.claim(approved,taxi(),id,uid,'old-id',now+2));
 assert.throws(()=>safety.claim(approved,taxi(),id,uid,'end-one',now+safety.TTL));
 assert.throws(()=>safety.claim({...approved,agreedFare:150},taxi(),id,uid,'end-one',now+2));
 assert.throws(()=>safety.claim({...approved,taxiId:'new-driver'},taxi(),id,uid,'end-one',now+2));
 assert.throws(()=>respond(pending,'stranger'));
 assert.throws(()=>safety.action(pending,'respondEarlyEnd',{endRequestId:'end-one',accepted:true},{role:'driver',uid,passengerId:'p'},{},now+1));
 assert.throws(()=>respond(pending,'p',true,now+safety.TTL));
 assert.deepEqual(respond(approved),approved,'Identical responses are idempotent');
 assert.throws(()=>respond(approved,'p',false));
});
test('Club/Work requires every active onboard passenger; a changed group invalidates earlier approval',()=>{
 const trip={...base('cash'),type:'club',passengers:{a:{status:'in_transit',authUid:'a',pinVerifiedAt:1,paymentMethod:'cash'},
  b:{status:'in_transit',authUid:'b',pinVerifiedAt:1,paymentMethod:'card'},left:{status:'cancelled',authUid:'left'}}};
 let end=request(trip);assert.deepEqual(end.tripEndSafety.requiredPassengers,['a','b']);
 end=respond(end,'a');assert.equal(end.tripEndSafety.status,'pending');
 assert.throws(()=>safety.claim(end,taxi(),id,uid,'end-one',now+2));
 end=respond(end,'b');assert.equal(end.tripEndSafety.status,'approved');
 assert.equal(safety.claim(end,taxi(),id,uid,'end-one',now+2).tripCompletion.mode,'agreed_early_end');
 const changed={...end,passengers:{...end.passengers,c:{status:'in_transit',authUid:'c',pinVerifiedAt:1}}};
 assert.throws(()=>safety.claim(changed,taxi(),id,uid,'end-one',now+2));
});
test('cash receipt follows both confirmations and records an agreed early dropoff instead of a false arrival',()=>{
 const {action,requireCashDropoff}=require('../functions/go-continuation');
 let trip={...base('cash'),fareStatus:'agreed',finalAmount:100,negotiatedBookingFinalized:true,cashCollectionVersion:2};
 const evidence={role:'driver',nearDestination:false,agreement:{driverId:'d',agreedFare:100,commissionRate:.2,paymentMethod:'cash'},
  payment:{method:'cash',amount:100,status:'cash_due'}};
 trip=request(trip);
 assert.throws(()=>action(trip,'collectCash',{cashCollected:true,endRequestId:'end-one'},evidence,now+1));
 trip=respond(trip);trip=action(trip,'collectCash',{cashCollected:true,endRequestId:'end-one'},evidence,now+2);
 requireCashDropoff(trip);assert.equal(trip.dropoffArrivedAt,undefined);assert.equal(trip.earlyDropoffConfirmedAt,now+2);
 assert.equal(trip.cashCollectionStatus,'collected');
});
