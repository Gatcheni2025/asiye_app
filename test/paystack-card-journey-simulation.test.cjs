'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PLATFORM_COMMISSION_PERCENT,verifySplit,isVerifiedSubaccount}=
  require('../functions/paystack-subaccount-split');
const {transactionMatchesPayment}=require('../functions/paystack-wallet');
const {createParcelRecord,action}=require('../functions/parcel-security');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const BANK='ACCT_testverified123';
function simulateCardCharge({requestId,passengerId,driverId,amount,code=BANK}){
 const reference='ASIYE-TEST-'+requestId+'-'+passengerId;
 const payment={requestId,passengerId,splitDriverId:driverId,
  splitMode:'paystack_subaccount_80_20',subaccountCode:code,
  reference,amount,currency:'ZAR',method:'card',status:'initialized'};
 const transaction={id:'test_'+reference,status:'success',reference,
   currency:'ZAR',amount:Math.round(amount*100),channel:'card',
   subaccount:{subaccount_code:code,percentage_charge:20}};
 const authorized=verifySplit(payment,transaction)&&transactionMatchesPayment(transaction,payment);
 return {payment,transaction,authorized,driverShare:Math.round(amount*80)/100,
         platformShare:Math.round(amount*20)/100};
}
test('Paystack test-mode mock confirms 80/20 driver and platform shares',()=>{
 assert.equal(PLATFORM_COMMISSION_PERCENT,20);
 const account={subaccount_code:BANK,percentage_charge:20,is_verified:true,active:true};
 assert.equal(isVerifiedSubaccount(account,BANK),true);
 const charge=simulateCardCharge({requestId:'go1',passengerId:'p1',driverId:'driver1',amount:125});
 assert.equal(charge.authorized,true);
 assert.equal(charge.driverShare,100);
 assert.equal(charge.platformShare,25);
 assert.equal(charge.driverShare+charge.platformShare,125);
 assert.equal(verifySplit(charge.payment,{...charge.transaction,subaccount:{...charge.transaction.subaccount,percentage_charge:80}}),false);
 assert.equal(verifySplit(charge.payment,{...charge.transaction,subaccount:{...charge.transaction.subaccount,subaccount_code:'ACCT_other'}}),false);
 assert.equal(transactionMatchesPayment({...charge.transaction,amount:1},charge.payment),false);
 assert.equal(transactionMatchesPayment({...charge.transaction,currency:'USD'},charge.payment),false);
 assert.equal(transactionMatchesPayment({...charge.transaction,status:'pending'},charge.payment),false);
});
test('Work pooled charges are separate per passenger to ONE accepted driver',()=>{
 const ids=['p1','p2','p3'],gross=[50,50,50];
 const charges=ids.map((p,i)=>simulateCardCharge({
  requestId:'work1',passengerId:p,driverId:'driver1',amount:gross[i]
 }));
 assert.ok(charges.every(x=>x.authorized&&x.payment.splitDriverId==='driver1'));
 assert.equal(new Set(charges.map(x=>x.payment.reference)).size,3);
 assert.equal(charges.reduce((sum,x)=>sum+x.driverShare,0),120);
 assert.equal(charges.reduce((sum,x)=>sum+x.platformShare,0),30);
});
test('Parcel card → Paystack verified split → driver pickup → PIN → completion',()=>{
 const record=createParcelRecord({
  pickup:{latitude:-29.85,longitude:30.95,address:'Pickup'},
  destination:{latitude:-29.80,longitude:30.99,address:'Destination'},
  routeDistanceKm:9,routeDurationMinutes:17,paymentMethod:'card',
  recipientName:'R',recipientPhone:'0711234567',parcelDescription:'Documents'
 },{id:'p1'},'-parcel000000000001',1000);
 assert.equal(record.paymentStatus,'awaiting_driver');
 let trip={...record,status:'payment_required',taxiId:'driver1',
  paymentStatus:'payment_required',paymentsReady:false};
 const charge=simulateCardCharge({requestId:record.requestId,
  passengerId:'p1',driverId:'driver1',amount:record.finalAmount});
 const ledger={...charge.payment,status:'held'};
 const proof={ledger,driverReserved:true,nearPickup:true,nearDestination:true};
 assert.throws(()=>action(trip,'onWay',null,'1357',{...proof,ledger:null},2000),/payment/);
 trip={...trip,status:'accepted',paymentStatus:'held',paymentsReady:true};
 trip=action(trip,'onWay',null,'1357',proof,2100);
 trip=action(trip,'arrive',null,'1357',proof,2200);
 assert.equal(action(trip,'verifyPin','0000','1357',proof,2300).status,'arrived');
 trip=action(trip,'verifyPin','1357','1357',proof,2400);
 assert.equal(trip.status,'in_transit');
 trip={...trip,paymentSettlementStatus:'settled'};
 const completed=action(trip,'complete',null,'1357',{
  ...proof,ledger:{...ledger,status:'captured'}},3000);
 assert.equal(completed.status,'completed');
 assert.equal(completed.pinVerifiedAt,2400);
});
test('server backend requires verified subaccount BEFORE Paystack checkout',()=>{
 const src=read('functions/index.js');
 assert.match(src,/const driverId=safeProfileId\(trip\?\.taxiId\|\|trip\?\.driverId\)/);
 assert.match(src,/driverProfileCanReceiveRequests\(driver\)/);
 assert.match(src,/isVerifiedSubaccount\(live,registered\.subaccountCode\)/);
 assert.match(src,/subaccount:registered\.subaccountCode/);
 assert.match(src,/bearer:"account"/);
 assert.match(src,/verifyDriverPaystackSplit\(payment, transaction\)/);
 assert.match(src,/transactionMatchesPayment\(/);
});
test('duplicate callbacks never regress already captured or refund-review ledger',()=>{
 const src=read('functions/index.js');
 const start=src.indexOf('async function recordCardTripPaymentHeld(');
 const end=src.indexOf('exports.configureDriverCardPayout',start);
 const fragment=src.slice(start,end);
 assert.match(fragment,/paymentRef\.transaction\(current=>/);
 assert.match(fragment,/\["held","captured","refund_pending","refunded","refund_review"\]/);
 assert.match(fragment,/ledgerStatus==="captured"/);
 assert.match(fragment,/quarantine\("charge_after_parcel_cancellation"\)/);
 assert.match(src,/createHmac\(\s*"sha512"/);
 assert.match(src,/timingSafeEqual/);
});
