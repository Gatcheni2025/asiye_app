'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const STORAGE_BUCKET = 'asiye-80386.firebasestorage.app';
const ENDPOINT = 'https://us-central1-asiye-80386.cloudfunctions.net/uploadProfileImageProxy';

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
    databaseURL: DATABASE_URL,
    storageBucket: STORAGE_BUCKET
  });
}

const stamp = Date.now().toString(36);
const passengerUid = `profile-passenger-${stamp}`;
const driverUid = `profile-driver-${stamp}`;
const passengerId = `profile-passenger-record-${stamp}`;
const driverId = `profile-driver-record-${stamp}`;

const jpegBase64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';

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

async function upload({ uid, profileId, purpose }) {
  const token = await getIdToken(uid);
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://appassets.androidplatform.net'
    },
    body: JSON.stringify({
      userId: profileId,
      purpose,
      filename: 'profile.jpg',
      dataUrl: `data:image/jpeg;base64,${jpegBase64}`
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url || !payload.storagePath) {
    throw new Error(
      `Profile upload failed ${response.status}: ${JSON.stringify(payload)}`
    );
  }
  const imageResponse = await fetch(payload.url);
  if (!imageResponse.ok) {
    throw new Error(`Stored image URL returned HTTP ${imageResponse.status}`);
  }
  return payload;
}

async function cleanup(paths = []) {
  await admin.database().ref().update({
    [`commuters/${passengerId}`]: null,
    [`taxis/${driverId}`]: null
  }).catch(() => {});

  for (const uid of [passengerUid, driverUid]) {
    await admin.auth().deleteUser(uid).catch(() => {});
  }

  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  for (const objectPath of paths.filter(Boolean)) {
    await bucket.file(objectPath).delete({ ignoreNotFound: true }).catch(() => {});
  }

  await admin.app().delete().catch(() => {});
}

async function main() {
  const paths = [];
  try {
    await admin.auth().createUser({ uid: passengerUid });
    await admin.auth().createUser({ uid: driverUid });

    await admin.database().ref().update({
      [`commuters/${passengerId}`]: {
        authUid: passengerUid,
        name: 'Profile Smoke Passenger'
      },
      [`taxis/${driverId}`]: {
        authUid: driverUid,
        userUid: driverUid,
        name: 'Profile Smoke Driver'
      }
    });

    const passengerUpload = await upload({
      uid: passengerUid,
      profileId: passengerId,
      purpose: 'passenger-profile'
    });
    paths.push(passengerUpload.storagePath);

    const passenger = (
      await admin.database().ref(`commuters/${passengerId}`).once('value')
    ).val() || {};

    if (
      passenger.profileImageUrl !== passengerUpload.url ||
      passenger.passengerProfileImageUrl !== passengerUpload.url ||
      passenger.faceScanCompleted !== true
    ) {
      throw new Error('Passenger profile allocation fields were not saved.');
    }
    console.log('PASS passenger face scan stored and allocated to commuter profile.');

    const driverUpload = await upload({
      uid: driverUid,
      profileId: driverId,
      purpose: 'driver-profile'
    });
    paths.push(driverUpload.storagePath);

    const driver = (
      await admin.database().ref(`taxis/${driverId}`).once('value')
    ).val() || {};

    if (
      driver.profileImageUrl !== driverUpload.url ||
      driver.driverProfileImageUrl !== driverUpload.url ||
      driver.documents?.FACE !== driverUpload.url ||
      driver.faceScanCompleted !== true
    ) {
      throw new Error('Driver profile allocation fields were not saved.');
    }
    console.log('PASS driver face scan stored and allocated to taxi profile.');
    console.log('PROFILE IMAGE STORAGE SMOKE: PASS');
  } finally {
    await cleanup(paths);
    console.log('Temporary profile smoke data and images cleaned up.');
  }
}

main().catch(error => {
  console.error('PROFILE IMAGE STORAGE SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
