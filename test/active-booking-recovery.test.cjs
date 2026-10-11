'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const functionsSource = fs.readFileSync(
  path.join(root, 'functions/index.js'),
  'utf8'
);
const rideSource = fs.readFileSync(
  path.join(root, 'assets/passenger-v2/js/ride-controller.js'),
  'utf8'
);
const bookingSource = fs.readFileSync(
  path.join(root, 'assets/passenger-v2/js/booking.js'),
  'utf8'
);
const negotiationSource = fs.readFileSync(
  path.join(root, 'assets/passenger-v2/js/go-negotiation.js'),
  'utf8'
);
const driverTripSource = fs.readFileSync(
  path.join(root, 'assets/driver-v2/js/trip-controller.js'),
  'utf8'
);

test('server returns the real active booking instead of an opaque conflict', () => {
  const start = functionsSource.indexOf('exports.submitGoFareOffer');
  const block = functionsSource.slice(start, start + 18000);
  assert.ok(block.includes('"booking/active-exists"'));
  assert.ok(block.includes('activeRequestId'));
  assert.ok(block.includes('terminalStatuses'));
  assert.ok(block.includes('existingIsTerminal'));
});

test('passenger restore uses server currentRequest as authoritative state', () => {
  const start = rideSource.indexOf('async restore()');
  const block = rideSource.slice(start, start + 12000);
  assert.ok(block.includes('serverRequestId'));
  assert.ok(block.includes('Server currentRequest is authoritative'));
  assert.ok(block.includes('localRequestId'));
  assert.ok(block.includes("localStorage.setItem(\n                'currentRequestId'"));
});

test('active booking conflict reopens the existing ride', () => {
  assert.ok(negotiationSource.includes('error.activeRequestId'));
  assert.ok(bookingSource.includes('Your active booking has been restored.'));
  assert.ok(bookingSource.includes('await ASIYE.ride'));
});

test('stale and completed booking locks are not permanent blockers', () => {
  assert.ok(functionsSource.includes('"expired"'));
  assert.ok(rideSource.includes("'cancelled_by_commuter'"));
  assert.ok(rideSource.includes("'completed'"));
});

test('passenger and driver cancellation are blocked after trip start', () => {
  assert.ok(bookingSource.includes(
    'This trip has already started and can no longer be cancelled from the booking screen.'
  ));
  assert.ok(driverTripSource.includes(
    'This trip has already started and can no longer be cancelled.'
  ));
});
