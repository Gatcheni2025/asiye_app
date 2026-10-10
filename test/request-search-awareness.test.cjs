const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const functionsSource = fs.readFileSync(
  'functions/index.js',
  'utf8'
);
const rideSource = fs.readFileSync(
  'assets/passenger-v2/js/ride-controller.js',
  'utf8'
);
const passengerUiSource = fs.readFileSync(
  'assets/passenger-v2/js/app.js',
  'utf8'
);

test('Go dispatch writes real driver search state for passenger UI', () => {
  const start = functionsSource.indexOf(
    'exports.dispatchGoRideRequest'
  );
  assert.ok(start >= 0);

  const block = functionsSource.slice(
    start,
    start + 22000
  );

  assert.match(
    block,
    /driverSearchStatus[sS]*driver_found_waiting_acceptance/
  );
  assert.match(
    block,
    /driverFoundCount/
  );
  assert.match(
    block,
    /nearestDriverDistanceKm/
  );
  assert.match(
    block,
    /searching_for_driver/
  );
  assert.match(
    block,
    /driver_found_busy/
  );
});

test('Go passenger UI changes from searching to Driver found', () => {
  assert.match(
    rideSource,
    /Searching for a nearby driver/
  );
  assert.match(
    rideSource,
    /Driver found/
  );
  assert.match(
    rideSource,
    /Waiting for a driver to accept your trip/
  );
  assert.match(
    rideSource,
    /scheduleGoDriverSearchRetry/
  );
  assert.match(
    rideSource,
    /8000/
  );
});

test('Work search reports driver availability while waiting for passengers', () => {
  assert.match(
    functionsSource,
    /driver_found_waiting_passengers/
  );
  assert.match(
    functionsSource,
    /exports.refreshDriversWhileClubPooling/
  );
  assert.match(
    passengerUiSource,
    /Driver found/
  );
  assert.match(
    passengerUiSource,
    /waiting for ${remainingText}/i
  );
  assert.match(
    passengerUiSource,
    /driver receives the full trip/i
  );
});

test('Work UI clearly shows passenger and driver stages', () => {
  assert.match(
    passengerUiSource,
    /Your Work booking is active/
  );
  assert.match(
    passengerUiSource,
    /Passengers ${progress.confirmed}/${progress.capacity}/
  );
  assert.match(
    passengerUiSource,
    /Waiting for driver to accept/
  );
  assert.match(
    passengerUiSource,
    /The full trip is now visible to eligible nearby drivers/
  );
});

test('Work area notification still exposes no request details', () => {
  const start = functionsSource.indexOf(
    'exports.notifyDriversOfClubAreaBooking'
  );
  const end = functionsSource.indexOf(
    'exports.refreshDriversWhileClubPooling',
    start
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const block = functionsSource.slice(
    start,
    end
  );

  const payloadStart = block.indexOf(
    '.set({'
  );
  const payloadEnd = block.indexOf(
    '});',
    payloadStart
  );

  assert.ok(payloadStart >= 0);
  assert.ok(payloadEnd > payloadStart);

  const payload = block.slice(
    payloadStart,
    payloadEnd
  );

  assert.match(
    payload,
    /club_area_alert/
  );
  assert.match(
    payload,
    /privacyLevel:[sS]*area_only/
  );

  for (const forbidden of [
    'requestId,',
    'pickupAddress:',
    'destination:',
    'fare:',
    'commuterName:',
    'pickupPin:'
  ]) {
    assert.equal(
      payload.includes(forbidden),
      false,
      `area-only Work alert must not expose ${forbidden}`
    );
  }
});
