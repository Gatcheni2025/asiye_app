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

  assert.ok(
    block.includes('driverSearchStatus')
  );
  assert.ok(
    block.includes(
      'driver_found_waiting_acceptance'
    )
  );
  assert.ok(
    block.includes('driverFoundCount')
  );
  assert.ok(
    block.includes('nearestDriverDistanceKm')
  );
  assert.ok(
    block.includes('searching_for_driver')
  );
  assert.ok(
    block.includes('driver_found_busy')
  );
});

test('Go passenger UI changes from searching to Driver found', () => {
  assert.ok(
    rideSource.includes(
      'Searching for a nearby driver'
    )
  );
  assert.ok(
    rideSource.includes('Driver found')
  );
  assert.ok(
    rideSource.includes(
      'Waiting for a driver to accept your trip'
    )
  );
  assert.ok(
    rideSource.includes(
      'scheduleGoDriverSearchRetry'
    )
  );
  assert.ok(
    rideSource.includes('8000')
  );
});

test('Work search reports driver availability while waiting for passengers', () => {
  assert.ok(
    functionsSource.includes(
      'driver_found_waiting_passengers'
    )
  );
  assert.ok(
    functionsSource.includes(
      'exports.refreshDriversWhileClubPooling'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'Driver found'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'waiting for ${remainingText}'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'driver receives the full trip'
    )
  );
});

test('Work UI clearly shows passenger and driver stages', () => {
  assert.ok(
    passengerUiSource.includes(
      'Your Work booking is active'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'Passengers ${progress.confirmed}/${progress.capacity}'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'Waiting for driver to accept'
    )
  );
  assert.ok(
    passengerUiSource.includes(
      'The full trip is now visible to eligible nearby drivers'
    )
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

  assert.ok(
    payload.includes('club_area_alert')
  );
  assert.ok(
    payload.includes('privacyLevel:')
  );
  assert.ok(
    payload.includes('"area_only"')
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
