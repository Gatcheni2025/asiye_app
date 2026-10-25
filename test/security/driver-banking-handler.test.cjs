'use strict';
// Real exported handler and isolated RTDB; identity/Paystack HTTP are simulated.
const {test,before,beforeEach,after}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../../functions/node_modules/firebase-admin');
const project='demo-asiye-driver-banking',subaccount='ACCT_exampledriver';
let app,db,handlers,originalFetch,originalVerify,originalSecret,calls,validated,verified;
const bank={driverId:'driver',bankCode:'250655',accountName:'Example Driver',
 accountNumber:'1234567890',accountType:'personal',documentType:'identityNumber',documentNumber:'8001015009087'};
before(()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
 assert.match(host||'',/^(127\.0\.0\.1|localhost):\d+$/);
 app=admin.initializeApp({projectId:project,databaseURL:'http://'+host+'?ns='+project});db=app.database();
 originalVerify=admin.auth().verifyIdToken;admin.auth().verifyIdToken=async uid=>({uid});
 originalFetch=global.fetch;originalSecret=process.env.PAYSTACK_SECRET_KEY;
 process.env.PAYSTACK_SECRET_KEY='sk_live_EMULATOR_ONLY_NO_NETWORK';
 global.fetch=async(url,options={})=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.paystack.co');calls.push({u,options});
  let data;
  if(u.pathname==='/bank')data=[{name:'Example Bank',code:'250655',active:true},{name:'Inactive',code:'1',active:false}];
  else if(u.pathname==='/bank/validate')data={verified:validated,accountAcceptsCredits:true,accountHolderMatch:validated};
  else if(u.pathname==='/subaccount'||u.pathname==='/subaccount/'+subaccount)data={
   subaccount_code:subaccount,percentage_charge:20,active:true,is_verified:verified,
   domain:'live',currency:'ZAR',account_number:bank.accountNumber,settlement_bank:'Example Bank'};
  else assert.fail('Unexpected provider operation');
  return {ok:true,status:200,json:async()=>({status:true,data})};
 };
 handlers=require('../../functions/index');
});
beforeEach(async()=>{
 calls=[];validated=true;verified=false;
 await db.ref().set({taxis:{driver:{authUid:'driver-auth',userUid:'driver-auth',name:'Driver',
  verificationStatus:'verified',vehicleApproved:true,vehicleType:'go',vehicleReg:'ND12345',
  vehicleMake:'Toyota',vehicleModel:'Corolla',vehicleColor:'White',vehicleYear:2025,vehicleSeats:4,
  vehiclePhoto:'https://example.test/car.jpg',profileImageUrl:'https://example.test/face.jpg',phone:'0711234567'}}});
});
after(async()=>{
 global.fetch=originalFetch;admin.auth().verifyIdToken=originalVerify;
 if(originalSecret===undefined)delete process.env.PAYSTACK_SECRET_KEY;else process.env.PAYSTACK_SECRET_KEY=originalSecret;
 await app.delete();
});
async function call(uid,method='GET',body={},action='status'){
 const headers=uid?{authorization:'Bearer '+uid}:{},r={status:200};
 const res={status(n){r.status=n;return this;},set(){return this;},json(v){r.body=v;return this;},send(v){r.body=v;return this;}};
 await handlers.configureDriverCardPayout({method,body,query:{driverId:'driver',action},headers,get:k=>headers[k.toLowerCase()]||''},res);
 return r;
}
const read=async p=>(await db.ref(p).once('value')).val();
test('only the signed-in owner of an approved driver and vehicle can configure or read the bank',async()=>{
 assert.equal((await call(null)).status,401);
 assert.equal((await call('unrelated-auth')).status,403);
 assert.equal((await call('unrelated-auth','POST',bank)).status,403);
 await db.ref('taxis/driver/vehicleApproved').set(false);
 assert.equal((await call('driver-auth','POST',bank)).status,403);
 assert.equal(calls.length,0);
});
test('supported South African verification banks are fetched without creating a subaccount or charge',async()=>{
 const r=await call('driver-auth','GET',{},'banks');assert.equal(r.status,200);
 assert.deepEqual(r.body.banks,[{name:'Example Bank',code:'250655'}]);
 assert.equal(calls[0].u.searchParams.get('currency'),'ZAR');
 assert.equal(calls[0].u.searchParams.get('enabled_for_verification'),'true');
 assert.equal(await read('driverPaystackSubaccounts/driver'),null);
});
test('a bank-holder mismatch cannot create a payout profile',async()=>{
 validated=false;const r=await call('driver-auth','POST',bank);assert.equal(r.status,422);
 assert.equal(await read('driverPaystackSubaccounts/driver'),null);
 assert.deepEqual(calls.map(c=>c.u.pathname),['/bank/validate']);
});
test('bank submission creates the 80/20 destination once, persists no full bank or ID number, then verifies on refresh',async()=>{
 const r=await call('driver-auth','POST',bank);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.status,'pending_paystack_verification');
 const created=calls.find(c=>c.u.pathname==='/subaccount');
 assert.equal(JSON.parse(created.options.body).percentage_charge,20);
 const saved=await read('driverPaystackSubaccounts/driver');assert.equal(saved.ownerUid,'driver-auth');
 assert.equal(saved.accountLast4,'7890');assert.equal(saved.platformCommissionPercent,20);
 assert.equal(JSON.stringify(saved).includes(bank.accountNumber),false);
 assert.equal(JSON.stringify(saved).includes(bank.documentNumber),false);
 assert.equal((await call('driver-auth','POST',bank)).status,409);
 assert.equal(calls.filter(c=>c.u.pathname==='/subaccount').length,1);
 assert.equal((await call('driver-auth')).body.status,'pending_paystack_verification');
 verified=true;const refreshed=await call('driver-auth');assert.equal(refreshed.body.status,'verified');
 assert.equal(await read('taxis/driver/payoutStatus'),'verified');
 assert.equal(calls.some(c=>c.u.pathname.includes('transaction')||c.u.pathname.includes('transfer')),false);
});
