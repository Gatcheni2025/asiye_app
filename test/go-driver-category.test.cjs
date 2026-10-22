'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('functions/index.js','utf8');
const enrollment=fs.readFileSync('assets/driver-v2/enrollment.html','utf8');
const choices=[...enrollment.match(/<select name="vehicleType"[\s\S]*?<\/select>/)[0].matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]);
const approved=type=>({verificationStatus:'verified',enrollmentVersion:2,vehicleApproved:true,vehicleApprovalStatus:'approved',
 vehicleType:type,vehicle:{type,make:'Toyota',model:'Test',colour:'White',year:2025,registration:'ND123',seats:4},
 phone:'+27821234567',profileImageUrl:'https://example.test/face.jpg',vehiclePhoto:'https://example.test/car.jpg',
 isOnline:true,isBroadcasting:true,latitude:-29.85,longitude:30.95});
async function dispatch(driver){
 let trip={commuterId:'passenger',type:'ehailing',status:'searching',paymentMethod:'cash',finalAmount:65,commuterLocation:{latitude:-29.85,longitude:30.95}};
 const updates={};
 const snapshot=value=>({val:()=>value});
 const database=()=>({ref:p=>({once:async()=>p==='taxis'?{forEach:fn=>fn({key:'driver',val:()=>driver})}:snapshot(trip),update:async patch=>Object.assign(updates,patch)})});
 database.ServerValue={TIMESTAMP:123};
 const context={admin:{database},isGoNegotiationTrip:()=>false,haversineKm:()=>0.1,
  transactGoContinuation:async(ref,update)=>{trip=update(trip);return {committed:!!trip,snapshot:snapshot(trip)};}};
 const guard=source.slice(source.indexOf('function driverProfileCanReceiveRequests('),source.indexOf('async function nearbyWorkDrivers('));
 const start=source.indexOf('function goVehicleCategoryAllowed(');
 const dispatchStart=source.indexOf('async function dispatchGoRideToDrivers(');
 const dispatchEnd=source.indexOf('exports.dispatchGoRideRequest =',dispatchStart);
 vm.createContext(context);vm.runInContext(guard+source.slice(start<0?dispatchStart:start,dispatchEnd)+'\nthis.send=dispatchGoRideToDrivers;',context);
 const result=await context.send('ride','passenger');return {result,trip,updates};
}
for(const type of choices)test(`approved enrollment category ${type} receives a Go offer`,async()=>{
 const {result,trip,updates}=await dispatch(approved(type));
 assert.equal(result.mode,'broadcast',`Registration category ${type} must not be silently excluded`);
 assert.equal(trip.driverFoundCount,1);assert.equal(updates['notifications/taxis/driver/ride'].fare,65);
});
test('approved nested category wins over a stale legacy category and normalizes case/spacing',async()=>{
 const driver=approved('sedan');driver.vehicle.type=' HATCHBACK ';driver.vehicleType='obsolete-category';
 assert.equal((await dispatch(driver)).result.mode,'broadcast');
});
test('legacy Go labels still work and unavailable, unapproved or unsupported vehicles stay excluded',async()=>{
 for(const type of ['ehailing','e-hailing','go','car'])assert.equal((await dispatch(approved(type))).result.mode,'broadcast');
 for(const patch of [{isOnline:false},{isBroadcasting:false},{vehicleApproved:false},{verificationStatus:'pending',provisionalActivation:false},
  {vehiclePhoto:''},{latitude:undefined},{vehicle:{...approved('sedan').vehicle,type:'bicycle'},vehicleType:'bicycle'}]){
  const {result,updates}=await dispatch({...approved('sedan'),...patch});assert.equal(result.mode,'none');assert.deepEqual(updates,{});
 }
});

test('staging correction deploys both dispatch callers within the existing 41-function scope',()=>{
 const {NAMES}=require('../scripts/deploy_staging_go_dispatch.cjs');
 assert.deepEqual(NAMES,['submitGoFareOffer','dispatchGoRideRequest']);
 const scope=new Set([...require('../scripts/paystack_function_manifest.json'),...require('../scripts/auth_booking_staging_functions.json'),...require('../scripts/staging_driver_admin_functions.json')]);
 assert.equal(scope.size,41);assert.ok(NAMES.every(name=>scope.has(name)));
});


test('registration offers exactly Sedan and Hatchback',()=>{
 assert.deepEqual(choices,['sedan','hatchback']);
});
const guardSource=source.slice(source.indexOf('function driverProfileCanReceiveRequests('),source.indexOf('async function nearbyWorkDrivers('));
const canReceive=vm.runInNewContext(guardSource+'\ndriverProfileCanReceiveRequests;');
const uiSource=fs.readFileSync('assets/driver-v2/js/app.js','utf8');
const uiStart=uiSource.indexOf('    hasApprovedVehicle(');
const uiEnd=uiSource.indexOf('    /* ========================================================',uiStart);
const uiApproved=vm.runInNewContext('({'+uiSource.slice(uiStart,uiEnd)+'}).hasApprovedVehicle;');
for(const type of ['suv','minibus'])test(`${type} cannot receive Go/Club/Parcel requests or go online, including legacy-field conflicts`,async()=>{
 for(const field of ['vehicle','vehicleType','carCategory']){
  const driver=approved('sedan');
  if(field==='vehicle')driver.vehicle.type=' '+type.toUpperCase()+' ';
  else driver[field]=' '+type.toUpperCase()+' ';
  assert.equal((await dispatch(driver)).result.mode,'none');
  assert.equal(canReceive(driver),false);
  assert.equal(canReceive(driver,{requiredSeats:4}),false);
  assert.equal(uiApproved(driver),false);
 }
 const legacy={...approved('go'),enrollmentVersion:1};
 delete legacy.vehicleApproved;delete legacy.vehicleApprovalStatus;legacy.vehicleType=type;
 assert.equal(canReceive(legacy),false);assert.equal(uiApproved(legacy),false);
});
test('supported physical categories pass the dashboard and shared seat-capacity gate',()=>{
 for(const type of choices){
  const driver=approved(type);assert.equal(uiApproved(driver),true);
  assert.equal(canReceive(driver,{requiredSeats:4}),true);
  assert.equal(canReceive(driver,{requiredSeats:5}),false);
 }
});

test('staging vehicle rollout covers submission, approval, matching and acceptance and the protected update endpoint',()=>{
 const {NAMES}=require('../scripts/deploy_staging_vehicle_eligibility.cjs');
 const scope=require('../scripts/audit_347_staging_readonly.cjs').manifest();
 assert.equal(NAMES.length,17);assert.equal(scope.length,42);
 for(const name of ['submitDriverEnrollmentSecure','reviewDriverEnrollmentSecure','submitDriverVehicleForReview',
  'submitGoFareOffer','dispatchGoRideRequest','acceptGoFareOffer','acceptGoFareCounter','counterGoFare',
  'acceptParcelRequestSecure','createClubBookingSecure','joinClubPoolSecure','synchronizeClubBooking','expireClubWaiting'])
  assert.ok(NAMES.includes(name),name);
 assert.ok(NAMES.every(name=>scope.includes(name)));
});
