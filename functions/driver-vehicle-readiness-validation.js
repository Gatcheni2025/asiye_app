'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const FUNCTIONS_BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';
const STORAGE_BUCKET = 'asiye-80386.firebasestorage.app';

function apiKey() {
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
    databaseURL: DATABASE_URL,
    storageBucket: STORAGE_BUCKET
  });
}

const stamp = Date.now().toString(36);
const uid = `vehicle-driver-${stamp}`;
const driverId = `vehicle-profile-${stamp}`;
let storagePath = '';

async function idTokenFor(uidValue) {
  const customToken = await admin.auth().createCustomToken(uidValue);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey())}`,
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

async function post(name, token, body) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://appassets.androidplatform.net',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function cleanup() {
  await admin.database().ref(`taxis/${driverId}`).remove().catch(() => {});
  await admin.auth().deleteUser(uid).catch(() => {});
  if (storagePath) {
    await admin.storage().bucket(STORAGE_BUCKET).file(storagePath).delete().catch(() => {});
  }
  await admin.app().delete().catch(() => {});
}

async function main() {
  try {
    await admin.auth().createUser({ uid });
    await admin.database().ref(`taxis/${driverId}`).set({
      authUid: uid,
      userUid: uid,
      name: 'Vehicle Test Driver',
      vehicleApproved: true,
      vehicleApprovalStatus: 'approved',
      verificationStatus: 'verified',
      isOnline: false
    });

    const token = await idTokenFor(uid);

    const fakeImage = Buffer.alloc(512, 0xab).toString('base64');
    const upload = await post(
      'uploadProfileImageProxy',
      token,
      {
        userId: driverId,
        purpose: 'driver-vehicle',
        filename: 'vehicle.jpg',
        dataUrl: `data:image/jpeg;base64,${fakeImage}`
      }
    );

    if (
      upload.status !== 200 ||
      upload.payload.savedAs !== 'vehiclePhoto' ||
      !upload.payload.url
    ) {
      throw new Error(
        `Vehicle upload failed (${upload.status}): ${JSON.stringify(upload.payload)}`
      );
    }

    storagePath = String(upload.payload.storagePath || '');

    let profile = (
      await admin.database().ref(`taxis/${driverId}`).once('value')
    ).val();

    if (
      !profile?.vehiclePhoto ||
      profile?.profileImageUrl
    ) {
      throw new Error('Vehicle image was not allocated only to vehiclePhoto.');
    }

    console.log('PASS driver car picture saved to vehiclePhoto.');

    const submit = await post(
      'submitDriverVehicleForReview',
      token,
      {
        driverId,
        vehicle: {
          type: 'Sedan',
          make: 'Toyota',
          model: 'Corolla',
          colour: 'White',
          year: 2024,
          seats: 4,
          registration: 'TEST 123 GP'
        }
      }
    );

    if (
      submit.status !== 200 ||
      submit.payload.status !== 'pending'
    ) {
      throw new Error(
        `Vehicle review submission failed (${submit.status}): ${JSON.stringify(submit.payload)}`
      );
    }

    profile = (
      await admin.database().ref(`taxis/${driverId}`).once('value')
    ).val();

    if (
      Number(profile?.vehiclePending?.year) !== 2024 ||
      profile?.vehicleApproved !== false ||
      profile?.vehicleApprovalStatus !== 'pending'
    ) {
      throw new Error('Vehicle year/review state was not saved correctly.');
    }

    console.log('PASS driver vehicle year submitted without permission-denied.');
    console.log('DRIVER VEHICLE READINESS SMOKE: PASS');
  } finally {
    await cleanup();
    console.log('Temporary driver vehicle smoke-test data cleaned up.');
  }
}

main().catch(error => {
  console.error('DRIVER VEHICLE READINESS SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
