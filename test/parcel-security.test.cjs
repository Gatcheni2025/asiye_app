'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const secure=require('../functions/parcel-security');
const id='-000000000000000001';
function create(method='card'){
 return secure.createParcelRecord({
   pickup:{latitude:-29.85,longitude:30.95,address:'Pickup'},
   destination:{latitude:-29.80,longitude:30.99,address:'Destination'},
   routeDistanceKm:9,routeDurationMinutes:17, paymentMethod:method,
   recipientName:'Test Recipient',recipientPhone:'0711234567',parcelDescription:'Documents'
 },{id:'passenger1',name:'Passenger'},id,1000);
}
function assigned(method='card'){
 const trip=create(method);
 return {...trip,taxiId:'driver1',status:'accepted',
   paymentStatus:method==='card'?'held':'cash_due',paymentsReady:true};
}
function evidence(method='card'){
 return {driverReserved:true,nearPickup:true,nearDestination:true,
 ledger:method==='card'?{
   method:'card',status:'held',splitDriverId:'driver1',
   splitMode:'paystack_subaccount_80_20',amount:assigned('card').finalAmount
 }:{method:'cash',status:'cash_due'}};
}
const advance=(trip,name,pin,proof,now)=>secure.action(trip,name,pin,'4729',proof,now);
test('server computes Parcel fare and hides PIN from public trip',()=>{
 const t=create();
 assert.equal(t.parcelSecurityVersion,2);
 assert.equal(t.pickupPin,null);
 assert.ok(t.finalAmount>0);
 assert.equal(t.paymentStatus,'awaiting_driver');
 assert.throws(()=>create('wallet'),/Only Cash or Card/);
 assert.throws(()=>secure.createParcelRecord({pickup:{latitude:-29,longitude:30},
  destination:{latitude:-29,longitude:30},paymentMethod:'card'},
  {id:'p'},id,100),/distance/);
});
test('Parcel Card requires bank split, correct driver, correct amount and captured/held payment',()=>{
 const t=assigned();
 for(const invalid of [
   {},{...evidence().ledger,splitDriverId:'driver2'},
   {...evidence().ledger,amount:1},
   {...evidence().ledger,status:'initialized'},
   {...evidence().ledger,splitMode:'legacy_transfer'}]){
   assert.throws(()=>advance(t,'onWay',null,{...evidence(),ledger:invalid},2000),/payment/);
 }
 assert.equal(advance(t,'onWay',null,evidence(),2000).status,'driver_on_way');
});
test('driver must have live assigned reservation and fresh near-pickup GPS',()=>{
 const t=assigned('cash'),e=evidence('cash');
 assert.throws(()=>advance(t,'onWay',null,{...e,driverReserved:false},2000),/reservation/i);
 const onWay=advance(t,'onWay',null,e,2000);
 assert.throws(()=>advance(onWay,'arrive',null,{...e,nearPickup:false},3000),/GPS/);
 const arrived=advance(onWay,'arrive',null,e,3000);
 assert.equal(arrived.status,'arrived');
 assert.throws(()=>advance(onWay,'verifyPin','4729',e,4000),/arrive/i);
});
test('wrong PIN never starts journey; five failed attempts lock it',()=>{
 let t=advance(advance(assigned('cash'),'onWay',null,evidence('cash'),2000),
   'arrive',null,evidence('cash'),3000);
 for(let i=1;i<=5;i++){
   t=advance(t,'verifyPin','0000',evidence('cash'),3000+i);
   assert.equal(t.pinAttempts,i);
   assert.equal(t.status,'arrived');
 }
 assert.throws(()=>advance(t,'verifyPin','4729',evidence('cash'),4000),/locked/);
});
test('successful PIN starts transit only once, with no WhatsApp share gate',()=>{
 const e=evidence(),t=advance(advance(assigned(),'onWay',null,e,2000),'arrive',null,e,3000);
 assert.throws(()=>advance(t,'verifyPin','4729',{...e,nearPickup:false},3001),/pickup/);
 const ride=advance(t,'verifyPin','4729',e,3002);
 assert.equal(ride.status,'in_transit');
 assert.equal(ride.pinVerifiedAt,3002);
 assert.equal(advance(ride,'verifyPin','4729',e,3003).pinVerifiedAt,3002);
});
test('completion is blocked until settled, PIN verified and near destination',()=>{
 let proof=evidence();
 let t=advance(advance(assigned(),'onWay',null,proof,2000),'arrive',null,proof,3000);
 assert.throws(()=>advance(t,'complete',null,proof,4000),/PIN/);
 t=advance(t,'verifyPin','4729',proof,4000);
 assert.throws(()=>advance(t,'complete',null,proof,5000),/Settle/);
 t={...t,paymentSettlementStatus:'settled'};
 assert.throws(()=>advance(t,'complete',null,{...proof,nearDestination:false},5000),/GPS/);
 assert.throws(()=>advance(t,'complete',null,proof,5000),/Paystack/);
 proof={...proof,ledger:{...proof.ledger,status:'captured'}};
 const done=advance(t,'complete',null,proof,5000);
 assert.equal(done.status,'completed');
 assert.equal(advance(done,'complete',null,{driverReserved:false},6000).completedAt,5000);
});
test('server PIN APIs enforce passenger-only access and protected driver ownership',()=>{
 const backend=read('functions/index.js');
 assert.match(backend,/exports\.createParcelRequestSecure/);
 assert.match(backend,/exports\.getParcelPickupPinSecure/);
 assert.match(backend,/exports\.parcelTripActionSecure/);
 assert.match(backend,/profileOwnedByAuth\("commuters",trip\.commuterId,user\.uid\)/);
 assert.match(backend,/profileOwnedByAuth\("taxis",trip\.taxiId,user\.uid\)/);
 assert.match(backend,/parcelSecurity\.action\(current,name,req\.body\?\.pin/);
 assert.match(backend,/Secure Parcel pickup PIN must be verified before settlement/);
 const driver=read('assets/driver-v2/js/trip-controller.js');
 assert.match(driver,/this\.parcelAction\('verifyPin'/);
 assert.match(driver,/this\.parcelAction\('complete'/);
 assert.match(driver,/this\.parcelAction\('arrive'/);
 const publicRequest=read('assets/passenger-v2/js/parcels.js');
 assert.doesNotMatch(publicRequest,/requirePassengerPin\(\)/);
 assert.match(publicRequest,/createParcelRequestSecure/);
 const rules=JSON.parse(read('database.rules.json')).rules;
 assert.equal(rules.parcelPrivate['.read'],false);
 assert.equal(rules.parcelPrivate['.write'],false);
 assert.match(rules.requests['$request']['.write'],/newData\.child\('type'\)\.val\(\) !== 'delivery'/);
 assert.match(rules.requests['$request']['.validate'],/parcelSecurityVersion/);
});
