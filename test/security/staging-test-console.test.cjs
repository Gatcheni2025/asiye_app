'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const admin=require('../../functions/node_modules/firebase-admin');
const {HttpsError}=require('node:module').createRequire(require.resolve('../../functions/package.json'))('firebase-functions/v2/https');
const {makeStagingTestConsole,PROJECT}=require('../../functions/staging-test-console');
const tester={auth:{uid:'tester',token:{stagingTripTester:true}}};
let app,db,api,domain,project,provider,providerCalls;
before(()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;assert.match(host||'',/^(127\.0\.0\.1|localhost):\d+$/);
 const ns='demo-asiye-staging-test-console';app=admin.initializeApp({projectId:ns,databaseURL:`http://${host}?ns=${ns}`});db=app.database();
 api=makeStagingTestConsole({admin,projectId:()=>project,paymentDomain:()=>domain,HttpsError,
  driverEligible:driver=>driver.vehicleApproved===true,
  paystackRequest:async path=>{providerCalls.push(path);return {data:provider};}});
});
beforeEach(async()=>{
 project=PROJECT;domain='test';providerCalls=[];
 provider={domain:'test',subaccount_code:'ACCT_testdriver',percentage_charge:20,is_verified:true,active:true,
  account_number:'1234567890',business_name:'Staging TEST bank',settlement_bank:'TEST bank'};
 await db.ref().set({taxis:{driver:{authUid:'driver-auth',name:'Test Driver',vehicleApproved:true,currentRequest:'ride',isOnline:true,
  isBroadcasting:true,isFull:true,passengerCount:1,walletBalance:29,totalEarnings:500,bookingQueue:{ride:{requestId:'ride'},newer:{requestId:'newer'}}}},
  commuters:{passenger:{currentRequest:'ride'},member:{currentRequest:'ride'}},
  requests:{ride:{requestId:'ride',createdAt:1,type:'ehailing',taxiId:'driver',commuterId:'passenger',status:'payment_required',paymentMethod:'card',agreedFare:100}},
  notifications:{taxis:{driver:{ride:{requestId:'ride'},newer:{requestId:'newer'}}}}});
});
after(async()=>{await app.delete();});
const read=async path=>(await db.ref(path).once('value')).val();
const cancel=(extra={})=>api({action:'cancelTrip',requestId:'ride',expectedStatus:'payment_required',confirmation:'ride',reason:'Reset this staging test booking',...extra},tester);
test('only the separate tester role in the exact staging project with TEST configuration may use the service',async()=>{
 for(const context of [{},{auth:{uid:'passenger',token:{}}},{auth:{uid:'reviewer',token:{enrollmentReviewer:true}}}])
  await assert.rejects(()=>api({action:'list'},context));
 project='asiye-80386';await assert.rejects(()=>api({action:'list'},tester),e=>e.code==='permission-denied');
 project=PROJECT;domain='live';await assert.rejects(()=>api({action:'list'},tester),e=>e.code==='failed-precondition');
 assert.equal(providerCalls.length,0);domain='test';assert.equal((await api({action:'session'},tester)).uid,'tester');
});
test('TEST subaccount linkage verifies the provider and never overwrites a different or unresolved account',async()=>{
 for(const patch of [{domain:'live'},{active:false},{is_verified:false},{percentage_charge:80},{subaccount_code:'ACCT_other'}]){
  const old=provider;provider={...provider,...patch};
  await assert.rejects(()=>api({action:'linkTestSubaccount',driverId:'driver',subaccountCode:'ACCT_testdriver'},tester));provider=old;
  assert.equal(await read('driverPaystackSubaccounts/driver'),null);
 }
 await api({action:'linkTestSubaccount',driverId:'driver',subaccountCode:'ACCT_testdriver'},tester);
 const saved=await read('driverPaystackSubaccounts/driver');assert.equal(saved.ownerUid,'driver-auth');assert.equal(saved.paystackDomain,'test');
 assert.equal(saved.platformCommissionPercent,20);assert.equal(saved.accountLast4,'7890');assert.equal(saved.account_number,undefined);
 assert.equal(await read('taxis/driver/payoutStatus'),'verified');
 provider={...provider,subaccount_code:'ACCT_changed'};
 await assert.rejects(()=>api({action:'linkTestSubaccount',driverId:'driver',subaccountCode:'ACCT_changed'},tester));
 assert.equal(await read('driverPaystackSubaccounts/driver/subaccountCode'),'ACCT_testdriver');
});
test('active trip cancellation clears matching locks and queue items, preserves balances and records one audit on retry',async()=>{
 await db.ref('requests/ride').update({type:'club',passengers:{passenger:{status:'waiting'},member:{status:'waiting'}}});
 assert.equal((await cancel()).status,'cancelled_by_admin');
 const driver=await read('taxis/driver');assert.equal(driver.currentRequest,undefined);assert.equal(driver.isOnline,false);
 assert.equal(driver.passengerCount,0);assert.equal(driver.bookingQueue.ride,undefined);assert.ok(driver.bookingQueue.newer);
 assert.equal(driver.walletBalance,29);assert.equal(driver.totalEarnings,500);
 assert.equal(await read('commuters/member/currentRequest'),null);assert.equal(await read('commuters/passenger/currentRequest'),null);
 assert.equal(await read('notifications/taxis/driver/ride'),null);assert.ok(await read('notifications/taxis/driver/newer'));
 await db.ref('taxis/driver').update({currentRequest:'newer',isOnline:true,isBroadcasting:true,passengerCount:3});
 await db.ref('commuters/passenger/currentRequest').set('newer');await cancel();
 assert.equal(await read('taxis/driver/currentRequest'),'newer');assert.equal(await read('taxis/driver/passengerCount'),3);
 assert.equal(await read('commuters/passenger/currentRequest'),'newer');assert.equal(Object.keys(await read('adminAudit')).length,1);
});
test('started staging test trips can be ended without marking money refunded or crediting earnings',async()=>{
 await db.ref('requests/ride').update({status:'in_transit',tripStartedAt:10,paymentStatus:'held'});
 await db.ref('tripPayments/ride/passenger').set({method:'card',paystackDomain:'test',status:'held',amount:100,reference:'unchanged'});
 const result=await cancel({expectedStatus:'in_transit'});assert.equal(result.needsPaymentReview,true);
 assert.equal((await read('tripPayments/ride/passenger')).status,'held');assert.equal(await read('taxis/driver/totalEarnings'),500);
 assert.equal(await read('stagingTestPaymentReviews/ride/status'),'check_test_refund');
});
test('wrong confirmation, stale status, completed trips and LIVE/unclassified payment records cannot be cancelled',async()=>{
 await assert.rejects(()=>cancel({confirmation:'another-trip'}));await assert.rejects(()=>cancel({expectedStatus:'searching'}));
 for(const mode of ['live','unknown']){
  await db.ref('tripPayments/ride/passenger').set({method:'card',paystackDomain:mode,status:'held'});
  await assert.rejects(()=>cancel());assert.equal(await read('requests/ride/status'),'payment_required');
 }
 await db.ref('tripPayments/ride').remove();await db.ref('requests/ride/status').set('completed');
 await assert.rejects(()=>cancel({expectedStatus:'completed'}));assert.equal(await read('requests/ride/status'),'completed');
});
test('test-trip listing returns canonical IDs and redacted driver setup, excluding completed trips and account numbers',async()=>{
 await db.ref('requests/done').set({status:'completed',createdAt:2});
 await db.ref('requests/ride/id').set('forged-id');await db.ref('taxis/driver/banking').set({accountNumber:'PRIVATE_BANK_NUMBER'});
 const result=await api({action:'list'},tester);assert.equal(result.trips.length,1);assert.equal(result.trips[0].id,'ride');
 assert.equal(result.trips[0].driver.payoutStatus,'not_configured');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
