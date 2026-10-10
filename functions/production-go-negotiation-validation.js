'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const FUNCTIONS_BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';

function loadApiKey() {
  const source = fs.readFileSync(
    path.join(__dirname, '../assets/passenger-v2/js/firebase.js'),
    'utf8'
  );
  const match = source.match(/apiKey:\s*[\r\n\s]*["']([^"']+)["']/);
  if (!match) throw new Error('Firebase Web API key was not found.');
  return match[1];
}

const API_KEY = loadApiKey();

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
    databaseURL: DATABASE_URL
  });
}

const db = admin.database();
const auth = admin.auth();

const stamp = Date.now().toString(36);
const suffix = Math.random().toString(36).slice(2, 8);
const passengerUid = `e2e_neg_p_${stamp}_${suffix}`;
const driverUid = `e2e_neg_d_${stamp}_${suffix}`;
const passengerId = `e2e-neg-p-${stamp}-${suffix}`;
const driverId = `e2e-neg-d-${stamp}-${suffix}`;
const requestId = `e2e_neg_go_${stamp}_${suffix}`;
const createdUsers = [];
const shareTokens = [];
let checks = 0;

function record(step, detail = '') {
  checks += 1;
  console.log(`PASS [Negotiated Go Cash] ${step}${detail ? ' — ' + detail : ''}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createTestUser(uid, displayName) {
  await auth.createUser({ uid, displayName });
  createdUsers.push(uid);

  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true
      })
    }
  );

  const payload = await response.json();
  if (!response.ok || !payload.idToken) {
    throw new Error(
      `Unable to exchange custom token for ${uid}: ${payload?.error?.message || response.status}`
    );
  }

  return payload.idToken;
}

async function rest(pathName, method, token, body) {
  const response = await fetch(
    `${DATABASE_URL}/${pathName}.json?auth=${encodeURIComponent(token)}`,
    {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const error = new Error(
      `RTDB ${method} ${pathName} failed (${response.status}): ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function expectRestFailure(pathName, method, token, body) {
  try {
    await rest(pathName, method, token, body);
  } catch (error) {
    return error;
  }
  throw new Error(`Expected RTDB ${method} ${pathName} to be rejected.`);
}

async function functionPost(name, token, body) {
  const response = await fetch(
    `${FUNCTIONS_BASE}/${name}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${name} failed (${response.status}): ${payload.error || JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function seed() {
  await db.ref().update({
    [`commuters/${passengerId}`]: {
      authUid: passengerUid,
      name: 'E2E Negotiated Passenger',
      phone: '+27000000991',
      verificationStatus: 'verified',
      walletBalance: 0,
      credits: 0
    },
    [`taxis/${driverId}`]: {
      authUid: driverUid,
      userUid: driverUid,
      name: 'E2E Negotiated',
      surname: 'Driver',
      phone: '+27000000992',
      isOnline: true,
      isBroadcasting: true,
      isFull: false,
      verificationStatus: 'approved',
      vehicleApproved: true,
      vehicleType: 'ehailing',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleColor: 'White',
      vehicleYear: '2024',
      taxiRegistrationNumber: 'NEG-E2E',
      latitude: -45,
      longitude: 0,
      totalTrips: 0,
      grossEarnings: 0,
      totalEarnings: 0,
      netEarnings: 0,
      commissionAccrued: 0,
      commissionDebt: 0
    }
  });
}

async function issueShare(passengerToken) {
  const payload = await functionPost(
    'createTripShareToken',
    passengerToken,
    { requestId }
  );

  assert(payload.shareToken, 'Trip share token was not issued.');
  shareTokens.push(payload.shareToken);
  return payload;
}

async function validate(tokens) {
  const passengerToken = tokens.passenger;
  const driverToken = tokens.driver;

  await rest(`requests/${requestId}`, 'PUT', passengerToken, {
    requestId,
    type: 'ehailing',
    rideType: 'go',
    carCategory: 'go',
    commuterId: passengerId,
    commuterName: 'E2E Negotiated Passenger',
    status: 'pending',
    pickupAddress: 'Protected E2E Pickup',
    commuterLocation: {
      latitude: -45,
      longitude: 0
    },
    destination: 'Protected E2E Destination',
    destinationName: 'Protected E2E Destination',
    destinationCoords: {
      latitude: -44.95,
      longitude: 0.05
    },
    routeDistanceKm: 10,
    routeDurationMinutes: 20,
    calculatedPrice: 106,
    finalAmount: 106,
    passengerOffer: 106,
    fareStatus: 'passenger_offer',
    negotiationEnabled: true,
    negotiationRound: 1,
    commissionRate: 0.20,
    paymentMethod: 'cash',
    paymentStatus: 'negotiation_pending',
    paymentsReady: false,
    requirePin: true,
    safetyShareRequired: true,
    safetyShareCompleted: false,
    createdAt: Date.now()
  });
  record('Passenger created protected negotiation request');

  const submitted = await functionPost(
    'submitGoFareOffer',
    passengerToken,
    {
      requestId,
      amount: 106
    }
  );

  assert(
    submitted?.pricing?.minimumFareOffer === 101 &&
    submitted?.pricing?.suggestedFare === 106 &&
    submitted?.pricing?.maximumFareOffer === 112,
    `Unexpected protected corridor: ${JSON.stringify(submitted?.pricing || {})}`
  );
  record('Server recomputed 85–95% fare corridor', 'R101–R112, suggested R106');

  const dispatch = await functionPost(
    'dispatchGoRideRequest',
    passengerToken,
    { requestId }
  );

  assert(
    dispatch?.mode === 'broadcast' &&
    Number(dispatch?.drivers || 0) >= 1,
    `Expected isolated driver broadcast, got ${JSON.stringify(dispatch)}`
  );

  const notification = (
    await db.ref(
      `notifications/taxis/${driverId}/${requestId}`
    ).once('value')
  ).val();

  assert(
    notification?.requestId === requestId,
    'Temporary driver did not receive negotiated request.'
  );
  record('Real production driver search found isolated test driver');

  const accepted = await functionPost(
    'acceptGoFareOffer',
    driverToken,
    { requestId }
  );

  assert(
    accepted?.agreedFare === 106 &&
    accepted?.driverNetFare === 84.8 &&
    accepted?.platformCommission === 21.2,
    `Unexpected accepted split: ${JSON.stringify(accepted)}`
  );
  record('Driver accepted fare and protected split locked', 'Passenger R106 · Driver R84.80 · Asiye R21.20');

  const agreement = (
    await db.ref(
      `goFareAgreements/${requestId}`
    ).once('value')
  ).val();

  assert(
    agreement?.agreedFare === 106 &&
    agreement?.driverId === driverId &&
    agreement?.driverNetFare === 84.8 &&
    agreement?.platformCommission === 21.2 &&
    agreement?.paymentMethod === 'cash',
    `Protected agreement mismatch: ${JSON.stringify(agreement)}`
  );
  record('Private fare agreement locked driver, fare, split and payment method');

  const tamper = await expectRestFailure(
    `requests/${requestId}`,
    'PATCH',
    passengerToken,
    {
      agreedFare: 40,
      finalAmount: 40,
      paymentMethod: 'card'
    }
  );
  assert(tamper.status >= 400, 'Commercial tamper was not rejected.');
  record('Client fare/payment-method tampering rejected by production rules');

  const prepared = await functionPost(
    'prepareTripPayment',
    passengerToken,
    { requestId }
  );

  assert(
    prepared?.ready === true &&
    prepared?.status === 'cash_due',
    `Cash preparation mismatch: ${JSON.stringify(prepared)}`
  );

  const privatePayment = (
    await db.ref(
      `tripPayments/${requestId}/${passengerId}`
    ).once('value')
  ).val();

  assert(
    privatePayment?.amount === 106 &&
    privatePayment?.status === 'cash_due' &&
    privatePayment?.method === 'cash',
    `Private payment mismatch: ${JSON.stringify(privatePayment)}`
  );
  record('Payment ledger uses exact agreed fare', 'R106 cash due');

  const share = await issueShare(passengerToken);

  await rest(
    `requests/${requestId}`,
    'PATCH',
    passengerToken,
    {
      pickupPin: '2468',
      safetyShareCompleted: true,
      safetyShareAt: Date.now(),
      liveTrackingUrl: share.liveTrackingUrl
    }
  );
  record('Post-agreement PIN and loved-one share completed');

  const finalized = await functionPost(
    'finalizeNegotiatedGoBooking',
    passengerToken,
    { requestId }
  );

  assert(
    finalized?.status === 'accepted' &&
    finalized?.agreedFare === 106 &&
    finalized?.paymentsReady === true &&
    finalized?.taxiId === driverId,
    `Negotiated booking finalization mismatch: ${JSON.stringify(finalized)}`
  );
  record('Payment and safety gate released reserved driver');

  for (const [status, patch] of [
    ['driver_on_way', { driverOnWayAt: Date.now() }],
    ['arrived', { arrivedAt: Date.now() }],
    ['passenger_onboard', { passengerOnboardAt: Date.now() }],
    ['in_transit', { tripStartedAt: Date.now() }]
  ]) {
    await rest(
      `requests/${requestId}`,
      'PATCH',
      driverToken,
      { status, ...patch }
    );
  }
  record('Driver progressed negotiated trip to in-transit');

  const settled = await functionPost(
    'settleTripPayment',
    driverToken,
    { requestId }
  );

  assert(
    settled?.settled === true &&
    settled?.serverCompleted === true &&
    settled?.settlement?.grossFare === 106 &&
    settled?.settlement?.platformCommission === 21.2 &&
    settled?.settlement?.driverNetFare === 84.8,
    `Server settlement mismatch: ${JSON.stringify(settled)}`
  );
  record('Server completed canonical financial settlement');

  const trip = (
    await db.ref(
      `requests/${requestId}`
    ).once('value')
  ).val();

  assert(
    trip?.status === 'completed' &&
    trip?.paymentSettlementStatus === 'settled' &&
    trip?.driverSettlement?.source === 'server_protected_go' &&
    trip?.agreedFare === 106 &&
    trip?.driverGrossFare === 106 &&
    trip?.platformCommission === 21.2 &&
    trip?.driverNetFare === 84.8,
    `Completed trip ledger mismatch: ${JSON.stringify(trip)}`
  );

  const driver = (
    await db.ref(
      `taxis/${driverId}`
    ).once('value')
  ).val();

  assert(
    driver?.totalTrips === 1 &&
    driver?.grossEarnings === 106 &&
    driver?.totalEarnings === 84.8 &&
    driver?.commissionAccrued === 21.2 &&
    driver?.commissionDebt === 21.2 &&
    driver?.earningsAppliedTrips?.[requestId]?.driverNetFare === 84.8,
    `Driver accounting mismatch: ${JSON.stringify(driver)}`
  );
  record('Driver earnings and cash commission debt posted exactly once');

  const secondSettle = await functionPost(
    'settleTripPayment',
    driverToken,
    { requestId }
  ).catch(error => ({ rejected: true, message: error.message }));

  const driverAfterRetry = (
    await db.ref(
      `taxis/${driverId}`
    ).once('value')
  ).val();

  assert(
    driverAfterRetry?.totalTrips === 1 &&
    driverAfterRetry?.totalEarnings === 84.8 &&
    driverAfterRetry?.commissionDebt === 21.2,
    `Settlement retry double-counted earnings: ${JSON.stringify({secondSettle, driverAfterRetry})}`
  );
  record('Settlement retry cannot double-credit driver');

  const terminalReject = await expectRestFailure(
    `requests/${requestId}`,
    'PATCH',
    passengerToken,
    { status: 'cancelled_by_commuter' }
  );

  assert(
    terminalReject.status >= 400,
    'Completed negotiated trip was not terminal.'
  );
  record('Completed negotiated settlement cannot be changed to cancellation');

  const driverLock = (
    await db.ref(
      `taxis/${driverId}/currentRequest`
    ).once('value')
  ).val();
  const passengerLock = (
    await db.ref(
      `commuters/${passengerId}/currentRequest`
    ).once('value')
  ).val();

  assert(
    !driverLock && !passengerLock,
    `Active request locks were not released: driver=${driverLock}, passenger=${passengerLock}`
  );
  record('Passenger and driver request locks released');
}

async function cleanup() {
  const updates = {
    [`requests/${requestId}`]: null,
    [`commuters/${passengerId}`]: null,
    [`taxis/${driverId}`]: null,
    [`notifications/commuters/${passengerId}`]: null,
    [`notifications/taxis/${driverId}`]: null,
    [`goFareAgreements/${requestId}`]: null,
    [`tripPayments/${requestId}`]: null,
    [`tripShareIssuers/${requestId}`]: null,
    [`tripChats/${requestId}`]: null
  };

  for (const token of shareTokens) {
    updates[`tripShareTokens/${token}`] = null;
  }

  await db.ref().update(updates).catch(error => {
    console.error('Cleanup database error:', error.message);
  });

  for (const uid of createdUsers) {
    await auth.deleteUser(uid).catch(error => {
      if (error.code !== 'auth/user-not-found') {
        console.error(`Cleanup auth user ${uid} error:`, error.message);
      }
    });
  }
}

async function main() {
  console.log(
    'Starting isolated production validation for protected negotiated Asiye Go cash lifecycle.'
  );

  try {
    const tokens = {
      passenger: await createTestUser(
        passengerUid,
        'E2E Negotiated Passenger'
      ),
      driver: await createTestUser(
        driverUid,
        'E2E Negotiated Driver'
      )
    };

    await seed();
    record('Temporary passenger and driver created at isolated coordinates');

    await validate(tokens);

    console.log('\nNEGOTIATED GO PRODUCTION E2E: PASS');
    console.log(`Checks passed: ${checks}`);
  } catch (error) {
    console.error('\nNEGOTIATED GO PRODUCTION E2E: FAIL');
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  } finally {
    await cleanup();
    console.log('Temporary negotiated-Go production data cleaned up.');
    await admin.app().delete().catch(error => {
      console.error('Firebase Admin shutdown error:', error.message);
    });
  }
}

main();
