'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(
  path.join(root, 'assets/passenger-v2/js/app.js'),
  'utf8'
);
const booking = fs.readFileSync(
  path.join(root, 'assets/passenger-v2/js/booking.js'),
  'utf8'
);

test('passenger startup does not trust a stale cached commuterId', () => {
  assert.ok(
    app.includes(
      'Stored commuterId does not belong to the signed-in passenger'
    )
  );
  assert.ok(
    app.includes(
      ".orderByChild(\n                            'authUid'"
    )
  );
  assert.ok(
    app.includes(
      'ownsProfile('
    )
  );
});

test('Go booking verifies commuter ownership against Firebase Auth', () => {
  assert.ok(
    booking.includes(
      'async resolvePassengerForBooking()'
    )
  );
  assert.ok(
    booking.includes(
      "commuterId ===\n                    authUser.uid"
    )
  );
  assert.ok(
    booking.includes(
      ".equalTo(\n                            authUser.uid"
    )
  );
  assert.ok(
    booking.includes(
      'Your passenger session is out of date. Sign in again before booking.'
    )
  );
  assert.ok(
    booking.includes(
      "const passenger =\n            await this\n                .resolvePassengerForBooking();"
    )
  );
});
