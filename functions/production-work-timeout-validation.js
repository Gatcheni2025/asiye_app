'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const FUNCTIONS_BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';

function loadApiKey() {
  const source = fs.readFileSync(path.join(__dirname, '../assets/passenger-v2/js/firebase.js'), 'utf8');
  const match = source.match(/apiKey:\s*[\r\n\s]*["']([^"']+)["']/);
  if (!match) throw new Error('Firebase Web API key was not found.');
  return match[1];
}

const API_KEY = loadApiKey();
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID, databaseURL: DATABASE_URL });
const db = admin.database();
const auth = admin.auth();

const stamp = Date.now().toString(36);
const suffix = Math.random().toString(36).slice(2, 8);
const p1Uid = 'e2e_work_p1_' + stamp + '_' + suffix;
const p2Uid = 'e2e_work_p2_' + stamp + '_' + suffix;
const driverUid = 'e2e_work_d_' + stamp + '_' + suffix;
const p1 = 'e2e-work-p1-' + stamp + '-' + suffix;
const p2 = 'e2e-work-p2-' + stamp + '-' + suffix;
const driverId = 'e2e-work-d-' + stamp + '-' + suffix;
const requestId = 'e2e_work_timeout_' + stamp + '_' + suffix;
const users = [];
let checks = 0;

function assert(value, message) { if (!value) throw new Error(message); }
function pass(message) { checks += 1; console.log('PASS [Work 30m] ' + message); }

async function createUser(uid, displayName) {
  await auth.createUser({ uid, displayName });
  users.push(uid);
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(API_KEY),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const payload = await response.json();
  if (!response.ok || !payload.idToken) throw new Error('Token exchange failed for ' + uid);
  return payload.idToken;
}

async function post(name, token, body) {
  const response = await fetch(FUNCTIONS_BASE + '/' + name, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(name + ' failed (' + response.status + '): ' + (payload.error || JSON.stringify(payload)));
  return payload;
}

async function cleanup() {
  await db.ref().update({
    ['requests/' + requestId]: null,
    ['commuters/' + p1]: null,
    ['commuters/' + p2]: null,
    ['taxis/' + driverId]: null,
    ['notifications/taxis/' + driverId + '/' + requestId]: null
  }).catch(() => {});
  for (const uid of users) await auth.deleteUser(uid).catch(() => {});
}

async function main() {
  try {
    const tokens = await Promise.all([
      createUser(p1Uid, 'Work Passenger One'),
      createUser(p2Uid, 'Work Passenger Two'),
      createUser(driverUid, 'Work Driver')
    ]);
    const p1Token = tokens[0];
    const p2Token = tokens[1];
    const past = Date.now() - 31 * 60 * 1000;

    await db.ref().update({
      ['commuters/' + p1]: { authUid: p1Uid, name: 'Work Passenger One', phone: '+27000000881', walletBalance: 0 },
      ['commuters/' + p2]: { authUid: p2Uid, name: 'Work Passenger Two', phone: '+27000000882', walletBalance: 0 },
      ['taxis/' + driverId]: {
        authUid: driverUid, userUid: driverUid, name: 'Work', surname: 'Driver', phone: '+27000000883',
        isOnline: true, isBroadcasting: true, isFull: false, verificationStatus: 'verified',
        vehicleApproved: true, vehicleApprovalStatus: 'approved', enrollmentVersion: 2,
        vehicleType: 'ehailing', vehicleMake: 'Toyota', vehicleModel: 'Avanza', vehicleColor: 'White',
        vehicleYear: 2024, vehicleSeats: 4, seats: 4, taxiRegistrationNumber: 'WORK-E2E',
        profileImageUrl: 'https://example.invalid/work-driver.jpg', vehiclePhoto: 'https://example.invalid/work-car.jpg',
        latitude: -29.60000, longitude: 30.38000,
        vehicle: { type: 'ehailing', make: 'Toyota', model: 'Avanza', colour: 'White', year: 2024, seats: 4, registration: 'WORK-E2E' }
      },
      ['requests/' + requestId]: {
        requestId, type: 'club', clubMode: 'club4', status: 'pooling', poolReady: false,
        paymentsReady: false, paymentStatus: 'waiting_pool', capacity: 4, minimumPassengers: 3,
        requiredPassengers: 3, passengerCount: 2, remainingSeats: 1, marketReferenceFare: 130,
        pricePerPassenger: 50, totalPoolFare: 150, driverGrossFare: 150, commissionRate: 0.20,
        workWaitMinutes: 30, workWaitStartedAt: past, workWaitExpiresAt: past + 30 * 60 * 1000,
        createdAt: past, pickupAddress: 'E2E Work Pickup', poolCenterLat: -29.60000, poolCenterLng: 30.38000,
        commuterLocation: { latitude: -29.60000, longitude: 30.38000 },
        destination: 'E2E Work Destination', destinationCoords: { latitude: -29.61000, longitude: 30.39000 },
        routeDistanceKm: 8, routeDurationMinutes: 15, commuterId: p1, commuterName: 'Work Passenger One',
        passengers: {
          [p1]: { commuterId: p1, name: 'Work Passenger One', status: 'waiting_pool', paymentMethod: 'cash', paymentStatus: 'waiting_pool', safetyShareCompleted: true, pickupPin: '1111', price: 50, pickupLat: -29.60000, pickupLng: 30.38000 },
          [p2]: { commuterId: p2, name: 'Work Passenger Two', status: 'waiting_pool', paymentMethod: 'cash', paymentStatus: 'waiting_pool', safetyShareCompleted: true, pickupPin: '2222', price: 50, pickupLat: -29.60020, pickupLng: 30.38020 }
        }
      }
    });
    pass('Backdated 2-of-3 Work group created');

    const first = await post('submitWorkEarlyDepartureOffer', p1Token, { requestId, amount: 150 });
    assert(first.status === 'collecting_passenger_approvals', 'First passenger should wait for group approval.');
    pass('First passenger approved the recommended R150 offer');

    const second = await post('submitWorkEarlyDepartureOffer', p2Token, { requestId, amount: 150 });
    assert(second.status === 'driver_offer', 'All approvals should release the driver offer.');
    pass('All current passengers approved the early-departure fare');

    const trip = (await db.ref('requests/' + requestId).once('value')).val();
    assert(trip?.earlyDepartureNegotiated === true, 'Early-departure flag missing.');
    assert(Number(trip?.effectiveRequiredPassengers) === 2, 'Effective passenger requirement should be 2.');
    assert(Number(trip?.passengers?.[p1]?.price) === 75, 'Passenger one should be repriced to R75.');
    assert(Number(trip?.passengers?.[p2]?.price) === 75, 'Passenger two should be repriced to R75.');
    assert(Number(trip?.driverNetFare) === 120, 'Driver net should be R120 at 80%.');
    assert(trip?.paymentsReady === true, 'Cash passengers should be payment-ready.');
    assert(trip?.status === 'pool_ready', 'Negotiated Work trip should be pool_ready.');
    pass('Negotiated group repriced and payment-ready');

    let notification = null;
    for (let attempt = 0; attempt < 10 && !notification; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 800));
      notification = (await db.ref('notifications/taxis/' + driverId + '/' + requestId).once('value')).val();
    }
    assert(notification?.type === 'club_request', 'Nearby driver did not receive the negotiated Work request.');
    pass('Nearby driver received the normal actionable Work request');

    console.log('');
    console.log('ASIYE WORK 30-MINUTE PRODUCTION E2E: PASS');
    console.log('Checks passed: ' + checks);
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error('');
  console.error('ASIYE WORK 30-MINUTE PRODUCTION E2E: FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
