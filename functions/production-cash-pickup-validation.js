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
const passengerUid = `e2e_cash_p_${stamp}_${suffix}`;
const driverUid = `e2e_cash_d_${stamp}_${suffix}`;
const passengerId = `e2e-cash-p-${stamp}-${suffix}`;
const driverId = `e2e-cash-d-${stamp}-${suffix}`;
const requestId = `e2e_cash_go_${stamp}_${suffix}`;
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
      verificationStatus: 'verified',
      vehicleApproved: true,
      vehicleApprovalStatus: 'approved',
      enrollmentVersion: 2,
      vehicleType: 'ehailing',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleColor: 'White',
      vehicleYear: 2024,
      vehicleSeats: 4,
      seats: 4,
      taxiRegistrationNumber: 'NEG-E2E',
      profileImageUrl: 'https://example.invalid/e2e-driver-profile.jpg',
      vehiclePhoto: 'https://example.invalid/e2e-driver-vehicle.jpg',
      vehicle: {
        type: 'ehailing',
        make: 'Toyota',
        model: 'Corolla',
        colour: 'White',
        year: 2024,
        seats: 4,
        registration: 'NEG-E2E'
      },
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
  const passengerToken = tokens.passenger, driverToken = tokens.driver;
  await rest(`requests/${requestId}`, 'PUT', passengerToken, {
    requestId, type:'ehailing', rideType:'go', carCategory:'go', commuterId:passengerId,
    commuterName:'Isolated Cash Test', status:'pending', pickupAddress:'Isolated test pickup',
    commuterLocation:{latitude:-45,longitude:0}, destination:'Isolated test destination',
    destinationCoords:{latitude:-44.95,longitude:0.05}, routeDistanceKm:10, routeDurationMinutes:20,
    calculatedPrice:106, finalAmount:106, passengerOffer:106, fareStatus:'passenger_offer',
    negotiationEnabled:true, negotiationRound:1, commissionRate:0.2, paymentMethod:'cash',
    paymentStatus:'negotiation_pending', paymentsReady:false, requirePin:true,
    safetyShareRequired:true, safetyShareCompleted:false, goContinuationRequestedVersion:2,
    cashCollectionVersion:2, createdAt:Date.now()
  });
  await functionPost('submitGoFareOffer', passengerToken, {requestId,amount:106});
  // Notify only the isolated driver; do not broadcast to production customers.
  await db.ref(`notifications/taxis/${driverId}/${requestId}`).set({requestId,type:'go_fare_offer'});
  const accepted = await functionPost('acceptGoFareOffer', driverToken, {requestId});
  assert(accepted.status === 'accepted', 'Cash fare acceptance remained payment-gated.');
  let trip = (await db.ref(`requests/${requestId}`).once('value')).val();
  assert(trip.paymentsReady === true && trip.paymentStatus === 'cash_due' && !trip.cashCollectedAt,
    'Cash must be due after dropoff, never collected before pickup.');
  assert(/^\d{4}$/.test(String(trip.pickupPin)), 'System pickup PIN missing.');
  const pin = trip.pickupPin;
  record('Agreed cash fare immediately unlocked pickup without passenger payment preparation');
  const earlySettle = await functionPost('settleTripPayment',driverToken,{requestId}).catch(e=>({rejected:true}));
  assert(earlySettle.rejected, 'Cash settled before pickup/dropoff.');
  record('Pre-trip cash collection and settlement stayed blocked');
  const earlyPin = await functionPost('goTripActionSecure',driverToken,{requestId,action:'verifyPin',pin}).catch(e=>({rejected:true}));
  assert(earlyPin.rejected,'Pickup PIN accepted before driver arrival.');
  await functionPost('goTripActionSecure',driverToken,{requestId,action:'onWay'});
  await db.ref(`taxis/${driverId}`).update({latitude:-45,longitude:0,lastSeen:Date.now()});
  await functionPost('goTripActionSecure',driverToken,{requestId,action:'arrive'});
  const share = await issueShare(passengerToken);
  await functionPost('goTripActionSecure',passengerToken,{requestId,action:'shareComplete'});
  const wrong = await functionPost('goTripActionSecure',driverToken,{requestId,action:'verifyPin',pin:pin === '0000' ? '9999':'0000'});
  assert(wrong.pinValid === false && wrong.status === 'arrived', 'Wrong pickup PIN advanced the trip.');
  const verified = await functionPost('goTripActionSecure',driverToken,{requestId,action:'verifyPin',pin});
  assert(verified.pinValid === true && verified.status === 'in_transit', 'Pickup PIN did not unlock departure.');
  trip = (await db.ref(`requests/${requestId}`).once('value')).val();
  assert(trip.pinVerifiedAt && trip.tripStartedAt && !trip.cashCollectedAt,'PIN/cash ordering mismatch.');
  record('Driver checked PIN at pickup before destination departure');
  const earlyCash = await functionPost('goTripActionSecure',driverToken,{requestId,action:'collectCash',cashCollected:true}).catch(e=>({rejected:true}));
  assert(earlyCash.rejected,'Cash was confirmed at pickup rather than dropoff.');
  await db.ref(`taxis/${driverId}`).update({latitude:-44.95,longitude:0.05,lastSeen:Date.now()});
  await functionPost('goTripActionSecure',driverToken,{requestId,action:'collectCash',cashCollected:true});
  const settled = await functionPost('settleTripPayment',driverToken,{requestId});
  assert(settled.serverCompleted === true && settled.settled === true,'Dropoff settlement failed.');
  trip = (await db.ref(`requests/${requestId}`).once('value')).val();
  assert(trip.status === 'completed' && trip.cashCollectedAt && trip.cashCollectedAt >= trip.pinVerifiedAt,
    'Pickup PIN must precede dropoff cash collection.');
  record('Cash receipt and trip completion happened at dropoff, without a second PIN');
  const latePin = await functionPost('goTripActionSecure',driverToken,{requestId,action:'verifyPin',pin}).catch(e=>({rejected:true}));
  assert(latePin.rejected,'Completed trip accepted a dropoff PIN.');
  await functionPost('settleTripPayment',driverToken,{requestId}).catch(()=>{});
  const driver = (await db.ref(`taxis/${driverId}`).once('value')).val();
  assert(driver.totalTrips === 1 && driver.totalEarnings === 84.8 && driver.commissionDebt === 21.2,
    'Cash completion counted driver earnings more than once.');
  record('Repeated completion kept driver earnings and cash commission idempotent');
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
