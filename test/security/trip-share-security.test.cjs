const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  canIssueTripShare,
  isJoinableClubRequest,
  legacyShareAllowed,
  sanitizeRequest,
  sanitizeTaxi
} = require('../../functions/trip-share-security');

test('trip share authorization accepts trip owner and Club participant', () => {
  const go = {
    commuterId: 'passenger-record',
    type: 'ehailing',
    status: 'pending'
  };

  assert.equal(
    canIssueTripShare(go, 'passenger-record', 'auth-passenger'),
    true
  );

  const club = {
    commuterId: 'owner',
    type: 'club',
    status: 'driver_waiting',
    capacity: 4,
    passengers: {
      member: { commuterId: 'member', status: 'waiting_pool' }
    }
  };

  assert.equal(
    canIssueTripShare(club, 'member', 'member-auth'),
    true
  );
});

test('joinable Club request can issue a pre-join safety share but full pool cannot', () => {
  const open = {
    type: 'club',
    status: 'pooling',
    capacity: 2,
    passengers: {
      p1: { commuterId: 'p1', status: 'waiting_pool' }
    }
  };

  assert.equal(isJoinableClubRequest(open), true);
  assert.equal(canIssueTripShare(open, 'p2', 'p2-auth'), true);

  open.passengers.p2 = {
    commuterId: 'p2',
    status: 'waiting_pool'
  };

  assert.equal(isJoinableClubRequest(open), false);
});

test('sanitized tracking response excludes private passenger and trip security data', () => {
  const trip = sanitizeRequest({
    commuterId: 'private-passenger-id',
    commuterName: 'Private Passenger',
    commuterPhone: 'private-phone',
    pickupPin: '1234',
    calculatedPrice: 250,
    finalAmount: 250,
    type: 'ehailing',
    status: 'driver_on_way',
    pickupAddress: 'Pickup',
    commuterLocation: {
      latitude: -29.8,
      longitude: 31.0
    },
    destination: 'Destination',
    destinationCoords: {
      latitude: -29.7,
      longitude: 30.9
    },
    taxiId: 'taxi-1',
    driverName: 'Driver'
  }, 'trip-1');

  assert.equal(trip.requestId, 'trip-1');
  assert.equal(trip.status, 'driver_on_way');
  assert.equal(trip.pickupAddress, 'Pickup');
  assert.equal('commuterId' in trip, false);
  assert.equal('commuterName' in trip, false);
  assert.equal('commuterPhone' in trip, false);
  assert.equal('pickupPin' in trip, false);
  assert.equal('calculatedPrice' in trip, false);
  assert.equal('finalAmount' in trip, false);

  const taxi = sanitizeTaxi({
    latitude: -29.81,
    longitude: 31.02,
    name: 'Driver',
    phone: 'private-driver-phone',
    authUid: 'private-auth',
    profile_picture_url: 'https://example.test/driver.jpg'
  });

  assert.equal(taxi.name, 'Driver');
  assert.equal('phone' in taxi, false);
  assert.equal('authUid' in taxi, false);
});

test('legacy request-id links remain time-limited and require completed safety sharing', () => {
  const now = Date.now();

  assert.equal(
    legacyShareAllowed({
      safetyShareCompleted: true,
      createdAt: now - 60_000,
      liveTrackingUrl:
        'https://app.asiye.cloud/track.html?trip=legacy-trip'
    }, 'legacy-trip', now),
    true
  );

  assert.equal(
    legacyShareAllowed({
      safetyShareCompleted: false,
      createdAt: now,
      liveTrackingUrl:
        'https://app.asiye.cloud/track.html?trip=legacy-trip'
    }, 'legacy-trip', now),
    false
  );

  assert.equal(
    legacyShareAllowed({
      safetyShareCompleted: true,
      createdAt: now - 8 * 24 * 60 * 60 * 1000,
      liveTrackingUrl:
        'https://app.asiye.cloud/track.html?trip=legacy-trip'
    }, 'legacy-trip', now),
    false
  );
});

test('public tracking page uses the sanitized backend and no longer reads protected RTDB nodes', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../assets/track.html'),
    'utf8'
  );

  assert.match(source, /getTripShare/);
  assert.doesNotMatch(source, /firebase-database\.js/);
  assert.doesNotMatch(source, /db\.ref\(["']requests\//);
  assert.doesNotMatch(source, /db\.ref\(["']taxis\//);

  const scripts = [
    ...source.matchAll(/<script>([\s\S]*?)<\/script>/g)
  ];

  assert.ok(scripts.length > 0);

  for (const [, script] of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});
