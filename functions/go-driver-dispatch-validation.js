'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const ENDPOINT = 'https://us-central1-asiye-80386.cloudfunctions.net/dispatchGoRideRequest';

function loadApiKey() {
  const source = fs.readFileSync(
    path.join(__dirname, '../assets/passenger-v2/js/firebase.js'),
    'utf8'
  );
  const match = source.match(/apiKey:\s*[\r\n\s]*["']([^"']+)["']/);
  if (!match) throw new Error('Firebase Web API key not found.');
  return match[1];
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
    databaseURL: DATABASE_URL
  });
}

const stamp = Date.now().toString(36);
const passengerUid = `dispatch-passenger-${stamp}`;
const driverUid = `dispatch-driver-${stamp}`;
const passengerId = `dispatch-passenger-profile-${stamp}`;
const driverId = `dispatch-driver-profile-${stamp}`;
const requestId = `dispatch-go-trip-${stamp}`;

async function getIdToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(loadApiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const payload = await response.json();
  if (!response.ok || !payload.idToken) {
    throw new Error(payload?.error?.message || 'Unable to create test session.');
  }
  return payload.idToken;
}

async function cleanup() {
  await admin.database().ref().update({
    [`requests/${requestId}`]: null,
    [`commuters/${passengerId}`]: null,
    [`taxis/${driverId}`]: null,
    [`notifications/taxis/${driverId}/${requestId}`]: null
  }).catch(() => {});

  await admin.auth().deleteUser(passengerUid).catch(() => {});
  await admin.auth().deleteUser(driverUid).catch(() => {});
  await admin.app().delete().catch(() => {});
}

async function main() {
  try {
    await admin.auth().createUser({ uid: passengerUid });
    await admin.auth().createUser({ uid: driverUid });

    await admin.database().ref().update({
      [`commuters/${passengerId}`]: {
        authUid: passengerUid,
        name: 'Dispatch Smoke Passenger'
      },
      [`taxis/${driverId}`]: {
        authUid: driverUid,
        userUid: driverUid,
        name: 'Dispatch Smoke Driver',
        isOnline: true,
        isFull: false,
        currentRequest: null,
        vehicleType: 'ehailing',
        latitude: -29.8587,
        longitude: 31.0218
      },
      [`requests/${requestId}`]: {
        requestId,
        type: 'ehailing',
        rideType: 'go',
        status: 'pending',
        commuterId: passengerId,
        commuterName: 'Dispatch Smoke Passenger',
        pickupAddress: 'Smoke pickup',
        commuterLocation: {
          latitude: -29.8587,
          longitude: 31.0218
        },
        destination: 'Smoke destination',
        finalAmount: 60,
        calculatedPrice: 60,
        paymentMethod: 'cash',
        createdAt: admin.database.ServerValue.TIMESTAMP
      }
    });

    const token = await getIdToken(passengerUid);
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'https://appassets.androidplatform.net'
      },
      body: JSON.stringify({ requestId })
    });

    const payload = await response.json().catch(() => ({}));

    if (
      !response.ok ||
      payload.ok !== true ||
      payload.mode !== 'broadcast'
    ) {
      throw new Error(
        `Dispatch failed ${response.status}: ${JSON.stringify(payload)}`
      );
    }

    const notification = (
      await admin.database()
        .ref(`notifications/taxis/${driverId}/${requestId}`)
        .once('value')
    ).val();

    if (
      !notification ||
      notification.requestId !== requestId ||
      notification.type !== 'ride_request'
    ) {
      throw new Error('Nearby driver did not receive the ride request notification.');
    }

    const trip = (
      await admin.database()
        .ref(`requests/${requestId}`)
        .once('value')
    ).val() || {};

    if (trip.status !== 'searching') {
      throw new Error(`Ride status was not advanced to searching: ${trip.status}`);
    }

    console.log('PASS passenger Go request dispatched to nearby online driver.');
    console.log('PASS driver notification record created.');
    console.log('GO DRIVER DISPATCH SMOKE: PASS');
  } finally {
    await cleanup();
    console.log('Temporary dispatch smoke data cleaned up.');
  }
}

main().catch(error => {
  console.error('GO DRIVER DISPATCH SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
