const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const {
  splitCardFare,stableTransferReference,isVerifiedCardPayment,
  isPayoutReady,bankInput
}=require('../functions/driver-card-payout');

test('80/20 card payout uses cents with no money lost',()=>{
  assert.deepEqual(splitCardFare(10000),{
    grossSubunit:10000,driverSubunit:8000,asiyeSubunit:2000,
    driverShare:80,asiyeShare:20,currency:'ZAR'
  });
  assert.deepEqual(splitCardFare(101),{
    grossSubunit:101,driverSubunit:80,asiyeSubunit:21,
    driverShare:80,asiyeShare:20,currency:'ZAR'
  });
  assert.throws(()=>splitCardFare(49.5));
  assert.throws(()=>splitCardFare(-1));
});

test('repeated payout attempts produce same Paystack transfer reference',()=>{
 const a=stableTransferReference('trip_1','p_1');
 assert.equal(a,stableTransferReference('trip_1','p_1'));
 assert.notEqual(a,stableTransferReference('trip_1','p_2'));
 assert.match(a,/^asiye_card_[a-f0-9]{32}$/);
});

test('card payout rejects refunds, altered amounts and unverified charges',()=>{
 const payment={provider:'paystack',method:'card',status:'captured',
  reference:'ref-12345678',amountSubunit:10000};
 const verified={status:'success',reference:payment.reference,
  amount:10000,currency:'ZAR'};
 assert.equal(isVerifiedCardPayment(payment,verified),true);
 assert.equal(isVerifiedCardPayment(payment,{...verified,amount:1000}),false);
 assert.equal(isVerifiedCardPayment({...payment,status:'refunded'},verified),false);
 assert.equal(isVerifiedCardPayment(payment,{...verified,status:'failed'}),false);
});

test('no bank, uncompleted trip or wrong driver means no payout',()=>{
 const trip={status:'completed',taxiId:'driver-1'};
 const payment={method:'card',status:'captured'};
 const banking={status:'verified',recipientCode:'RCP_abcdef123'};
 assert.equal(isPayoutReady({trip,payment,driverId:'driver-1',banking}),true);
 assert.equal(isPayoutReady({trip:{...trip,status:'pending'},payment,driverId:'driver-1',banking}),false);
 assert.equal(isPayoutReady({trip,payment,driverId:'another',banking}),false);
 assert.equal(isPayoutReady({trip,payment,driverId:'driver-1',banking:{status:'pending'}}),false);
});

test('bank setup rejects malformed verification fields',()=>{
 const good={bankCode:'051001',accountNumber:'123456789',accountName:'Test Driver',
  accountType:'personal',documentType:'identityNumber',documentNumber:'8012271234088'};
 assert.equal(bankInput(good).accountNumber,'123456789');
 assert.throws(()=>bankInput({...good,accountNumber:'abc'}));
 assert.throws(()=>bankInput({...good,documentNumber:''}));
});

test('payout status is driven by signed transfer webhook only',()=>{
 const f=read('functions/index.js');
 assert.match(f,/disburseCompletedCardTrips/);
 assert.match(f,/status !== "completed"/);
 assert.match(f,/paystackRequest\("\/transfer"/);
 assert.match(f,/event\.event === "transfer\.success"/);
 assert.match(f,/transaction\(current =>/);
 assert.match(f,/needs_reconciliation/);
 assert.match(f,/verifiedRequestUser\(request\)/);
 assert.match(read('assets/driver-v2/payout.html'),/Paystack/);
});

test('passenger phone registration requires saved name and face photo',()=>{
 const login=read('assets/passenger-v2/js/login.js');
 const app=read('assets/passenger-v2/js/app.js');
 assert.match(login,/AsiyePassengerOnboarding\?\.photo/);
 assert.match(login,/uploadProfileImageProxy/);
 assert.match(login,/onboardingCompleted: true/);
 assert.match(login,/this\.showStep\('newPassengerStep'\)/);
 assert.match(app,/authUser\.phoneNumber && !/);
 assert.match(read('assets/passenger-v2/login.html'),/scanPassengerFace/);
});

test('private Paystack bank tokens and card transfer records reject client writes',()=>{
 const rules=JSON.parse(read('database.rules.json')).rules;
 for(const key of ['driverPayoutAccounts','driverCardPayouts','driverPayoutRefs','driverPayoutQueues']){
 assert.equal(rules[key]['.write'],false);
 assert.match(rules[key]['.read'],/admins/);
 }
});
