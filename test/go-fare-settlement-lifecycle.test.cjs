const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const functionsSource = fs.readFileSync(
  'functions/index.js',
  'utf8'
);
const bookingSource = fs.readFileSync(
  'assets/passenger-v2/js/booking.js',
  'utf8'
);
const walletSource = fs.readFileSync(
  'assets/passenger-v2/js/wallet.js',
  'utf8'
);
const driverTripSource = fs.readFileSync(
  'assets/driver-v2/js/trip-controller.js',
  'utf8'
);
const payout = require('../functions/driver-card-payout');

test('agreed fare is always preferred by payment amount resolution', () => {
  const start = functionsSource.indexOf(
    'function tripPassengerFare'
  );
  const block = functionsSource.slice(start, start + 900);

  assert.ok(start >= 0);
  assert.ok(
    block.indexOf('trip?.agreedFare') <
    block.indexOf('trip?.finalAmount')
  );
});

test('private Go agreement locks fare, driver, commission and payment method', () => {
  const start = functionsSource.indexOf(
    'async function reserveGoNegotiatedDriver'
  );
  const block = functionsSource.slice(start, start + 12000);

  for (const required of [
    'goFareAgreementPath',
    'agreementRef.transaction',
    'agreedFare:',
    'driverId:',
    'commissionRate:',
    'platformCommission:',
    'driverNetFare:',
    'paymentMethod:',
    'currency:'
  ]) {
    assert.ok(
      block.includes(required),
      `missing protected agreement field: ${required}`
    );
  }
});

test('all payment methods are blocked unless they match the protected agreement', () => {
  const start = functionsSource.indexOf(
    'async function prepareTripPaymentServer'
  );
  const block = functionsSource.slice(start, start + 9000);

  assert.ok(block.includes('payment/fare-not-agreed'));
  assert.ok(block.includes('payment/fare-agreement-mismatch'));
  assert.ok(block.includes('agreement.paymentMethod'));
  assert.ok(block.includes('normaliseRidePaymentMethod'));
  assert.ok(block.includes('holdWalletTripPayment'));
  assert.ok(block.includes('initialiseCardTripPayment'));
  assert.ok(block.includes('"cash_due"'));
});

test('Paystack is initialized for the server-resolved agreed amount', () => {
  const start = functionsSource.indexOf(
    'async function initialiseCardTripPayment'
  );
  const block = functionsSource.slice(start, start + 5000);

  assert.ok(
    block.includes('Math.round(\n                amount *\n                100')
  );
  assert.ok(block.includes('amountSubunit:'));
  assert.ok(block.includes('requestId,'));
  assert.ok(block.includes('passengerId,'));
});

test('card verification cannot accept a mismatched transaction', () => {
  const start = functionsSource.indexOf(
    'async function recordCardTripPaymentHeld'
  );
  const block = functionsSource.slice(start, start + 2800);

  assert.ok(
    block.includes('transactionMatchesPayment')
  );
  assert.ok(
    block.includes(
      'Card transaction does not match the trip fare.'
    )
  );
});

test('card return delegates negotiated Go to negotiated finalization', () => {
  assert.ok(
    bookingSource.includes(
      'request.negotiationEnabled ==='
    )
  );
  assert.ok(
    bookingSource.includes(
      '.finalizeNegotiatedGoBooking('
    )
  );
  assert.ok(
    walletSource.includes(
      '.finalizePaidCardBooking('
    )
  );
});

test('server is authoritative for negotiated Go final settlement', () => {
  const start = functionsSource.indexOf(
    'async function settleProtectedGoFinancials'
  );
  const block = functionsSource.slice(start, start + 15000);

  for (const required of [
    'readGoFareAgreement',
    'settlement/agreement-mismatch',
    'settlement/split-mismatch',
    'settlement/payment-mismatch',
    'settlement/payment-method-mismatch',
    'earningsAppliedTrips',
    'server_protected_go',
    'commissionDebt',
    'driverSettlement:',
    'status:',
    '"completed"',
    'completedAt:'
  ]) {
    assert.ok(
      block.includes(required),
      `missing protected settlement guard: ${required}`
    );
  }

  assert.ok(
    block.includes(
      'method === "cash"'
    ),
    'cash must be the only negotiated Go method that adds commission debt'
  );
});

test('settleTripPayment uses the protected Go server settlement', () => {
  const start = functionsSource.indexOf(
    'exports.settleTripPayment'
  );
  const block = functionsSource.slice(start, start + 14000);

  assert.ok(
    block.includes(
      'settleProtectedGoFinancials'
    )
  );
  assert.ok(
    block.includes(
      'serverCompleted:'
    )
  );
  assert.ok(
    block.includes(
      'settlement:'
    )
  );
});

test('driver client cannot double-count a server-created settlement', () => {
  assert.ok(
    driverTripSource.includes(
      "const settlementRef ="
    )
  );
  assert.ok(
    driverTripSource.includes(
      "if (current) {"
    )
  );
  assert.ok(
    driverTripSource.includes(
      "const settlementCreated ="
    )
  );
});

test('cancelled negotiated Go releases payment and driver reservation', () => {
  const start = functionsSource.indexOf(
    'exports.releaseCancelledGoTripPayment'
  );
  const block = functionsSource.slice(start, start + 6500);

  assert.ok(
    block.includes(
      'releaseTripPaymentForPassenger'
    )
  );
  assert.ok(
    block.includes(
      'taxis/${trip.taxiId}/currentRequest'
    )
  );
  assert.ok(
    block.includes(
      'goFareAgreementPath'
    )
  );
  assert.ok(
    block.includes(
      '"cancelled"'
    )
  );
});

test('new card fares use verified direct Paystack subaccount settlements, never Asiye transfers', () => {
  const start=functionsSource.indexOf('async function initialiseCardTripPayment');
  const end=functionsSource.indexOf('async function prepareTripPaymentServer',start);
  const block=functionsSource.slice(start,end);
  assert.ok(block.includes('subaccount:registered.subaccountCode'));
  assert.ok(block.includes('bearer:"account"'));
  assert.ok(block.includes('driverPaystackSubaccounts/'));
  assert.ok(block.includes('isVerifiedSubaccount'));
  assert.equal(functionsSource.includes('paystackRequest("/transfer"'),false);
  assert.equal(functionsSource.includes('paystackRequest("/transferrecipient"'),false);
});

test('20/80 card split preserves Asiye and driver shares', () => {
  const split = payout.splitCardFare(10000);

  assert.equal(split.grossSubunit, 10000);
  assert.equal(split.asiyeSubunit, 2000);
  assert.equal(split.driverSubunit, 8000);
  assert.equal(split.asiyeShare, 20);
  assert.equal(split.driverShare, 80);
});


test('protected Go settlement survives RTDB initial-null passes for earnings and lock release', () => {
  const start = functionsSource.indexOf(
    'async function settleProtectedGoFinancials'
  );
  const block = functionsSource.slice(start, start + 18000);

  assert.ok(
    block.includes(
      'const driverEarningsResult ='
    ),
    'driver accounting transaction result must be verified'
  );

  assert.ok(
    block.includes(
      'driver === null'
    ),
    'driver earnings transaction must survive Firebase initial-null state'
  );

  assert.ok(
    block.includes(
      'settlement/driver-accounting-failed'
    ),
    'settlement must fail rather than completing with missing driver earnings'
  );

  assert.ok(
    block.includes(
      'prevents a completed driver from remaining stuck "On trip"'
    ),
    'completed-trip driver lock release must handle initial-null callbacks'
  );
});
