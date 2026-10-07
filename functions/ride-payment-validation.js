'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';

function apiKey() {
  const source = fs.readFileSync(
    path.join(__dirname, '../assets/passenger-v2/js/firebase.js'),
    'utf8'
  );
  const match = source.match(/apiKey:\s*[\r\n\s]*["']([^"']+)["']/);
  if (!match) throw new Error('Firebase API key not found.');
  return match[1];
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
    databaseURL: DATABASE_URL
  });
}

const stamp = Date.now().toString(36);
const passengerUid = `ridepay-passenger-${stamp}`;
const driverUid = `ridepay-driver-${stamp}`;
const passengerId = `ridepay-passenger-profile-${stamp}`;
const driverId = `ridepay-driver-profile-${stamp}`;
const requestIds = {
  wallet: `ridepay-wallet-${stamp}`,
  release: `ridepay-release-${stamp}`,
  cash: `ridepay-cash-${stamp}`,
  card: `ridepay-card-${stamp}`
};
let cardReference = '';

async function idToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
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
    throw new Error(payload?.error?.message || 'Unable to create Firebase session.');
  }
  return payload.idToken;
}

async function post(endpoint, token, body) {
  const response = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Firebase-Auth': `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://appassets.androidplatform.net'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `${endpoint} failed (${response.status}): ${payload.error || JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function createTrip(id, method, amount) {
  await admin.database().ref(`requests/${id}`).set({
    requestId: id,
    type: 'ehailing',
    rideType: 'go',
    commuterId: passengerId,
    taxiId: driverId,
    driverAuthUid: driverUid,
    paymentMethod: method,
    finalAmount: amount,
    calculatedPrice: amount,
    safetyShareCompleted: true,
    status: 'share_required',
    createdAt: Date.now()
  });
}

async function profile() {
  return (
    await admin.database()
      .ref(`commuters/${passengerId}`)
      .once('value')
  ).val() || {};
}

async function cleanup() {
  const updates = {
    [`commuters/${passengerId}`]: null,
    [`taxis/${driverId}`]: null
  };

  for (const id of Object.values(requestIds)) {
    updates[`requests/${id}`] = null;
    updates[`tripPayments/${id}`] = null;
  }

  if (cardReference) {
    updates[`tripPaymentReferences/${cardReference}`] = null;
  }

  await admin.database().ref().update(updates).catch(() => {});
  await admin.auth().deleteUser(passengerUid).catch(() => {});
  await admin.auth().deleteUser(driverUid).catch(() => {});
  await admin.app().delete().catch(() => {});
}

async function main() {
  try {
    await admin.auth().createUser({
      uid: passengerUid,
      email: `ridepay.${stamp}@example.com`
    });
    await admin.auth().createUser({
      uid: driverUid,
      email: `ridepay.driver.${stamp}@example.com`
    });

    await admin.database().ref().update({
      [`commuters/${passengerId}`]: {
        authUid: passengerUid,
        name: 'Ride Payment Passenger',
        email: `ridepay.${stamp}@example.com`,
        walletBalance: 100,
        credits: 100
      },
      [`taxis/${driverId}`]: {
        authUid: driverUid,
        userUid: driverUid,
        name: 'Ride Payment Driver'
      }
    });

    const passengerToken = await idToken(passengerUid);
    const driverToken = await idToken(driverUid);

    await createTrip(requestIds.wallet, 'wallet', 75);

    const walletHold = await post(
      'prepareTripPayment',
      passengerToken,
      { requestId: requestIds.wallet }
    );

    if (
      walletHold.status !== 'held' ||
      Number(walletHold.balance) !== 25
    ) {
      throw new Error(`Wallet hold was wrong: ${JSON.stringify(walletHold)}`);
    }

    console.log('PASS Go Wallet reserves fare immediately after booking.');

    const duplicate = await post(
      'prepareTripPayment',
      passengerToken,
      { requestId: requestIds.wallet }
    );

    const afterDuplicate = await profile();

    if (
      duplicate.status !== 'held' ||
      Number(afterDuplicate.walletBalance) !== 25
    ) {
      throw new Error('Wallet hold was not idempotent.');
    }

    console.log('PASS repeated Wallet preparation does not charge twice.');

    const settled = await post(
      'settleTripPayment',
      driverToken,
      { requestId: requestIds.wallet }
    );

    if (settled.settled !== true) {
      throw new Error('Wallet settlement did not complete.');
    }

    const afterSettle = await profile();

    if (
      Number(afterSettle.walletBalance) !== 25 ||
      afterSettle.walletRideHolds?.[requestIds.wallet]?.status !== 'captured'
    ) {
      throw new Error('Wallet settlement changed the available balance incorrectly.');
    }

    console.log('PASS held Wallet fare becomes captured at trip completion.');

    await createTrip(requestIds.release, 'wallet', 20);

    await post(
      'prepareTripPayment',
      passengerToken,
      { requestId: requestIds.release }
    );

    let afterReleaseHold = await profile();

    if (Number(afterReleaseHold.walletBalance) !== 5) {
      throw new Error('Second wallet hold did not reserve R20.');
    }

    await post(
      'releaseTripPayment',
      passengerToken,
      { requestId: requestIds.release }
    );

    afterReleaseHold = await profile();

    if (Number(afterReleaseHold.walletBalance) !== 25) {
      throw new Error('Cancelled wallet hold was not returned.');
    }

    console.log('PASS cancelled Wallet hold returns funds exactly once.');

    await createTrip(requestIds.cash, 'cash', 30);

    const cash = await post(
      'prepareTripPayment',
      passengerToken,
      { requestId: requestIds.cash }
    );

    if (cash.status !== 'cash_due') {
      throw new Error('Cash trip was not marked cash_due.');
    }

    const afterCash = await profile();

    if (Number(afterCash.walletBalance) !== 25) {
      throw new Error('Cash selection changed Wallet balance.');
    }

    console.log('PASS Cash leaves Wallet untouched.');

    await createTrip(requestIds.card, 'card', 50);

    const card = await post(
      'prepareTripPayment',
      passengerToken,
      { requestId: requestIds.card }
    );

    cardReference = String(card.reference || '');

    if (
      card.status !== 'payment_required' ||
      !/^https:\/\//.test(String(card.authorizationUrl || '')) ||
      !cardReference
    ) {
      throw new Error(`Card checkout was not initialized: ${JSON.stringify(card)}`);
    }

    const cardLedger = (
      await admin.database()
        .ref(`tripPayments/${requestIds.card}/${passengerId}`)
        .once('value')
    ).val();

    if (
      cardLedger?.provider !== 'paystack' ||
      cardLedger?.status !== 'initialized' ||
      Number(cardLedger?.amount) !== 50
    ) {
      throw new Error('Card ride ledger was not initialized correctly.');
    }

    console.log('PASS Card selection creates a Paystack fare charge checkout.');
    console.log('RIDE PAYMENT SMOKE: PASS');
  } finally {
    await cleanup();
    console.log('Temporary ride-payment smoke data cleaned up.');
  }
}

main().catch(error => {
  console.error('RIDE PAYMENT SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
