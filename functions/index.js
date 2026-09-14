const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const querystring = require("querystring");

// =================================================================
// --- INITIALIZE FIREBASE ADMIN ---
// =================================================================
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// =================================================================
// --- PAYFAST WALLET CONFIG & HELPERS (2nd Gen) ---
// =================================================================
const merchantId = defineSecret("PAYFAST_MERCHANT_ID");
const merchantKey = defineSecret("PAYFAST_MERCHANT_KEY");
const passphrase = defineSecret("PAYFAST_PASSPHRASE");
const processUrl = "https://sandbox.payfast.co.za/eng/process";
const siteUrl = "https://asiye.cloud";
const notifyUrl = "https://us-central1-asiye-80386.cloudfunctions.net/payfastWalletNotify";

function encode(value) {
  return encodeURIComponent(String(value).trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (character) =>
      "%" + character.charCodeAt(0).toString(16).toUpperCase());
}

function signature(fields, phrase) {
  const pairs = Object.entries(fields)
    .filter(([key, value]) => key !== "signature" && value !== "")
    .map(([key, value]) => `${key}=${encode(value)}`);
  if (phrase) pairs.push(`passphrase=${encode(phrase)}`);
  return crypto.createHash("md5").update(pairs.join("&")).digest("hex");
}

function cors(request, response) {
  const origin = request.get("origin");
  if (origin === siteUrl) response.set("Access-Control-Allow-Origin", origin);
  if (!origin || origin === "null") response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

// =================================================================
// --- NEW WALLET FUNCTIONS (2nd Gen) ---
// =================================================================
exports.createPayfastWalletTopup = onRequest(
  { region: "us-central1", secrets: [merchantId, merchantKey, passphrase] },
  async (request, response) => {
    cors(request, response);
    if (request.method === "OPTIONS") return response.status(204).send("");
    if (request.method !== "POST") return response.status(405).json({ error: "POST required." });
    try {
      const match = (request.get("authorization") || "").match(/^Bearer (.+)$/);
      if (!match) return response.status(401).json({ error: "Sign in again." });
      const decoded = await admin.auth().verifyIdToken(match[1]);
      const amount = Number(request.body?.amount);
      if (!Number.isFinite(amount) || amount < 10 || amount > 5000) {
        return response.status(400).json({ error: "Amount must be between R10 and R5,000." });
      }

      const paymentId = admin.database().ref("walletPayments").push().key;
      const fields = {
        merchant_id: merchantId.value(),
        merchant_key: merchantKey.value(),
        return_url: `${siteUrl}/success.html`,
        cancel_url: `${siteUrl}/cancelled.html`,
        notify_url: notifyUrl,
        name_first: decoded.name?.split(" ")[0] || "Asiye",
        email_address: decoded.email || "",
        m_payment_id: paymentId,
        amount: amount.toFixed(2),
        item_name: "Asiye Wallet Top-up",
        custom_str1: decoded.uid
      };
      fields.signature = signature(fields, passphrase.value());

      await admin.database().ref(`walletPayments/${paymentId}`).set({
        uid: decoded.uid,
        amount: amount.toFixed(2),
        status: "pending",
        environment: "sandbox",
        createdAt: admin.database.ServerValue.TIMESTAMP
      });
      return response.json({ action: processUrl, fields });
    } catch (error) {
      console.error("Create wallet top-up failed", error);
      return response.status(500).json({ error: "Unable to start the payment." });
    }
  });

exports.payfastWalletNotify = onRequest(
  { region: "us-central1", secrets: [merchantId, merchantKey, passphrase] },
  async (request, response) => {
    if (request.method !== "POST") return response.status(405).send("POST required");
    try {
      const payload = Object.fromEntries(
        new URLSearchParams(request.rawBody.toString("utf8")).entries());
      const receivedSignature = payload.signature;
      if (!receivedSignature ||
        signature(payload, passphrase.value()) !== receivedSignature) {
        return response.status(400).send("Invalid signature");
      }
      if (payload.merchant_id !== merchantId.value()) {
        return response.status(400).send("Invalid merchant");
      }

      const paymentId = payload.m_payment_id;
      const ref = admin.database().ref(`walletPayments/${paymentId}`);
      const snapshot = await ref.once("value");
      const payment = snapshot.val();
      if (!payment || payment.status === "complete") return response.status(200).send("OK");
      if (payload.payment_status !== "COMPLETE" ||
        Number(payload.amount_gross).toFixed(2) !== Number(payment.amount).toFixed(2) ||
        payload.custom_str1 !== payment.uid) {
        return response.status(400).send("Payment mismatch");
      }

      const validationBody = new URLSearchParams(payload).toString();
      const validation = await fetch(
        "https://sandbox.payfast.co.za/eng/query/validate",
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: validationBody });
      if ((await validation.text()).trim() !== "VALID") {
        return response.status(400).send("PayFast validation failed");
      }

      const balanceRef = admin.database().ref(`commuters/${payment.uid}/credits`);
      const balance = await balanceRef.transaction(current =>
        Number(current || 0) + Number(payment.amount));
      const newBalance = Number(balance.snapshot.val() || 0);
      await admin.database().ref().update({
        [`commuters/${payment.uid}/walletBalance`]: newBalance,
        [`walletPayments/${paymentId}/status`]: "complete",
        [`walletPayments/${paymentId}/pfPaymentId`]: payload.pf_payment_id || "",
        [`walletPayments/${paymentId}/completedAt`]: admin.database.ServerValue.TIMESTAMP
      });
      return response.status(200).send("OK");
    } catch (error) {
      console.error("PayFast ITN failed", error);
      return response.status(500).send("Retry");
    }
  });


// =================================================================
// --- RESTORED: CUSTOM AUTH TOKEN GENERATOR (1st Gen) ---
// =================================================================
exports.createCustomToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const uid = data.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with a `uid` argument.");
  }
  try {
    const customToken = await admin.auth().createCustomToken(uid);
    console.log(`Successfully created custom token for UID: ${uid}`);
    return { token: customToken };
  } catch (error) {
    console.error(`Error creating custom token for UID: ${uid}`, error);
    throw new functions.https.HttpsError("internal", "Unable to create custom token.");
  }
});


// =================================================================
// --- RESTORED: PAYFAST SUBSCRIPTION ITN HANDLER (1st Gen) ---
// =================================================================
exports.payfastITN = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const receivedData = querystring.parse(req.rawBody.toString());
    let pfParamString = "";
    for (const key in receivedData) {
      if (key !== "signature") {
        pfParamString += `${key}=${encodeURIComponent(receivedData[key].trim()).replace(/%20/g, "+")}&`;
      }
    }
    pfParamString = pfParamString.slice(0, -1);

    const generatedSignature = crypto.createHash("md5").update(pfParamString).digest("hex");

    if (generatedSignature !== receivedData.signature) {
      return res.status(400).send("Invalid Signature");
    }

    const paymentStatus = receivedData.payment_status;
    const transactionId = receivedData.pf_payment_id;
    const customPaymentId = receivedData.m_payment_id;

    if (paymentStatus === "COMPLETE") {
      const parts = customPaymentId.split('-');
      if (parts.length < 2) {
        return res.status(400).send("Invalid Payment ID");
      }
      const userId = parts[1];
      const userRef = admin.database().ref(`/commuters/${userId}`);
      const oneMonthFromNow = new Date().getTime() + (30 * 24 * 60 * 60 * 1000);

      await userRef.update({
        hasActiveSubscription: true,
        subscriptionExpiry: oneMonthFromNow,
        lastTransactionId: transactionId,
      });
      console.log(`Successfully activated subscription for user: ${userId}`);
    }
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Error handling PayFast ITN:", error);
    return res.status(500).send("Internal Server Error");
  }
});

// =================================================================
// --- RESTORED: CHAT NOTIFICATIONS (1st Gen) ---
// =================================================================
exports.sendChatNotification = functions.database
  .ref('/chats/{chatId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const message = snapshot.val();
    const { chatId } = context.params;

    if (!message || !message.senderId) return null;

    try {
      const chatSnapshot = await admin.database().ref(`/chats/${chatId}`).once('value');
      const chatData = chatSnapshot.val();
      if (!chatData || !chatData.participants) return null;

      let receiverId = null;
      let receiverType = null;
      for (const [userId, userType] of Object.entries(chatData.participants)) {
        if (userId !== message.senderId) {
          receiverId = userId;
          receiverType = userType;
          break;
        }
      }

      if (!receiverId) return null;

      const userNode = receiverType === 'driver' ? 'taxis' : 'commuters';
      const userSnapshot = await admin.database().ref(`/${userNode}/${receiverId}/fcmToken`).once('value');
      const fcmToken = userSnapshot.val();

      if (!fcmToken) return null;

      const payload = {
        notification: {
          title: `New message from ${message.senderName}`,
          body: message.message.length > 100 ? message.message.substring(0, 100) + '...' : message.message,
          sound: 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        data: { type: 'chat', chatId: chatId },
        token: fcmToken
      };

      await admin.messaging().send(payload);
      return console.log('Notification sent successfully.');

    } catch (error) {
      console.error('Error sending chat notification:', error);
      return null;
    }
  });

// =================================================================
// --- RESTORED: DRIVER NOTIFICATIONS (1st Gen) ---
// =================================================================
exports.notifyAdminOnDriverVerification = functions.database
  .ref('/verificationQueue/{driverId}')
  .onCreate(async (snapshot, context) => {
    const verificationData = snapshot.val();
    if (!verificationData) return null;
    console.log(`Admin Notification: New driver verification from ${verificationData.driverName}`);
    return null;
  });

exports.notifyDriverOnVerificationStatus = functions.database
  .ref('/taxis/{driverId}/verificationStatus')
  .onUpdate(async (change, context) => {
    const { driverId } = context.params;
    const newStatus = change.after.val();

    if (newStatus !== 'verified') return null;

    try {
      const fcmToken = (await admin.database().ref(`/taxis/${driverId}/fcmToken`).once('value')).val();
      if (!fcmToken) return null;

      const driverData = (await admin.database().ref(`/taxis/${driverId}`).once('value')).val();
      const driverName = driverData ? `${driverData.name || ''} ${driverData.surname || ''}`.trim() : 'Driver';

      const payload = {
        notification: {
          title: 'Account Verified! 🎉',
          body: `Congratulations ${driverName}! You can now start accepting rides.`,
          sound: 'default'
        },
        data: { type: 'verification_status', status: newStatus },
        token: fcmToken
      };

      await admin.messaging().send(payload);
      return console.log('Verification status notification sent.');

    } catch (error) {
      console.error('Error sending verification status notification:', error);
      return null;
    }
  });

exports.notifyDriverOnNewRequest = functions.database
  .ref('/requests/{requestId}')
  .onCreate(async (snapshot, context) => {
    const request = snapshot.val();
    const { requestId } = context.params;

    if (!request || request.status !== 'pending') {
      return null;
    }

    try {
      const fcmToken = (await admin.database().ref(`/taxis/${request.taxiId}/fcmToken`).once('value')).val();
      if (!fcmToken) return null;

      let payload;
      if (request.type === 'passenger') {
        payload = {
          notification: {
            title: 'New Ride Request! 🚖',
            body: `${request.commuterName} wants a ride to ${request.destination.split(',')[0]}`,
            sound: 'default'
          },
          data: { type: 'ride_request', requestId: requestId },
          token: fcmToken
        };
      } else if (request.type === 'parcel') {
        payload = {
          notification: {
            title: 'New Parcel Delivery! 📦',
            body: `${request.commuterName} has a parcel for ${request.destination.split(',')[0]}`,
            sound: 'default'
          },
          data: { type: 'parcel_request', requestId: requestId },
          token: fcmToken
        };
      } else {
        return null;
      }

      await admin.messaging().send(payload);
      return console.log(`${request.type} request notification sent.`);
    } catch (error) {
      console.error(`Error sending ${request.type} request notification:`, error);
      return null;
    }
  });