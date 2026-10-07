'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const ENDPOINT = 'https://us-central1-asiye-80386.cloudfunctions.net/confirmTripWalletReady';

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
const passengerUid = `wallet-passenger-${stamp}`;
const driverUid = `wallet-driver-${stamp}`;
const passengerId = `wallet-passenger-profile-${stamp}`;
const driverId = `wallet-driver-profile-${stamp}`;
const requestId = `wallet-readiness-trip-${stamp}`;

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

async function check(token) {
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
  return { status: response.status, payload };
}

async function cleanup() {
  await admin.database().ref().update({
    [`requests/${requestId}`]: null,
    [`commuters/${passengerId}`]: null,
    [`taxis/${driverId}`]: null
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
        name: 'Wallet Test Passenger',
        walletBalance: 100,
        credits: 100
      },
      [`taxis/${driverId}`]: {
        authUid: driverUid,
        userUid: driverUid,
        name: 'Wallet Test Driver'
      },
      [`requests/${requestId}`]: {
        commuterId: passengerId,
        taxiId: driverId,
        driverAuthUid: driverUid,
        type: 'ehailing',
        paymentMethod: 'wallet',
        finalAmount: 75,
        status: 'in_transit'
      }
    });

    const driverToken = await getIdToken(driverUid);

    const enough = await check(driverToken);
    if (
      enough.status !== 200 ||
      enough.payload.ready !== true
    ) {
      throw new Error(
        `Expected sufficient wallet to pass, got ${enough.status}: ${JSON.stringify(enough.payload)}`
      );
    }
    console.log('PASS sufficient Asiye Wallet allows trip completion.');

    await admin.database()
      .ref(`commuters/${passengerId}`)
      .update({
        walletBalance: 50,
        credits: 50
      });

    const low = await check(driverToken);
    if (
      low.status !== 409 ||
      low.payload.ready !== false
    ) {
      throw new Error(
        `Expected insufficient wallet to block, got ${low.status}: ${JSON.stringify(low.payload)}`
      );
    }
    console.log('PASS insufficient Asiye Wallet blocks trip completion.');

    console.log('WALLET RIDE READINESS SMOKE: PASS');
  } finally {
    await cleanup();
    console.log('Temporary wallet readiness data cleaned up.');
  }
}

main().catch(error => {
  console.error('WALLET RIDE READINESS SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
