'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {bookingBankingReady}=require('../functions/driver-booking-banking');
const driver={authUid:'driver-auth',payoutStatus:'verified',bankAccountNumber:'1234567890'};
const account={ownerUid:'driver-auth',status:'verified',paystackDomain:'live',subaccountCode:'ACCT_driverexample',platformCommissionPercent:20,accountLast4:'7890'};
test('private settlement verification requires matching identity, environment and 80/20 terms',()=>{
 assert.equal(bookingBankingReady('driver',driver,account,'live'),true);
 assert.equal(bookingBankingReady('driver',driver,account,'test'),false);
 assert.equal(bookingBankingReady('driver',driver,null,'live'),false);
 for(const patch of [{status:'pending_paystack_verification'},{status:'manual_review'},{status:'provisioning'},
  {ownerUid:'another-driver'},{paystackDomain:'test'},{paystackDomain:undefined},
  {subaccountCode:'RCP_wrongmodel'},{platformCommissionPercent:0},{platformCommissionPercent:'20'},{accountLast4:''}])
  assert.equal(bookingBankingReady('driver',driver,{...account,...patch},'live'),false,JSON.stringify(patch));
});
test('legacy and linked profile identities require the correct bank owner',()=>{
 assert.equal(bookingBankingReady('driver-auth',{},account,'live'),true);
 assert.equal(bookingBankingReady('profile',{userUid:'driver-auth'},account,'live'),true);
 assert.equal(bookingBankingReady('another',{},account,'live'),false);
});
