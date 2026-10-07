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

const ids = {
  goPassengerUid: `e2e_go_p_${stamp}_${suffix}`,
  clubOwnerUid: `e2e_club_o_${stamp}_${suffix}`,
  clubJoinerUid: `e2e_club_j_${stamp}_${suffix}`,
  driverUid: `e2e_drv_${stamp}_${suffix}`,
  goPassengerId: `e2e-go-passenger-${stamp}-${suffix}`,
  clubOwnerId: `e2e-club-owner-${stamp}-${suffix}`,
  clubJoinerId: `e2e-club-joiner-${stamp}-${suffix}`,
  driverId: `e2e-driver-${stamp}-${suffix}`,
  goTripId: `e2e_go_trip_${stamp}_${suffix}_01`,
  clubTripId: `e2e_club_trip_${stamp}_${suffix}_01`
};

const createdUsers = [];
const shareTokens = [];
const results = [];

function record(flow, step, detail = '') {
  results.push({ flow, step, status: 'PASS', detail });
  console.log(`PASS [${flow}] ${step}${detail ? ' — ' + detail : ''}`);
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
  const url = `${DATABASE_URL}/${pathName}.json?auth=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    throw new Error(
      `RTDB ${method} ${pathName} failed (${response.status}): ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function functionPost(name, token, body) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${name} failed (${response.status}): ${payload.error || JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function getShare(shareToken, expectedStatus) {
  const response = await fetch(
    `${FUNCTIONS_BASE}/getTripShare?share=${encodeURIComponent(shareToken)}`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (expectedStatus !== undefined) {
    assert(
      response.status === expectedStatus,
      `Expected getTripShare HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`
    );
    return payload;
  }
  if (!response.ok) {
    throw new Error(
      `getTripShare failed (${response.status}): ${payload.error || JSON.stringify(payload)}`
    );
  }
  return payload;
}

async function issueShare(idToken, requestId) {
  const payload = await functionPost(
    'createTripShareToken',
    idToken,
    { requestId }
  );
  assert(payload.shareToken, 'createTripShareToken did not return shareToken.');
  assert(
    String(payload.liveTrackingUrl || '').startsWith('https://asiye-80386.web.app/track.html?share='),
    'Secure share URL is not using the canonical Firebase Hosting route.'
  );
  shareTokens.push(payload.shareToken);
  return payload;
}

async function seedProfiles() {
  const updates = {
    [`commuters/${ids.goPassengerId}`]: {
      authUid: ids.goPassengerUid,
      name: 'E2E Go Passenger',
      phone: '+27000000001',
      verificationStatus: 'verified'
    },
    [`commuters/${ids.clubOwnerId}`]: {
      authUid: ids.clubOwnerUid,
      name: 'E2E Club Owner',
      phone: '+27000000002',
      verificationStatus: 'verified'
    },
    [`commuters/${ids.clubJoinerId}`]: {
      authUid: ids.clubJoinerUid,
      name: 'E2E Club Joiner',
      phone: '+27000000003',
      verificationStatus: 'verified'
    },
    [`taxis/${ids.driverId}`]: {
      authUid: ids.driverUid,
      userUid: ids.driverUid,
      name: 'E2E',
      surname: 'Driver',
      phone: '+27000000004',
      isOnline: true,
      verificationStatus: 'approved',
      vehicleApproved: true,
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleColor: 'White',
      vehicleYear: '2024',
      taxiRegistrationNumber: 'E2E-TEST',
      latitude: -29.8587,
      longitude: 31.0218
    }
  };
  await db.ref().update(updates);
}

async function validateGo(tokens) {
  const flow = 'Asiye Go';
  const pin = '2468';

  await rest(`requests/${ids.goTripId}`, 'PUT', tokens.goPassenger, {
    commuterId: ids.goPassengerId,
    commuterName: 'E2E Go Passenger',
    type: 'ehailing',
    rideType: 'go',
    status: 'share_required',
    safetyShareRequired: true,
    safetyShareCompleted: false,
    pickupPin: pin,
    pickupAddress: 'E2E Go Pickup',
    commuterLocation: { latitude: -29.8587, longitude: 31.0218 },
    destination: 'E2E Go Destination',
    destinationName: 'E2E Go Destination',
    destinationCoords: { latitude: -29.8465, longitude: 31.0292 },
    calculatedPrice: 95,
    createdAt: Date.now()
  });
  record(flow, 'Passenger created share-required booking');

  const share = await issueShare(tokens.goPassenger, ids.goTripId);
  let tracking = await getShare(share.shareToken);
  assert(tracking.trip?.status === 'share_required', 'Go share did not resolve staged trip.');
  assert(!('commuterId' in tracking.trip), 'Go public share leaked commuterId.');
  assert(!('pickupPin' in tracking.trip), 'Go public share leaked pickupPin.');
  record(flow, 'Family live tracking link issued and sanitized');

  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.goPassenger, {
    status: 'pending',
    safetyShareCompleted: true,
    safetyShareAt: Date.now()
  });
  record(flow, 'Passenger activated booking after required share');

  await rest(`notifications/taxis/${ids.driverId}/go-request`, 'PUT', tokens.goPassenger, {
    type: 'ride_request',
    requestId: ids.goTripId,
    title: 'E2E Go request',
    createdAt: { '.sv': 'timestamp' }
  });
  const driverNotice = await rest(
    `notifications/taxis/${ids.driverId}/go-request`,
    'GET',
    tokens.driver
  );
  assert(driverNotice?.requestId === ids.goTripId, 'Driver did not receive Go notification.');
  record(flow, 'Passenger → Driver notification delivered');

  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    currentRequest: ids.goTripId,
    isFull: true
  });
  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    taxiId: ids.driverId,
    driverAuthUid: ids.driverUid,
    driverName: 'E2E Driver',
    driverRating: 5,
    vehicleMake: 'Toyota',
    vehicleModel: 'Corolla',
    vehicleColor: 'White',
    vehicleReg: 'E2E-TEST',
    status: 'accepted',
    acceptedAt: Date.now()
  });
  let request = await rest(`requests/${ids.goTripId}`, 'GET', tokens.goPassenger);
  assert(request?.taxiId === ids.driverId && request?.status === 'accepted', 'Go driver acceptance did not persist.');
  record(flow, 'Driver accepted trip');

  await rest(`notifications/commuters/${ids.goPassengerId}/accepted`, 'PUT', tokens.driver, {
    type: 'driver_accepted',
    requestId: ids.goTripId,
    title: 'Driver accepted',
    createdAt: { '.sv': 'timestamp' }
  });
  const passengerNotice = await rest(
    `notifications/commuters/${ids.goPassengerId}/accepted`,
    'GET',
    tokens.goPassenger
  );
  assert(passengerNotice?.requestId === ids.goTripId, 'Passenger did not receive driver notification.');
  record(flow, 'Driver → Passenger notification delivered');

  await rest(
    `tripChats/${ids.goTripId}/${ids.goPassengerId}/passenger-msg`,
    'PUT',
    tokens.goPassenger,
    {
      text: 'E2E passenger message',
      senderUid: ids.goPassengerUid,
      role: 'passenger',
      createdAt: { '.sv': 'timestamp' }
    }
  );
  let chat = await rest(
    `tripChats/${ids.goTripId}/${ids.goPassengerId}/passenger-msg`,
    'GET',
    tokens.driver
  );
  assert(chat?.text === 'E2E passenger message', 'Driver could not read passenger chat message.');

  await rest(
    `tripChats/${ids.goTripId}/${ids.goPassengerId}/driver-msg`,
    'PUT',
    tokens.driver,
    {
      text: 'E2E driver message',
      senderUid: ids.driverUid,
      role: 'driver',
      createdAt: { '.sv': 'timestamp' }
    }
  );
  chat = await rest(
    `tripChats/${ids.goTripId}/${ids.goPassengerId}/driver-msg`,
    'GET',
    tokens.goPassenger
  );
  assert(chat?.text === 'E2E driver message', 'Passenger could not read driver chat message.');
  record(flow, 'Two-way trip chat delivered');

  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    status: 'driver_on_way',
    driverOnWayAt: Date.now()
  });
  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    latitude: -29.8552,
    longitude: 31.0246
  });
  tracking = await getShare(share.shareToken);
  assert(
    Math.abs(Number(tracking.taxi?.latitude) - (-29.8552)) < 0.00001 &&
    Math.abs(Number(tracking.taxi?.longitude) - 31.0246) < 0.00001,
    'Family tracking did not reflect Go driver movement.'
  );
  record(flow, 'Live driver movement visible to family tracking');

  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    status: 'arrived',
    arrivedAt: Date.now()
  });
  request = await rest(`requests/${ids.goTripId}`, 'GET', tokens.driver);
  assert(String(request.pickupPin) === pin, 'Driver could not access expected Go PIN.');
  record(flow, 'Driver arrived and Go PIN matched');

  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    status: 'passenger_onboard',
    passengerOnboardAt: Date.now()
  });
  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    status: 'in_transit',
    tripStartedAt: Date.now()
  });
  request = await rest(`requests/${ids.goTripId}`, 'GET', tokens.goPassenger);
  assert(request?.status === 'in_transit', 'Go trip did not enter in_transit.');
  record(flow, 'PIN verification state advanced to in-transit');

  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    latitude: -29.8490,
    longitude: 31.0280
  });
  tracking = await getShare(share.shareToken);
  assert(
    Math.abs(Number(tracking.taxi?.latitude) - (-29.8490)) < 0.00001,
    'Go family tracking stopped updating in transit.'
  );
  record(flow, 'In-transit movement continued updating');

  await rest(`requests/${ids.goTripId}`, 'PATCH', tokens.driver, {
    status: 'completed',
    completedAt: Date.now()
  });
  tracking = await getShare(share.shareToken);
  assert(tracking.trip?.ended === true && tracking.trip?.status === 'completed', 'Go tracking did not show trip ended.');
  record(flow, 'Trip completed and family tracking marked ended');
}

async function validateClub(tokens) {
  const flow = 'Asiye Club/Work';
  const ownerPin = '1357';
  const joinerPin = '3579';

  await rest(`requests/${ids.clubTripId}`, 'PUT', tokens.clubOwner, {
    commuterId: ids.clubOwnerId,
    commuterName: 'E2E Club Owner',
    type: 'club',
    rideType: 'club',
    clubMode: 'club2',
    status: 'share_required',
    safetyShareRequired: true,
    safetyShareCompleted: false,
    capacity: 2,
    maxCapacity: 2,
    passengerCount: 1,
    pickupAddress: 'E2E Club Pickup A',
    commuterLocation: { latitude: -29.8587, longitude: 31.0218 },
    destination: 'E2E Work Destination',
    destinationName: 'E2E Work Destination',
    destinationCoords: { latitude: -29.8422, longitude: 31.0311 },
    calculatedPrice: 200,
    marketReferenceFare: 200,
    passengers: {
      [ids.clubOwnerId]: {
        commuterId: ids.clubOwnerId,
        name: 'E2E Club Owner',
        pickupPin: ownerPin,
        pickupAddress: 'E2E Club Pickup A',
        pickupLat: -29.8587,
        pickupLng: 31.0218,
        status: 'waiting_pool',
        safetyShareCompleted: false
      }
    },
    createdAt: Date.now()
  });
  record(flow, 'Owner created share-required pool');

  const ownerShare = await issueShare(tokens.clubOwner, ids.clubTripId);
  await getShare(ownerShare.shareToken);
  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.clubOwner, {
    status: 'pooling',
    safetyShareCompleted: true,
    safetyShareAt: Date.now(),
    [`passengers/${ids.clubOwnerId}/safetyShareCompleted`]: true,
    [`passengers/${ids.clubOwnerId}/safetyShareAt`]: Date.now()
  });
  record(flow, 'Owner family share activated and pool opened');

  const joinerShare = await issueShare(tokens.clubJoiner, ids.clubTripId);
  const inactive = await getShare(joinerShare.shareToken, 409);
  assert(
    String(inactive.error || '').includes('Waiting for the passenger'),
    'Pre-join Club token was not inactive before membership.'
  );
  record(flow, 'Prospective passenger received inactive pre-join share capability');

  const joined = await functionPost(
    'joinClubPoolSecure',
    tokens.clubJoiner,
    {
      poolId: ids.clubTripId,
      shareToken: joinerShare.shareToken,
      pickupPin: joinerPin,
      pickupAddress: 'E2E Club Pickup B',
      pickupLat: -29.8530,
      pickupLng: 31.0180,
      destination: 'E2E Work Destination',
      destinationLat: -29.8422,
      destinationLng: 31.0311,
      departureTime: '08:00',
      paymentMethod: 'cash'
    }
  );
  assert(joined?.passengerCount === 2, 'Secure Club join did not reach two passengers.');
  let request = await rest(`requests/${ids.clubTripId}`, 'GET', tokens.clubOwner);
  assert(
    request?.passengers?.[ids.clubJoinerId]?.commuterId === ids.clubJoinerId,
    'Joined Club passenger was not stored.'
  );
  assert(request?.status === 'pool_ready', `Expected pool_ready after secure join, got ${request?.status}`);
  await getShare(joinerShare.shareToken);
  record(flow, 'Secure Club join completed, token activated and pool became ready');

  await rest(`notifications/taxis/${ids.driverId}/club-request`, 'PUT', tokens.clubOwner, {
    type: 'club_ready',
    requestId: ids.clubTripId,
    title: 'E2E Club ready',
    createdAt: { '.sv': 'timestamp' }
  });
  const driverNotice = await rest(
    `notifications/taxis/${ids.driverId}/club-request`,
    'GET',
    tokens.driver
  );
  assert(driverNotice?.requestId === ids.clubTripId, 'Driver did not receive Club notification.');
  record(flow, 'Club notification delivered to driver');

  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    currentRequest: ids.clubTripId,
    isFull: true
  });
  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.driver, {
    taxiId: ids.driverId,
    driverAuthUid: ids.driverUid,
    driverName: 'E2E Driver',
    driverRating: 5,
    vehicleMake: 'Toyota',
    vehicleModel: 'Corolla',
    vehicleColor: 'White',
    vehicleReg: 'E2E-TEST',
    status: 'pool_ready',
    acceptedAt: Date.now(),
    poolReady: true
  });
  request = await rest(`requests/${ids.clubTripId}`, 'GET', tokens.clubOwner);
  assert(request?.taxiId === ids.driverId, 'Club driver acceptance did not persist.');
  record(flow, 'Driver accepted ready Club/Work pool');

  await rest(
    `tripChats/${ids.clubTripId}/${ids.clubJoinerId}/passenger-msg`,
    'PUT',
    tokens.clubJoiner,
    {
      text: 'E2E Club passenger message',
      senderUid: ids.clubJoinerUid,
      role: 'passenger',
      createdAt: { '.sv': 'timestamp' }
    }
  );
  let chat = await rest(
    `tripChats/${ids.clubTripId}/${ids.clubJoinerId}/passenger-msg`,
    'GET',
    tokens.driver
  );
  assert(chat?.text === 'E2E Club passenger message', 'Driver could not read Club chat.');

  await rest(
    `tripChats/${ids.clubTripId}/${ids.clubJoinerId}/driver-msg`,
    'PUT',
    tokens.driver,
    {
      text: 'E2E Club driver message',
      senderUid: ids.driverUid,
      role: 'driver',
      createdAt: { '.sv': 'timestamp' }
    }
  );
  chat = await rest(
    `tripChats/${ids.clubTripId}/${ids.clubJoinerId}/driver-msg`,
    'GET',
    tokens.clubJoiner
  );
  assert(chat?.text === 'E2E Club driver message', 'Club passenger could not read driver chat.');
  record(flow, 'Club two-way chat delivered');

  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.driver, {
    status: 'collecting_passengers',
    collectionStartedAt: Date.now()
  });
  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    latitude: -29.8560,
    longitude: 31.0200
  });
  let tracking = await getShare(ownerShare.shareToken);
  assert(
    Math.abs(Number(tracking.taxi?.latitude) - (-29.8560)) < 0.00001,
    'Club owner family tracking did not reflect driver movement.'
  );
  tracking = await getShare(joinerShare.shareToken);
  assert(
    Math.abs(Number(tracking.taxi?.longitude) - 31.0200) < 0.00001,
    'Joined Club passenger tracking did not reflect driver movement.'
  );
  record(flow, 'Family tracking followed driver during Club collection');

  for (const [passengerId, expectedPin] of [
    [ids.clubOwnerId, ownerPin],
    [ids.clubJoinerId, joinerPin]
  ]) {
    await rest(
      `requests/${ids.clubTripId}/passengers/${passengerId}`,
      'PATCH',
      tokens.driver,
      {
        status: 'arrived',
        arrivedAt: Date.now()
      }
    );
    request = await rest(`requests/${ids.clubTripId}`, 'GET', tokens.driver);
    assert(
      String(request?.passengers?.[passengerId]?.pickupPin || '') === expectedPin,
      `Driver could not validate PIN for ${passengerId}.`
    );
    await rest(
      `requests/${ids.clubTripId}/passengers/${passengerId}`,
      'PATCH',
      tokens.driver,
      {
        status: 'passenger_onboard',
        passengerOnboardAt: Date.now()
      }
    );
  }
  record(flow, 'Both Club passenger PINs validated and pickups confirmed');

  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.driver, {
    status: 'all_onboard',
    allOnboardAt: Date.now()
  });
  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.driver, {
    status: 'in_transit',
    tripStartedAt: Date.now(),
    [`passengers/${ids.clubOwnerId}/status`]: 'in_transit',
    [`passengers/${ids.clubJoinerId}/status`]: 'in_transit'
  });
  request = await rest(`requests/${ids.clubTripId}`, 'GET', tokens.clubJoiner);
  assert(
    request?.status === 'in_transit' &&
    request?.passengers?.[ids.clubOwnerId]?.status === 'in_transit' &&
    request?.passengers?.[ids.clubJoinerId]?.status === 'in_transit',
    'Club trip did not advance all passengers to in_transit.'
  );
  record(flow, 'All onboard → in-transit state completed');

  await rest(`taxis/${ids.driverId}`, 'PATCH', tokens.driver, {
    latitude: -29.8450,
    longitude: 31.0300
  });
  tracking = await getShare(joinerShare.shareToken);
  assert(
    Math.abs(Number(tracking.taxi?.latitude) - (-29.8450)) < 0.00001,
    'Club tracking stopped updating in transit.'
  );
  record(flow, 'Club in-transit movement continued updating');

  await rest(`requests/${ids.clubTripId}`, 'PATCH', tokens.driver, {
    status: 'completed',
    completedAt: Date.now(),
    [`passengers/${ids.clubOwnerId}/status`]: 'completed',
    [`passengers/${ids.clubJoinerId}/status`]: 'completed'
  });

  const ownerEnded = await getShare(ownerShare.shareToken);
  const joinerEnded = await getShare(joinerShare.shareToken);
  assert(
    ownerEnded.trip?.ended === true &&
    joinerEnded.trip?.ended === true,
    'Club family tracking did not show completed state.'
  );
  record(flow, 'Club/Work trip completed and both family links marked ended');
}

async function cleanup() {
  const cleanupUpdates = {
    [`requests/${ids.goTripId}`]: null,
    [`requests/${ids.clubTripId}`]: null,
    [`tripChats/${ids.goTripId}`]: null,
    [`tripChats/${ids.clubTripId}`]: null,
    [`commuters/${ids.goPassengerId}`]: null,
    [`commuters/${ids.clubOwnerId}`]: null,
    [`commuters/${ids.clubJoinerId}`]: null,
    [`taxis/${ids.driverId}`]: null,
    [`notifications/commuters/${ids.goPassengerId}`]: null,
    [`notifications/commuters/${ids.clubOwnerId}`]: null,
    [`notifications/commuters/${ids.clubJoinerId}`]: null,
    [`notifications/taxis/${ids.driverId}`]: null,
    [`tripShareIssuers/${ids.goTripId}`]: null,
    [`tripShareIssuers/${ids.clubTripId}`]: null
  };

  for (const token of shareTokens) {
    cleanupUpdates[`tripShareTokens/${token}`] = null;
  }

  await db.ref().update(cleanupUpdates).catch(error => {
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
  console.log('Starting controlled production trip validation with isolated temporary identities.');

  let tokens;
  try {
    tokens = {
      goPassenger: await createTestUser(ids.goPassengerUid, 'E2E Go Passenger'),
      clubOwner: await createTestUser(ids.clubOwnerUid, 'E2E Club Owner'),
      clubJoiner: await createTestUser(ids.clubJoinerUid, 'E2E Club Joiner'),
      driver: await createTestUser(ids.driverUid, 'E2E Driver')
    };

    await seedProfiles();
    record('Setup', 'Temporary passenger and driver identities created');

    await validateGo(tokens);

    await db.ref(`taxis/${ids.driverId}`).update({
      currentRequest: null,
      isFull: false
    });

    await validateClub(tokens);

    console.log('\nCONTROLLED PRODUCTION E2E: PASS');
    console.log(`Checks passed: ${results.length}`);
  } catch (error) {
    console.error('\nCONTROLLED PRODUCTION E2E: FAIL');
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  } finally {
    await cleanup();
    console.log('Temporary E2E data and Auth users cleaned up.');

    // Close the Admin SDK's Realtime Database connection so the
    // GitHub Actions process exits immediately instead of waiting
    // for the workflow timeout after validation has finished.
    await admin.app().delete().catch(error => {
      console.error('Firebase Admin shutdown error:', error.message);
    });
  }
}

main();
