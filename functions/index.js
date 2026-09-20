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

// =================================================================
// --- APP RELEASE UPDATE NOTIFICATIONS ---
// =================================================================

function compareReleaseVersions(left, right) {
  const leftParts = String(left || "").split(".").map(value => Number(value) || 0);
  const rightParts = String(right || "").split(".").map(value => Number(value) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function profileNeedsAppUpdate(profile, release) {
  if (!profile || !profile.fcmToken) return false;

  const platform = String(profile.appPlatform || "").toLowerCase();
  const latestVersion = String(
    platform === "ios"
      ? (release.latestVersionIos || release.latestVersion || "")
      : (release.latestVersionAndroid || release.latestVersion || "")
  );

  if (platform === "ios" && latestVersion) {
    return !profile.appVersion ||
      compareReleaseVersions(profile.appVersion, latestVersion) < 0;
  }

  const latestBuild = Number(
    release.latestBuildAndroid ||
    release.latestBuild ||
    0
  );

  if (latestBuild > 0) {
    return Number(profile.appBuild || 0) < latestBuild;
  }

  return latestVersion
    ? (!profile.appVersion ||
      compareReleaseVersions(profile.appVersion, latestVersion) < 0)
    : false;
}

async function sendAppUpdateNotifications(recipients, release) {
  const uniqueTokens = [...new Set(
    recipients
      .map(recipient => recipient.token)
      .filter(Boolean)
  )];

  if (uniqueTokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  const latestBuild = String(
    release.latestBuildAndroid ||
    release.latestBuild ||
    ""
  );

  const latestVersion = String(
    release.latestVersion ||
    release.latestVersionAndroid ||
    release.latestVersionIos ||
    ""
  );

  const data = {
    type: "app_update",
    title: String(release.title || "A new Asiye update is available"),
    message: String(
      release.message ||
      "Update Asiye to get the latest improvements and fixes."
    ),
    latestBuild,
    latestBuildAndroid: latestBuild,
    latestVersion,
    latestVersionAndroid: String(
      release.latestVersionAndroid ||
      latestVersion
    ),
    latestVersionIos: String(
      release.latestVersionIos ||
      latestVersion
    ),
    androidUrl: String(
      release.androidUrl ||
      "https://play.google.com/store/apps/details?id=com.asiyeapp.asiye"
    ),
    iosUrl: String(release.iosUrl || ""),
    updateUrl: String(release.updateUrl || ""),
    forceUpdate: String(Boolean(release.forceUpdate))
  };

  let successCount = 0;
  let failureCount = 0;

  for (let start = 0; start < uniqueTokens.length; start += 500) {
    const tokens = uniqueTokens.slice(start, start + 500);

    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      data,
      android: {
        priority: "high"
      },
      apns: {
        headers: {
          "apns-push-type": "background",
          "apns-priority": "5"
        },
        payload: {
          aps: {
            contentAvailable: true
          }
        }
      }
    });

    successCount += result.successCount;
    failureCount += result.failureCount;
  }

  return { successCount, failureCount };
}

exports.notifyOutdatedAppsOnRelease = functions.database
  .ref("/appRelease/current")
  .onWrite(async (change) => {
    if (!change.after.exists()) return null;

    const release = change.after.val() || {};
    const previous = change.before.exists() ? (change.before.val() || {}) : {};

    const releaseKey = [
      release.latestBuildAndroid || release.latestBuild || "",
      release.latestVersion || "",
      release.notificationRevision || 0
    ].join(":");

    const previousKey = [
      previous.latestBuildAndroid || previous.latestBuild || "",
      previous.latestVersion || "",
      previous.notificationRevision || 0
    ].join(":");

    if (!releaseKey.replace(/:/g, "") || releaseKey === previousKey) {
      return null;
    }

    try {
      const [commutersSnapshot, taxisSnapshot, handlersSnapshot] =
        await Promise.all([
          admin.database().ref("/commuters").once("value"),
          admin.database().ref("/taxis").once("value"),
          admin.database().ref("/handlers").once("value")
        ]);

      const recipients = [];

      const collect = (snapshot, node) => {
        snapshot.forEach(child => {
          const profile = child.val();
          if (!profileNeedsAppUpdate(profile, release)) return;

          recipients.push({
            token: profile.fcmToken,
            path: `${node}/${child.key}`
          });
        });
      };

      collect(commutersSnapshot, "commuters");
      collect(taxisSnapshot, "taxis");
      collect(handlersSnapshot, "handlers");

      const result = await sendAppUpdateNotifications(recipients, release);

      await change.after.ref.update({
        lastNotificationAt: admin.database.ServerValue.TIMESTAMP,
        lastRecipientCount: recipients.length,
        lastSuccessCount: result.successCount,
        lastFailureCount: result.failureCount
      });

      console.log(
        `App update notification sent to ${result.successCount}/${recipients.length} outdated devices.`
      );

      return null;
    } catch (error) {
      console.error("App update notification failed:", error);
      return null;
    }
  });


// =================================================================
// --- TRIP PUSH NOTIFICATIONS (ANDROID + IOS) ---
// =================================================================

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function dataStrings(values) {
  return Object.fromEntries(
    Object.entries(values || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value)
      ])
  );
}

async function sendProfilePush(profileNode, profileId, notification, fallback = {}) {
  if (!profileId || !notification) return null;

  const tokenRef = admin.database().ref(`/${profileNode}/${profileId}/fcmToken`);
  const token = (await tokenRef.once("value")).val();
  if (!token) {
    console.log(`No FCM token for ${profileNode}/${profileId}`);
    return null;
  }

  let request = null;
  const requestId = notification.requestId || notification.tripId || "";
  if (requestId) {
    request = (await admin.database().ref(`/requests/${requestId}`).once("value")).val();
  }

  const amount = Number(
    notification.amount ??
    notification.fare ??
    request?.finalAmount ??
    request?.agreedFare ??
    request?.calculatedPrice ??
    request?.pricePerPassenger ??
    0
  );

  let title = notification.title || fallback.title || "Asiye";
  let body = notification.message || notification.body || fallback.body || "New Asiye update";

  if (profileNode === "taxis" && notification.type === "ride_request") {
    const passenger = notification.commuterName || request?.commuterName || "A passenger";
    const pickup = notification.pickupAddress || request?.pickupAddress || "the pickup point";
    const destination = notification.destination || request?.destination || "the destination";
    title = "New Asiye booking";
    body = `${passenger}: ${pickup} → ${destination}. Fare R${money(amount)}.`;
  }

  if (profileNode === "commuters" && notification.type === "request_accepted") {
    const driver = notification.driverName || request?.driverName || "Your driver";
    title = "Driver confirmed";
    body = `${driver} accepted your booking. Amount to pay: R${money(amount)}.`;
  }

  const data = dataStrings({
    ...notification,
    title,
    message: body,
    requestId,
    amount: amount > 0 ? money(amount) : ""
  });

  try {
    return await admin.messaging().send({
      token,
      notification: {
        title: String(title),
        body: String(body)
      },
      data,
      android: {
        priority: "high",
        notification: {
          channelId: "asiye_danger_channel",
          sound: "default",
          priority: "high"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert"
        },
        payload: {
          aps: {
            sound: "default",
            badge: 1
          }
        }
      }
    });
  } catch (error) {
    const code = error?.errorInfo?.code || error?.code || "";
    console.error(
      `FCM push failed for ${profileNode}/${profileId}`,
      code,
      error?.message || error
    );

    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await tokenRef.remove().catch(() => {});
    }

    return null;
  }
}

exports.pushPassengerNotification = functions.database
  .ref("/notifications/commuters/{commuterId}/{notificationId}")
  .onCreate(async (snapshot, context) => {
    return sendProfilePush(
      "commuters",
      context.params.commuterId,
      snapshot.val()
    );
  });

exports.pushDriverNotification = functions.database
  .ref("/notifications/taxis/{driverId}/{notificationId}")
  .onCreate(async (snapshot, context) => {
    return sendProfilePush(
      "taxis",
      context.params.driverId,
      snapshot.val()
    );
  });

exports.notifyPassengerOnGoBookingCreated = functions.database
  .ref("/requests/{requestId}")
  .onCreate(async (snapshot, context) => {
    const request = snapshot.val();
    if (!request || request.type === "club" || !request.commuterId) return null;

    const amount = Number(
      request.finalAmount ||
      request.agreedFare ||
      request.calculatedPrice ||
      0
    );

    return admin.database()
      .ref(`/notifications/commuters/${request.commuterId}`)
      .push({
        type: "booking_received",
        title: "Booking received",
        message: `We received your booking and are finding you a car. Amount to pay: R${money(amount)}.`,
        requestId: context.params.requestId,
        amount,
        timestamp: admin.database.ServerValue.TIMESTAMP
      });
  });

exports.notifyPassengerOnClubJoin = functions.database
  .ref("/requests/{requestId}/passengers/{commuterId}")
  .onCreate(async (snapshot, context) => {
    const passenger = snapshot.val();
    if (!passenger) return null;

    const request = (
      await snapshot.ref.parent.parent.once("value")
    ).val();

    if (!request || request.type !== "club") return null;

    const amount = Number(
      passenger.price ||
      request.pricePerPassenger ||
      0
    );

    return admin.database()
      .ref(`/notifications/commuters/${context.params.commuterId}`)
      .push({
        type: "booking_received",
        title: "Asiye Work booking received",
        message: `Your seat is confirmed while we build your group. Amount to pay: R${money(amount)}.`,
        requestId: context.params.requestId,
        amount,
        timestamp: admin.database.ServerValue.TIMESTAMP
      });
  });


// =================================================================
// --- ASIYE WORK: NOTIFY NEARBY DRIVERS WHEN THE POOL IS FULL ---
// =================================================================

function haversineKm(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map(Number);
  if (!values.every(Number.isFinite)) return Infinity;

  const [aLat, aLng, bLat, bLng] = values;
  const radians = value => value * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) *
    Math.cos(radians(bLat)) *
    Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.notifyDriversWhenClubReady = functions.database
  .ref("/requests/{requestId}/poolReady")
  .onUpdate(async (change, context) => {
    if (change.before.val() === true || change.after.val() !== true) {
      return null;
    }

    const requestId = context.params.requestId;
    const request = (await change.after.ref.parent.once("value")).val();

    if (
      !request ||
      request.type !== "club" ||
      request.taxiId ||
      request.status !== "pool_ready"
    ) {
      return null;
    }

    const pickupLat = Number(
      request.poolCenterLat ??
      request.commuterLocation?.latitude
    );
    const pickupLng = Number(
      request.poolCenterLng ??
      request.commuterLocation?.longitude
    );

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      console.warn(`Club ${requestId} has no usable pickup coordinates.`);
      return null;
    }

    const requiredSeats = Number(
      request.capacity ||
      (request.clubMode === "club7" ? 7 : 4)
    );

    const taxisSnapshot = await admin.database().ref("/taxis").once("value");
    const candidates = [];

    taxisSnapshot.forEach(child => {
      const taxi = child.val() || {};

      if (
        taxi.isOnline !== true ||
        taxi.currentRequest ||
        taxi.isFull === true ||
        !taxi.fcmToken
      ) {
        return;
      }

      const lat = Number(taxi.latitude);
      const lng = Number(taxi.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const declaredSeats = Number(taxi.capacity || taxi.seats || 0);
      if (
        Number.isFinite(declaredSeats) &&
        declaredSeats > 0 &&
        declaredSeats < requiredSeats
      ) {
        return;
      }

      const distanceKm = haversineKm(
        pickupLat,
        pickupLng,
        lat,
        lng
      );

      if (distanceKm > 10) return;

      candidates.push({
        driverId: child.key,
        distanceKm
      });
    });

    candidates.sort((left, right) => left.distanceKm - right.distanceKm);
    const selected = candidates.slice(0, 8);

    await Promise.all(
      selected.map(candidate =>
        admin.database()
          .ref(`/notifications/taxis/${candidate.driverId}/${requestId}`)
          .set({
            type: "club_request",
            requestId,
            rideType: request.clubMode || "club4",
            serviceName: "Asiye Work",
            commuterName: request.commuterName || "Asiye Work passengers",
            pickupAddress: request.pickupAddress || "Pickup",
            destination: request.destination || "Destination",
            fare: Number(request.pricePerPassenger || 0),
            passengerCount: Number(request.passengerCount || requiredSeats),
            capacity: requiredSeats,
            distanceKm: candidate.distanceKm,
            timestamp: admin.database.ServerValue.TIMESTAMP
          })
      )
    );

    console.log(
      `Asiye Work ${requestId} sent to ${selected.length} nearby driver(s).`
    );

    return null;
  });


// =================================================================
// --- OZOW ONE API WALLET TOP-UP (STAGING) ---
// =================================================================
// The mobile/web client never receives Ozow credentials. The passenger
// authenticates to this function with a Firebase ID token, then the server
// creates an Ozow hosted Pay by Bank payment and returns only redirectUrl.
//
// Before deployment configure these Firebase secrets:
//   OZOW_CLIENT_ID
//   OZOW_CLIENT_SECRET
//   OZOW_SITE_CODE
//   OZOW_WEBHOOK_SECRET
//
// For the trial integration we intentionally use Ozow One API staging.
// Change both URLs to https://one.ozow.com/v1 only after the staging flow
// and webhook have been verified with the live Ozow merchant account.
const ozowClientId = defineSecret("OZOW_CLIENT_ID");
const ozowClientSecret = defineSecret("OZOW_CLIENT_SECRET");
const ozowSiteCode = defineSecret("OZOW_SITE_CODE");
const ozowWebhookSecret = defineSecret("OZOW_WEBHOOK_SECRET");

const OZOW_BASE_URL = "https://stagingone.ozow.com/v1";
const OZOW_RETURN_URL =
  "https://us-central1-asiye-80386.cloudfunctions.net/ozowWalletReturn";

function walletCors(request, response) {
  const origin = request.get("origin");
  if (origin) response.set("Access-Control-Allow-Origin", origin);
  else response.set("Access-Control-Allow-Origin", "*");
  response.set("Vary", "Origin");
  response.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function getOzowAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "payments",
    grant_type: "client_credentials"
  });

  const response = await fetch(`${OZOW_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    console.error("Ozow token request failed", {
      status: response.status,
      payload
    });
    throw new Error("Unable to authenticate the bank payment service.");
  }

  return payload.access_token;
}

function ozowMerchantReference() {
  return (
    "ASIYE" +
    Date.now().toString() +
    crypto.randomBytes(5).toString("hex").toUpperCase()
  ).slice(0, 45);
}

exports.createOzowWalletTopup = onRequest(
  {
    region: "us-central1",
    secrets: [
      ozowClientId,
      ozowClientSecret,
      ozowSiteCode
    ]
  },
  async (request, response) => {
    walletCors(request, response);

    if (request.method === "OPTIONS") {
      return response.status(204).send("");
    }

    if (request.method !== "POST") {
      return response.status(405).json({
        error: "POST required."
      });
    }

    try {
      const match = (request.get("authorization") || "")
        .match(/^Bearer (.+)$/);

      if (!match) {
        return response.status(401).json({
          error: "Sign in again before adding funds."
        });
      }

      const decoded = await admin.auth().verifyIdToken(match[1]);
      const amount = Number(request.body?.amount);

      if (!Number.isFinite(amount) || amount < 10 || amount > 5000) {
        return response.status(400).json({
          error: "Amount must be between R10 and R5,000."
        });
      }

      const roundedAmount = Number(amount.toFixed(2));
      const merchantReference = ozowMerchantReference();
      const beneficiaryReference =
        ("ASIYE" + merchantReference.slice(-12))
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 20);

      const token = await getOzowAccessToken(
        ozowClientId.value(),
        ozowClientSecret.value()
      );

      const expireAt =
        new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const paymentRequest = {
        siteCode: ozowSiteCode.value(),
        region: "ZA",
        amount: {
          currency: "ZAR",
          value: roundedAmount
        },
        merchantReference,
        beneficiaryReference,
        expireAt,
        returnUrl: OZOW_RETURN_URL
      };

      const ozowResponse = await fetch(
        `${OZOW_BASE_URL}/payments`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": merchantReference
          },
          body: JSON.stringify(paymentRequest)
        }
      );

      const ozowPayment =
        await ozowResponse.json().catch(() => ({}));

      if (
        !ozowResponse.ok ||
        !ozowPayment.id ||
        !ozowPayment.redirectUrl
      ) {
        console.error("Ozow payment request failed", {
          status: ozowResponse.status,
          payload: ozowPayment
        });

        return response.status(502).json({
          error:
            ozowPayment.detail ||
            "Unable to start the EFT payment."
        });
      }

      await admin.database()
        .ref(`walletPayments/${merchantReference}`)
        .set({
          uid: decoded.uid,
          amount: roundedAmount,
          currency: "ZAR",
          provider: "ozow",
          environment: "staging",
          status: "pending",
          merchantReference,
          beneficiaryReference,
          ozowPaymentId: String(ozowPayment.id),
          createdAt: admin.database.ServerValue.TIMESTAMP
        });

      return response.json({
        provider: "ozow",
        environment: "staging",
        merchantReference,
        paymentId: String(ozowPayment.id),
        redirectUrl: String(ozowPayment.redirectUrl)
      });

    } catch (error) {
      console.error("Create Ozow wallet top-up failed", error);

      return response.status(500).json({
        error:
          error?.message ||
          "Unable to start the EFT payment."
      });
    }
  }
);

exports.ozowWalletReturn = onRequest(
  { region: "us-central1" },
  async (request, response) => {
    response
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "no-store")
      .send(
        "<!doctype html>" +
        "<html><head><meta name='viewport' " +
        "content='width=device-width,initial-scale=1'>" +
        "<title>Returning to Asiye</title></head>" +
        "<body style='font-family:system-ui;background:#f6fbf7;" +
        "color:#173c2b;display:grid;place-items:center;" +
        "min-height:100vh;margin:0;text-align:center'>" +
        "<main><h2>Returning to Asiye…</h2>" +
        "<p>Your wallet updates only after the bank payment " +
        "is securely confirmed.</p></main></body></html>"
      );
  }
);

exports.ozowWalletWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [
      ozowClientId,
      ozowClientSecret,
      ozowSiteCode,
      ozowWebhookSecret
    ]
  },
  async (request, response) => {
    if (request.method !== "POST") {
      return response.status(405).send("POST required");
    }

    const rawBody = request.rawBody;

    if (!rawBody) {
      return response.status(400).send("Missing raw body");
    }

    let event;

    try {
      // Svix 2.x is ESM; dynamic import works from this CommonJS
      // Firebase Functions file on Node 20.
      const { Webhook } = await import("svix");
      const webhook = new Webhook(ozowWebhookSecret.value());

      webhook.verify(rawBody, {
        "svix-id": request.get("svix-id") || "",
        "svix-timestamp": request.get("svix-timestamp") || "",
        "svix-signature": request.get("svix-signature") || ""
      });

      event = JSON.parse(rawBody.toString("utf8"));

    } catch (error) {
      console.error("Rejected Ozow webhook", error);
      return response.status(400).send("Invalid signature");
    }

    if (
      event?.type !== "transaction.complete" ||
      !event?.data?.id
    ) {
      return response.status(200).send("OK");
    }

    const transactionId = String(event.data.id);

    try {
      const token = await getOzowAccessToken(
        ozowClientId.value(),
        ozowClientSecret.value()
      );

      // Do not trust the event body alone. Read the transaction back
      // from Ozow after the verified webhook, then match its merchant
      // reference, site, amount and status to our pending wallet record.
      const txResponse = await fetch(
        `${OZOW_BASE_URL}/transactions/${encodeURIComponent(transactionId)}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json"
          }
        }
      );

      const transaction =
        await txResponse.json().catch(() => ({}));

      if (!txResponse.ok) {
        console.error("Ozow transaction lookup failed", {
          status: txResponse.status,
          transactionId,
          payload: transaction
        });
        return response.status(500).send("Retry");
      }

      const merchantReference =
        String(transaction.merchantReference || "");

      if (!merchantReference) {
        console.error(
          "Ozow transaction has no merchant reference",
          transactionId
        );
        return response.status(200).send("OK");
      }

      const paymentRef = admin.database()
        .ref(`walletPayments/${merchantReference}`);

      const paymentSnapshot = await paymentRef.once("value");
      const payment = paymentSnapshot.val();

      if (!payment || payment.provider !== "ozow") {
        console.warn(
          "No Asiye Ozow wallet payment matched",
          merchantReference
        );
        return response.status(200).send("OK");
      }

      const transactionStatus =
        String(transaction.status || event.data.status || "");

      const transactionAmount =
        Number(transaction.amount?.value);

      const currency =
        String(transaction.amount?.currency || "").toUpperCase();

      const sameSite =
        String(transaction.siteCode || "") ===
        String(ozowSiteCode.value());

      const amountMatches =
        Number.isFinite(transactionAmount) &&
        transactionAmount.toFixed(2) ===
          Number(payment.amount).toFixed(2);

      if (
        transactionStatus !== "Successful" ||
        currency !== "ZAR" ||
        !sameSite ||
        !amountMatches
      ) {
        await paymentRef.update({
          status:
            transactionStatus === "Pending"
              ? "pending"
              : "not_complete",
          ozowTransactionId: transactionId,
          ozowStatus: transactionStatus,
          lastWebhookAt:
            admin.database.ServerValue.TIMESTAMP
        });

        return response.status(200).send("OK");
      }

      const uid = String(payment.uid || "");
      const amount = Number(payment.amount);

      if (!uid || !Number.isFinite(amount) || amount <= 0) {
        console.error(
          "Invalid Asiye wallet payment record",
          merchantReference
        );
        return response.status(200).send("OK");
      }

      /*
       * Credit the passenger exactly once. The marker and balance are
       * changed in one RTDB transaction on the commuter object, so a
       * duplicate Svix delivery cannot add the same payment twice.
       */
      const commuterRef =
        admin.database().ref(`commuters/${uid}`);

      const creditResult =
        await commuterRef.transaction(current => {
          if (!current) return;

          const applied =
            current.walletAppliedPayments || {};

          if (applied[merchantReference]) {
            return current;
          }

          const currentBalance =
            Number(
              current.credits ??
              current.walletBalance ??
              0
            ) || 0;

          const newBalance =
            Number((currentBalance + amount).toFixed(2));

          applied[merchantReference] = {
            provider: "ozow",
            amount,
            transactionId,
            appliedAt: Date.now()
          };

          current.walletAppliedPayments = applied;
          current.credits = newBalance;
          current.walletBalance = newBalance;

          return current;
        });

      if (!creditResult.committed) {
        console.error(
          "Passenger wallet transaction was not committed",
          uid,
          merchantReference
        );
        return response.status(500).send("Retry");
      }

      const creditedBalance =
        Number(
          creditResult.snapshot.val()?.credits ??
          creditResult.snapshot.val()?.walletBalance ??
          0
        );

      await paymentRef.update({
        status: "complete",
        ozowTransactionId: transactionId,
        ozowStatus: "Successful",
        creditedBalance,
        completedAt:
          admin.database.ServerValue.TIMESTAMP,
        lastWebhookAt:
          admin.database.ServerValue.TIMESTAMP
      });

      return response.status(200).send("OK");

    } catch (error) {
      console.error("Ozow wallet webhook failed", error);
      return response.status(500).send("Retry");
    }
  }
);
