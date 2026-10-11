const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { applyClubJoin } = require('../functions/club-pool-security');

function passenger(id) {
  return {
    commuterId: id,
    status: 'waiting_pool',
    paymentMethod: 'cash',
    paymentStatus: 'waiting_pool',
    safetyShareCompleted: true
  };
}

test('standard Asiye Work pool releases at 3 passengers', () => {
  const pool = {
    type: 'club',
    clubMode: 'club4',
    capacity: 4,
    minimumPassengers: 3,
    marketReferenceFare: 300,
    passengers: {
      p1: passenger('p1')
    },
    passengerCount: 1,
    status: 'pooling',
    poolReady: false
  };

  const second = applyClubJoin(
    structuredClone(pool),
    'p2',
    {
      name: 'Passenger 2',
      paymentMethod: 'cash',
      pickupPin: '1234'
    },
    1000
  ).pool;

  assert.equal(second.passengerCount, 2);
  assert.equal(second.poolReady, false);
  assert.equal(second.status, 'pooling');
  assert.equal(second.requiredPassengers, 3);
  assert.equal(second.remainingSeats, 1);

  const third = applyClubJoin(
    second,
    'p3',
    {
      name: 'Passenger 3',
      paymentMethod: 'cash',
      pickupPin: '5678'
    },
    2000
  ).pool;

  assert.equal(third.passengerCount, 3);
  assert.equal(third.poolReady, true);
  assert.equal(third.status, 'pool_ready');
  assert.equal(third.requiredPassengers, 3);
  assert.equal(third.remainingSeats, 0);
  assert.equal(third.pricePerPassenger, 115);
});

test('larger Asiye Work pool releases at 4 passengers', () => {
  let pool = {
    type: 'club',
    clubMode: 'club7',
    capacity: 7,
    minimumPassengers: 4,
    marketReferenceFare: 400,
    passengers: {
      p1: passenger('p1')
    },
    passengerCount: 1,
    status: 'pooling',
    poolReady: false
  };

  for (const [index, id] of ['p2', 'p3'].entries()) {
    pool = applyClubJoin(
      pool,
      id,
      {
        name: id,
        paymentMethod: 'cash',
        pickupPin: '1234'
      },
      2000 + index
    ).pool;

    assert.equal(pool.poolReady, false);
  }

  pool = applyClubJoin(
    pool,
    'p4',
    {
      name: 'p4',
      paymentMethod: 'cash',
      pickupPin: '1234'
    },
    3000
  ).pool;

  assert.equal(pool.passengerCount, 4);
  assert.equal(pool.poolReady, true);
  assert.equal(pool.status, 'pool_ready');
  assert.equal(pool.requiredPassengers, 4);
  assert.equal(pool.remainingSeats, 0);
  assert.equal(pool.pricePerPassenger, 115);
});

test('forming Work notification exposes no detailed trip information', () => {
  const source = fs.readFileSync('functions/index.js', 'utf8');
  const stageStart = source.indexOf('exports.notifyDriversOfClubAreaBooking');
  const readyStart = source.indexOf('exports.notifyDriversWhenClubReady', stageStart);

  assert.ok(stageStart >= 0);
  assert.ok(readyStart > stageStart);

  const stage = source.slice(stageStart, readyStart);
  const privacyIndex = stage.indexOf('privacyLevel:');
  assert.ok(privacyIndex >= 0);

  const setStart = stage.lastIndexOf('.set({', privacyIndex);
  const setEnd = stage.indexOf('});', privacyIndex);
  assert.ok(setStart >= 0);
  assert.ok(setEnd > setStart);

  const payload = stage.slice(setStart, setEnd);

  assert.match(payload, /type:\s*["']club_area_alert["']/);
  assert.match(payload, /privacyLevel:\s*["']area_only["']/);

  for (const forbidden of [
    'requestId',
    'pickupAddress',
    'destination',
    'fare:',
    'commuterName',
    'pickupPin',
    'poolCenterLat',
    'poolCenterLng'
  ]) {
    assert.equal(
      payload.includes(forbidden),
      false,
      `forming-area payload must not expose ${forbidden}`
    );
  }
});

test('full driver request is released only after pool and payments are ready', () => {
  const source = fs.readFileSync('functions/index.js', 'utf8');
  const start = source.indexOf('exports.notifyDriversWhenClubReady');
  assert.ok(start >= 0);

  const block = source.slice(start, start + 12000);

  assert.match(block, /request\.poolReady !== true/);
  assert.match(block, /request\.paymentsReady !== true/);
  assert.match(block, /request\.status !== ["']pool_ready["']/);
  assert.match(block, /type:\s*["']club_request["']/);
  assert.match(block, /requestId,/);
  assert.match(block, /passengerCount\s*<\s*requiredPassengers/);
});

test('driver app refuses to load or accept a forming Work request', () => {
  const source = fs.readFileSync(
    'assets/driver-v2/js/requests.js',
    'utf8'
  );

  assert.match(source, /notification\.type ===\s*['"]club_area_alert['"]/);
  assert.match(source, /privacy-safe Asiye Work area alert/i);
  assert.match(source, /request\.poolReady !==\s*true/);
  assert.match(source, /request\.paymentsReady !==\s*true/);
  assert.match(source, /status !==\s*['"]pool_ready['"]/);
  assert.match(source, /This Asiye Work group is still forming/);
});


test('Asiye Work uses one 30-minute matching window for both modes', () => {
  const clubSource = fs.readFileSync(
    'assets/passenger-v2/js/club.js',
    'utf8'
  );

  assert.match(
    clubSource,
    /name:\s*['"]Asiye Work 3['"][\s\S]{0,260}maxWaitMinutes:\s*30/
  );
  assert.match(
    clubSource,
    /name:\s*['"]Asiye Work 4['"][\s\S]{0,260}maxWaitMinutes:\s*30/
  );
  assert.match(clubSource, /workWaitMinutes:\s*30/);
  assert.match(clubSource, /workWaitStartedAt:/);
});

test('expired Work pools reject additional passengers', () => {
  const pool = {
    type: 'club',
    clubMode: 'club4',
    capacity: 4,
    minimumPassengers: 3,
    workWaitMinutes: 30,
    workWaitStartedAt: 1000,
    marketReferenceFare: 300,
    passengers: {
      p1: passenger('p1')
    },
    passengerCount: 1,
    status: 'pooling',
    poolReady: false
  };

  assert.throws(
    () => applyClubJoin(
      pool,
      'p2',
      {
        name: 'Passenger 2',
        paymentMethod: 'cash',
        pickupPin: '1234'
      },
      1000 + 30 * 60 * 1000
    ),
    /30-minute Asiye Work matching period has ended/
  );
});

test('underfilled Work negotiation requires the current passengers to agree', () => {
  const source = fs.readFileSync(
    'functions/index.js',
    'utf8'
  );

  const start = source.indexOf(
    'exports.submitWorkEarlyDepartureOffer'
  );

  assert.ok(start >= 0);

  const block = source.slice(
    start,
    start + 18000
  );

  assert.match(block, /ASIYE_WORK_WAIT_MS/);
  assert.match(block, /work\/wait-active/);
  assert.match(block, /collecting_passenger_approvals/);
  assert.match(block, /passengerApprovals/);
  assert.match(block, /approvedCount/);
  assert.match(block, /earlyDepartureNegotiated:\s*true/);
  assert.match(block, /effectiveRequiredPassengers/);
  assert.match(block, /driverNetFare:\s*workFareMoney\(offerTotalFare \* 0\.80\)/);
});

test('passenger Work screen displays the countdown and negotiated split', () => {
  const source = fs.readFileSync(
    'assets/passenger-v2/js/app.js',
    'utf8'
  );

  assert.match(source, /workCountdownPanel/);
  assert.match(source, /workNegotiationPanel/);
  assert.match(source, /setInterval\(/);
  assert.match(source, /1000/);
  assert.match(source, /Negotiate with a driver/);
  assert.match(source, /Driver receives/);
  assert.match(source, /submitEarlyDepartureOffer/);
});

test('driver sees the negotiated Work recommendation and can start the smaller group', () => {
  const appSource = fs.readFileSync(
    'assets/driver-v2/js/app.js',
    'utf8'
  );
  const tripSource = fs.readFileSync(
    'assets/driver-v2/js/trip-controller.js',
    'utf8'
  );

  assert.match(appSource, /30-minute Work negotiated offer/);
  assert.match(appSource, /Recommended: accept if this trip works for you/);
  assert.match(appSource, /earlyDepartureNegotiated/);
  assert.match(tripSource, /effectiveRequiredPassengers/);
});
