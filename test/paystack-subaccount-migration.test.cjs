'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name),'utf8');
const {PLATFORM_COMMISSION_PERCENT,isVerifiedSubaccount,verifySplit} =
  require('../functions/paystack-subaccount-split');

test('80/20 split: main platform 20%, driver 80%, only verified active drivers', () => {
  assert.equal(PLATFORM_COMMISSION_PERCENT,20);
  const good={subaccount_code:'ACCT_valid123',percentage_charge:20,
    is_verified:true,active:true};
  assert.equal(isVerifiedSubaccount(good,'ACCT_valid123'),true);
  assert.equal(isVerifiedSubaccount({...good,percentage_charge:80},'ACCT_valid123'),false);
  assert.equal(isVerifiedSubaccount({...good,is_verified:false},'ACCT_valid123'),false);
  assert.equal(isVerifiedSubaccount({...good,active:false},'ACCT_valid123'),false);
  assert.equal(isVerifiedSubaccount(good,'ACCT_other'),false);
});
test('Paystack server verification rejects a wrong or missing driver subaccount', () => {
  const paid={splitMode:'paystack_subaccount_80_20',
    subaccountCode:'ACCT_valid123',splitDriverId:'driver1'};
  const verified={subaccount:{subaccount_code:'ACCT_valid123',percentage_charge:20}};
  assert.equal(verifySplit(paid,verified),true);
  assert.equal(verifySplit(paid,{subaccount:'ACCT_other'}),false);
  assert.equal(verifySplit(paid,{}),false);
  assert.equal(verifySplit({...paid,splitMode:'legacy'},verified),false);
  assert.equal(verifySplit(paid,{subaccount:{...verified.subaccount,percentage_charge:80}}),false);
});
test('no Asiye-funded Paystack bank transfer remains in live route',()=>{
  const src=read('functions/index.js');
  assert.doesNotMatch(src,/paystackRequest\(["']\/transfer["']/);
  assert.doesNotMatch(src,/paystackRequest\(["']\/transferrecipient["']/);
  assert.match(src,/paystackRequest\(["']\/subaccount["']/);
  assert.match(src,/percentage_charge:PLATFORM_COMMISSION_PERCENT/);
  assert.match(src,/subaccount:registered\.subaccountCode/);
  assert.match(src,/bearer:"account"/);
  assert.match(src,/verifyDriverPaystackSplit\(payment,\s*transaction\)/);
  assert.match(src,/payment\/driver-subaccount-required/);
});
test('new wallet funding and wallet-paid bookings are disabled without deleting old credits',()=>{
  const src=read('functions/index.js');
  const eft=src.slice(src.indexOf('exports.createEftSmsTopup ='),
    src.indexOf('exports.',src.indexOf('exports.createEftSmsTopup =')+15));
  assert.match(eft,/status\(410\)/);
  const pay=src.slice(src.indexOf('exports.initializePaystackWalletTopup ='),
    src.indexOf('exports.verifyPaystackWalletTopup ='));
  assert.match(pay,/status\(410\)/);
  const prep=src.slice(src.indexOf('async function prepareTripPaymentServer('),
    src.indexOf('async function recordCardTripPaymentHeld('));
  assert.match(prep,/method === 'wallet'/);
  assert.match(read('functions/club-lifecycle.js'),/\["cash", "card"\]\.includes\(body\.paymentMethod/);
  assert.match(src,/async function creditPaystackWallet\(/);
  assert.match(src,/exports.verifyPaystackWalletTopup\s*=/);
});
test('passenger payment chooser and local stored preference are only cash or card',()=>{
  const app=read('assets/passenger-v2/js/app.js');
  const state=read('assets/passenger-v2/js/state.js');
  const chooser=app.slice(app.indexOf('    renderPaymentMethodChooser()'),
    app.indexOf('    bindPaymentMethodChooser('));
  assert.doesNotMatch(chooser,/id:\s*'wallet'/);
  assert.match(chooser,/id:\s*'cash'/);
  assert.match(chooser,/id:\s*'card'/);
  assert.match(state,/\['cash', 'card'\]\.includes/);
  assert.doesNotMatch(read('assets/passenger-v2/index.html'),/data-page="wallet"/);
});
