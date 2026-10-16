const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const pricingSource = fs.readFileSync(
  'assets/passenger-v2/js/pricing.js',
  'utf8'
);
const bookingSource = fs.readFileSync(
  'assets/passenger-v2/js/booking.js',
  'utf8'
);
const passengerNegotiationSource = fs.readFileSync(
  'assets/passenger-v2/js/go-negotiation.js',
  'utf8'
);
const passengerRideSource = fs.readFileSync(
  'assets/passenger-v2/js/ride-controller.js',
  'utf8'
);
const walletSource = fs.readFileSync(
  'assets/passenger-v2/js/wallet.js',
  'utf8'
);
const driverNegotiationSource = fs.readFileSync(
  'assets/driver-v2/js/go-negotiation.js',
  'utf8'
);
const driverRequestsSource = fs.readFileSync(
  'assets/driver-v2/js/requests.js',
  'utf8'
);
const driverTripSource = fs.readFileSync(
  'assets/driver-v2/js/trip-controller.js',
  'utf8'
);
const functionsSource = fs.readFileSync(
  'functions/index.js',
  'utf8'
);

function pricingFor(distanceKm, durationMinutes) {
  const ASIYE = {
    state: {
      route: {
        distanceKm,
        durationMinutes
      }
    }
  };

  const context = {
    window: { ASIYE },
    ASIYE,
    console
  };

  vm.createContext(context);
  vm.runInContext(pricingSource, context);

  return context.ASIYE.pricing.calculate();
}

test('Go pricing protects an 65-95 percent negotiation corridor', () => {
  const quote = pricingFor(10, 20);

  assert.equal(
    quote.marketReference,
    118
  );

  assert.equal(
    quote.goMinimumOffer,
    77
  );

  assert.equal(
    quote.goSuggested,
    106
  );

  assert.equal(
    quote.goMaximumOffer,
    112
  );

  assert.equal(
    quote.goCommissionRate,
    0.20
  );

  assert.equal(
    quote.goDriverMinimumNet,
    61.60
  );

  assert.equal(
    quote.goMinimumAsiyeCommission,
    15.40
  );
});

test('Go breakdown always preserves the 20/80 split', () => {
  const ASIYE = {
    state: {
      route: {
        distanceKm: 10,
        durationMinutes: 20
      }
    }
  };

  const context = {
    window: { ASIYE },
    ASIYE,
    console
  };

  vm.createContext(context);
  vm.runInContext(pricingSource, context);

  const quote = context.ASIYE.pricing.calculate();
  const low = context.ASIYE.pricing.goBreakdown(
    quote.goMinimumOffer,
    quote
  );
  const high = context.ASIYE.pricing.goBreakdown(
    quote.goMaximumOffer,
    quote
  );

  assert.equal(low.fare, 77);
  assert.equal(low.asiyeCommission, 15.40);
  assert.equal(low.driverReceives, 61.60);

  assert.equal(high.fare, 112);
  assert.equal(high.asiyeCommission, 22.40);
  assert.equal(high.driverReceives, 89.60);
});

test('Passenger request enters negotiation before payment, PIN or sharing', () => {
  const createStart = bookingSource.indexOf(
    'async createGoRide('
  );
  const legacyPayment = bookingSource.indexOf(
    'Legacy fixed-fare payment flow',
    createStart
  );
  const protectedBlock = bookingSource.slice(
    createStart,
    legacyPayment
  );

  assert.ok(createStart >= 0);
  assert.ok(legacyPayment > createStart);

  assert.ok(
    protectedBlock.includes(
      "fareStatus:\n                'passenger_offer'"
    )
  );

  assert.ok(
    protectedBlock.includes(
      "paymentStatus:\n                'negotiation_pending'"
    )
  );

  assert.ok(
    protectedBlock.includes(
      'submitOffer'
    )
  );

  assert.ok(
    protectedBlock.includes(
      'notifyGoDrivers'
    )
  );

  assert.ok(
    protectedBlock.includes(
      'const pickupPin =\n            null'
    )
  );

  assert.equal(
    protectedBlock.includes(
      'requireTripShare({'
    ),
    false
  );

  assert.equal(
    protectedBlock.includes(
      '.prepare(\n                        requestId'
    ),
    false
  );
});

test('Server recomputes and enforces protected Go fares', () => {
  for (const required of [
    'const ASIYE_GO_NEGOTIATION',
    'suggestedRatio: 0.90',
    'minimumRatio: 0.65',
    'maximumRatio: 0.95',
    'commissionRate: 0.20',
    'maxDriverCounters: 2',
    'function goMarketReference',
    'function goNegotiationPricing',
    'function validGoNegotiatedAmount',
    'function goCommercialPatch'
  ]) {
    assert.ok(
      functionsSource.includes(required),
      `missing server protection: ${required}`
    );
  }
});

test('Every negotiation action is a server endpoint', () => {
  for (const endpoint of [
    'exports.submitGoFareOffer',
    'exports.counterGoFare',
    'exports.acceptGoFareOffer',
    'exports.acceptGoFareCounter',
    'exports.declineGoFareCounter',
    'exports.finalizeNegotiatedGoBooking'
  ]) {
    assert.ok(
      functionsSource.includes(endpoint),
      `missing endpoint: ${endpoint}`
    );
  }
});

test('Payment is server-blocked until fare agreement and driver reservation', () => {
  const start = functionsSource.indexOf(
    'async function prepareTripPaymentServer'
  );
  assert.ok(start >= 0);

  const block = functionsSource.slice(
    start,
    start + 7000
  );

  assert.ok(
    block.includes(
      'payment/fare-not-agreed'
    )
  );

  assert.ok(
    block.includes(
      'payment/fare-agreement-mismatch'
    )
  );

  assert.ok(
    block.includes(
      'readGoFareAgreement'
    )
  );

  assert.ok(
    block.includes(
      'trip.fareStatus !=='
    )
  );

  assert.ok(
    block.includes(
      '!trip.taxiId'
    )
  );
});

test('Agreed fare is copied into a private server ledger', () => {
  const start = functionsSource.indexOf(
    'async function reserveGoNegotiatedDriver'
  );
  assert.ok(start >= 0);

  const block = functionsSource.slice(
    start,
    start + 9000
  );

  assert.ok(
    functionsSource.includes(
      'goFareAgreements/'
    )
  );

  assert.ok(
    block.includes(
      'agreementRef.transaction'
    )
  );

  assert.ok(
    block.includes(
      'platformCommission:'
    )
  );

  assert.ok(
    block.includes(
      'driverNetFare:'
    )
  );

  assert.ok(
    block.includes(
      'fareStatus:\n              "agreed"'
    )
  );

  assert.ok(
    block.includes(
      'status:\n              "payment_required"'
    )
  );
});

test('Driver counter is capped and passenger controls acceptance', () => {
  assert.ok(
    driverNegotiationSource.includes(
      'Passenger offer'
    )
  );

  assert.ok(
    driverNegotiationSource.includes(
      'You receive'
    )
  );

  assert.ok(
    driverNegotiationSource.includes(
      'counterFare'
    )
  );

  assert.ok(
    passengerRideSource.includes(
      'Driver counter: R'
    )
  );

  assert.ok(
    passengerRideSource.includes(
      'acceptDriverCounter'
    )
  );

  assert.ok(
    passengerRideSource.includes(
      'keepPassengerOffer'
    )
  );

  assert.ok(
    functionsSource.includes(
      'counterCount >='
    )
  );

  assert.ok(
    functionsSource.includes(
      'pricing.maximumFareOffer'
    )
  );
});

test('Cash and Card use the post-agreement payment gate', () => {
  assert.ok(
    walletSource.includes(
      'NEGOTIATED ASIYE GO'
    )
  );

  assert.ok(
    walletSource.includes(
      'request.fareStatus ==='
    )
  );

  assert.ok(
    walletSource.includes(
      'finalizeNegotiatedGoBooking'
    )
  );

  assert.match(walletSource, /method\s*!==\s*'card'/);
  assert.match(walletSource, /method\s*!==\s*'card'\s*\|\|/);
  const stateSource = fs.readFileSync('assets/passenger-v2/js/state.js', 'utf8');
  assert.match(stateSource, /\['cash', 'card'\]\.includes/);
});

test('Negotiated payment preparation is single-flight per request', () => {
  assert.ok(
    walletSource.includes(
      '_prepareRequestId'
    )
  );

  assert.ok(
    walletSource.includes(
      '_preparePromise'
    )
  );

  assert.ok(
    walletSource.includes(
      'this._prepareRequestId ==='
    )
  );

  assert.ok(
    walletSource.includes(
      'this._preparePromise ==='
    )
  );
});

test('Payment unlocks pickup and safety sharing remains required after arrival', () => {
  assert.ok(
    bookingSource.includes(
      'async finalizeNegotiatedGoBooking'
    )
  );

  assert.ok(
    bookingSource.includes(
      'requireTripShare({'
    )
  );

  assert.ok(
    bookingSource.includes(
      "'finalizeNegotiatedGoBooking'"
    )
  );

  assert.ok(
    functionsSource.includes(
      'goContinuation.activate'
    )
  );

  assert.ok(
    functionsSource.includes(
      'negotiatedBookingFinalized'
    )
  );

  assert.ok(
    driverTripSource.includes(
      'renderNegotiatedPaymentWaiting'
    )
  );

  assert.ok(
    driverTripSource.includes(
      'Wait for the confirmed passenger payment before starting pickup.'
    )
  );
});

test('Passenger and driver negotiation clients call server APIs rather than writing agreed fare', () => {
  for (const endpoint of [
    'submitGoFareOffer',
    'acceptGoFareCounter',
    'declineGoFareCounter'
  ]) {
    assert.ok(
      passengerNegotiationSource.includes(endpoint)
    );
  }

  for (const endpoint of [
    'counterGoFare',
    'acceptGoFareOffer'
  ]) {
    assert.ok(
      driverRequestsSource.includes(endpoint)
    );
  }

  assert.equal(
    passengerNegotiationSource.includes(
      "ref('requests')"
    ),
    false
  );
});


test('negotiated Go driver acceptance is idempotent under duplicate taps', () => {
  assert.ok(
    functionsSource.includes(
      'const sameDriverReservation ='
    ),
    'server must treat the same driver + same agreed fare as an idempotent retry'
  );

  assert.ok(
    functionsSource.includes(
      'const alreadyReservedForDriver ='
    ),
    'server must allow the reservation owner to retry after the search notification is removed'
  );

  assert.ok(
    driverRequestsSource.includes(
      'async reconcileAcceptance('
    ),
    'driver client must reconcile request ownership after an accept race'
  );

  assert.ok(
    driverRequestsSource.includes(
      'setActiveRequest(\n                    id,\n                    accepted'
    ),
    'driver active request state must receive both request id and request data'
  );
});


test('Go fare acceptance does not abort on the RTDB transaction initial-null pass', () => {
  const start = functionsSource.indexOf(
    'async function reserveGoNegotiatedDriver'
  );
  const block = functionsSource.slice(start, start + 12000);

  assert.ok(
    block.includes(
      'current === null'
    ),
    'request transaction must recognize Firebase initial-null callbacks'
  );

  assert.ok(
    block.includes(
      'return null;'
    ),
    'initial null must be returned as a value so Firebase can retry with server state'
  );

  assert.ok(
    block.includes(
      'trip.fareStatus !==\n        "agreed"'
    ),
    'a null no-op transaction must never be treated as a successful acceptance'
  );
});


test('negotiated Go finalization survives the RTDB initial-null transaction pass', () => {
  const start = functionsSource.indexOf(
    "const goContinuation = require('./go-continuation')"
  );
  const block = functionsSource.slice(start, start + 15000);

  assert.ok(start >= 0);

  assert.ok(
    block.includes(
      'current === null'
    ),
    'finalization must recognize Firebase initial-null callbacks'
  );

  assert.ok(
    block.includes(
      'finalized.negotiatedBookingFinalized !== true'
    ),
    'finalization must verify the authoritative committed booking state'
  );
});


test('protected Go fare submission owns passenger currentRequest on the server', () => {
  const start = functionsSource.indexOf(
    'exports.submitGoFareOffer'
  );
  const block = functionsSource.slice(start, start + 14000);

  assert.ok(
    block.includes(
      'commuters/${passengerId}/currentRequest'
    ),
    'server must own the passenger booking lock'
  );

  assert.ok(
    block.includes(
      'You already have an active booking.'
    ),
    'server must not silently overwrite another active passenger booking'
  );
});
