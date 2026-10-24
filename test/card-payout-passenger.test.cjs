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

test('new Card fares use direct subaccounts without an Asiye-funded bank transfer',()=>{
 const f=read('functions/index.js');
 assert.match(f,/subaccount:registered\.subaccountCode/);
 assert.match(f,/bearer:"account"/);
 assert.match(f,/verifyDriverPaystackSplit\(payment,\s*transaction\)/);
 assert.doesNotMatch(f,/paystackRequest\(["']\/transfer(?:recipient)?["']/);
 assert.match(f,/settled_by_paystack_subaccount_or_legacy_review/);
 assert.match(f,/verifiedRequestUser\(request\)/);
 assert.match(read('assets/driver-v2/payout.html'),/Paystack/);
});

test('passenger face capture is required at booking, after social signup',()=>{
 const login=read('assets/passenger-v2/js/login.js');
 const profile=read('assets/passenger-v2/js/profile.js');
 assert.doesNotMatch(login,/uploadProfileImageProxy|phone-otp-required/);
 assert.match(profile,/uploadProfileImageProxy/);
 assert.match(profile,/bookingFaceAuthUid === auth.uid/);
 assert.match(profile,/return await this.scanAndSave\(\)/);
});

test('private Paystack bank tokens and card transfer records reject client writes',()=>{
 const rules=JSON.parse(read('database.rules.json')).rules;
 for(const key of ['driverPayoutAccounts','driverCardPayouts','driverPayoutRefs','driverPayoutQueues']){
 assert.equal(rules[key]['.write'],false);
 assert.match(rules[key]['.read'],/admins/);
 }
});

test('Parcel dispatch follows secure creation and pickup waits for verified Card payment',()=>{
 const p=read('assets/passenger-v2/js/parcels.js');
 const d=read('assets/driver-v2/js/trip-controller.js');
 const backend=read('functions/index.js');
 assert.match(p,/createParcelRequestSecure/);
 assert.match(p,/!\['cash', 'card'\]\.includes\(paymentMethod\)/);
 assert.ok(p.indexOf('notifyGoDrivers(requestId,payload.request)') > p.indexOf('const requestId = payload.requestId'));
 assert.doesNotMatch(p,/ASIYE\.payments\.prepare\(requestId\)/);
 assert.match(backend,/trip\.type === "delivery"/);
 assert.match(d,/Confirm Paystack payment before collecting this parcel/);
 assert.match(d,/parcelTripActionSecure/);
 assert.match(backend,/driverPayoutPath/);
});

test('driver card commission already withheld is not charged as new driver debt',()=>{
 const text=read('assets/driver-v2/js/trip-controller.js');
 assert.match(text,/alreadyWithheldCommission/);
 assert.match(text,/additionalCommissionDebt/);
 assert.match(text,/Number\(additionalCommissionDebt \|\| 0\)/);
});

test('admin can inspect failed and pending payouts without making duplicate transfers',()=>{
 assert.match(read('assets/admin.html'),/Card Payouts · 80\/20/);
 assert.match(read('assets/admin-release.js'),/showCardPayouts/);
 assert.match(read('assets/admin-release.js'),/Needs reconciliation/);
 assert.match(read('functions/index.js'),/"driverCardPayouts"/);
});
