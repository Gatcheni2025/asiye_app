'use strict';

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'asiye-80386';
const DATABASE_URL = 'https://asiye-80386-default-rtdb.firebaseio.com';
const FUNCTIONS_BASE = 'https://us-central1-asiye-80386.cloudfunctions.net';

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
    databaseURL: DATABASE_URL
  });
}

const stamp = Date.now().toString(36);
const uid = `e2e_paystack_${stamp}`;
const commuterId = `e2e-paystack-${stamp}`;
let reference = '';

async function idTokenFor(uidValue) {
  const customToken = await admin.auth().createCustomToken(uidValue);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey())}`,
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
    throw new Error(payload?.error?.message || 'Unable to create Firebase test session.');
  }
  return payload.idToken;
}

async function postFunction(name, token, body, headers = {}) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body || {})
  });

  const text = await response.text();
  let payload = text;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) {}

  return {
    status: response.status,
    ok: response.ok,
    payload
  };
}

async function cleanup() {
  const updates = {
    [`commuters/${commuterId}`]: null
  };

  if (reference) {
    updates[`walletPayments/${reference}`] = null;
  }

  await admin.database().ref().update(updates).catch(() => {});
  await admin.auth().deleteUser(uid).catch(() => {});
  await admin.app().delete().catch(() => {});
}

async function main() {
  try {
    await admin.auth().createUser({
      uid,
      email: `paystack.${stamp}@example.com`,
      displayName: 'Asiye Paystack Test'
    });

    await admin.database().ref(`commuters/${commuterId}`).set({
      authUid: uid,
      name: 'Asiye Paystack Test',
      email: `paystack.${stamp}@example.com`,
      walletBalance: 0,
      credits: 0,
      createdAt: admin.database.ServerValue.TIMESTAMP
    });

    const token = await idTokenFor(uid);

    const initialized = await postFunction(
      'initializePaystackWalletTopup',
      token,
      { amount: 50 }
    );

    if (!initialized.ok) {
      throw new Error(
        `Paystack initialize failed (${initialized.status}): ${JSON.stringify(initialized.payload)}`
      );
    }

    reference = String(initialized.payload.reference || '');

    if (
      initialized.payload.provider !== 'paystack' ||
      initialized.payload.currency !== 'ZAR' ||
      Number(initialized.payload.amount) !== 50 ||
      !/^ASIYE-[A-Z0-9-]+$/.test(reference) ||
      !/^https:\/\//.test(String(initialized.payload.authorizationUrl || ''))
    ) {
      throw new Error(
        `Unexpected Paystack initialize response: ${JSON.stringify(initialized.payload)}`
      );
    }

    console.log('PASS Paystack test transaction initialized in ZAR.');
    console.log('PASS Hosted authorization URL returned.');
    console.log(`Reference: ${reference}`);

    const payment = (
      await admin.database()
        .ref(`walletPayments/${reference}`)
        .once('value')
    ).val();

    if (
      !payment ||
      payment.provider !== 'paystack' ||
      payment.status !== 'initialized' ||
      Number(payment.amount) !== 50
    ) {
      throw new Error('Server-side wallet payment ledger was not created correctly.');
    }

    console.log('PASS Server-only wallet payment ledger created.');

    const invalidWebhook = await postFunction(
      'paystackWebhook',
      '',
      {
        event: 'charge.success',
        data: {
          reference,
          amount: 5000,
          currency: 'ZAR',
          status: 'success'
        }
      },
      {
        'x-paystack-signature': 'invalid'
      }
    );

    if (invalidWebhook.status !== 401) {
      throw new Error(
        `Invalid webhook signature was not rejected (HTTP ${invalidWebhook.status}).`
      );
    }

    console.log('PASS Invalid Paystack webhook signature rejected.');
    console.log('PAYSTACK TEST-MODE BACKEND SMOKE: PASS');
  } finally {
    await cleanup();
    console.log('Temporary Paystack smoke-test data cleaned up.');
  }
}

main().catch(error => {
  console.error('PAYSTACK TEST-MODE BACKEND SMOKE: FAIL');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
