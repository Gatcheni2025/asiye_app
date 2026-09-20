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


// =================================================================
// --- ASIYE ADMIN CONTROL PLANE ---
// =================================================================

async function requireAsiyeAdmin(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Sign in with an Asiye administrator account."
    );
  }

  const token = context.auth.token || {};

  if (
    token.admin === true ||
    token.enrollmentReviewer === true ||
    token.asiyeAdmin === true
  ) {
    return {
      uid: context.auth.uid,
      email: token.email || ""
    };
  }

  const snapshot = await admin.database()
    .ref(`admins/${context.auth.uid}`)
    .once("value");

  const record = snapshot.val();

  const allowed =
    snapshot.exists() &&
    record !== false &&
    (
      typeof record !== "object" ||
      (
        record.active !== false &&
        record.disabled !== true
      )
    );

  if (!allowed) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This account is not authorised to use Asiye Admin."
    );
  }

  return {
    uid: context.auth.uid,
    email:
      token.email ||
      (
        typeof record === "object"
          ? String(record.email || "")
          : ""
      )
  };
}

function safeAdminString(value, maxLength = 250) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, maxLength);
}

function safeAdminNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function adminAuditRef() {
  return admin.database()
    .ref("adminAudit")
    .push();
}

async function writeAdminAudit(actor, action, target, details = {}) {
  const ref = adminAuditRef();

  await ref.set({
    action,
    target: safeAdminString(target, 180),
    details,
    adminUid: actor.uid,
    adminEmail: actor.email || "",
    createdAt: admin.database.ServerValue.TIMESTAMP
  });

  return ref.key;
}

function normaliseApprovedVehicle(input = {}, fallback = {}) {
  const source = {
    ...fallback,
    ...input
  };

  const seats = Math.min(
    15,
    Math.max(
      1,
      Math.round(
        safeAdminNumber(
          source.seats ??
          source.vehicleSeats ??
          fallback.seats ??
          fallback.vehicleSeats,
          4
        )
      )
    )
  );

  return {
    type:
      safeAdminString(
        source.type ??
        source.vehicleType ??
        fallback.type ??
        fallback.vehicleType,
        60
      ) || "ehailing",
    make:
      safeAdminString(
        source.make ??
        source.vehicleMake ??
        fallback.make ??
        fallback.vehicleMake,
        80
      ),
    model:
      safeAdminString(
        source.model ??
        source.vehicleModel ??
        fallback.model ??
        fallback.vehicleModel,
        80
      ),
    colour:
      safeAdminString(
        source.colour ??
        source.color ??
        source.vehicleColor ??
        fallback.colour ??
        fallback.vehicleColor,
        60
      ),
    registration:
      safeAdminString(
        source.registration ??
        source.vehicleReg ??
        source.taxiRegistrationNumber ??
        fallback.registration ??
        fallback.vehicleReg,
        30
      ),
    seats
  };
}

exports.adminWhoAmI = functions.https.onCall(
  async (data, context) => {
    const actor = await requireAsiyeAdmin(context);

    return {
      ok: true,
      uid: actor.uid,
      email: actor.email
    };
  }
);

exports.reviewDriverEnrollment = functions.https.onCall(
  async (data, context) => {
    const actor = await requireAsiyeAdmin(context);

    const uid = safeAdminString(data?.uid, 160);
    const decision =
      safeAdminString(data?.decision, 20).toLowerCase();
    const reason =
      safeAdminString(data?.reason, 600);

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Driver UID is required."
      );
    }

    if (!["approved", "rejected"].includes(decision)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Decision must be approved or rejected."
      );
    }

    const enrollmentRef =
      admin.database()
        .ref(`driverEnrollments/${uid}`);

    const enrollmentSnapshot =
      await enrollmentRef.once("value");

    const enrollment =
      enrollmentSnapshot.val();

    if (!enrollment) {
      throw new functions.https.HttpsError(
        "not-found",
        "Driver enrollment was not found."
      );
    }

    const now =
      admin.database.ServerValue.TIMESTAMP;

    const approval = {
      version: 1,
      status: decision,
      reviewedAt: now,
      reviewedBy: actor.uid,
      reviewerEmail: actor.email || "",
      reason:
        decision === "rejected"
          ? reason || "Application not approved."
          : ""
    };

    const updates = {
      [`driverApprovals/${uid}`]:
        approval,
      [`driverEnrollments/${uid}/status`]:
        decision,
      [`driverEnrollments/${uid}/reviewedAt`]:
        now,
      [`driverEnrollments/${uid}/reviewedBy`]:
        actor.uid
    };

    if (decision === "rejected") {
      updates[
        `driverEnrollments/${uid}/rejectionReason`
      ] =
        approval.reason;

      updates[
        `notifications/taxis/${uid}/admin_review_${Date.now()}`
      ] = {
        type: "driver_application_rejected",
        title: "Driver application update",
        body: approval.reason,
        timestamp: now
      };

      await admin.database()
        .ref()
        .update(updates);

      await writeAdminAudit(
        actor,
        "driver_enrollment_rejected",
        uid,
        {
          reason: approval.reason
        }
      );

      return {
        ok: true,
        status: "rejected"
      };
    }

    const approvedVehicle =
      normaliseApprovedVehicle(
        data?.vehicle || {},
        enrollment.vehiclePending || enrollment
      );

    if (
      !approvedVehicle.make ||
      !approvedVehicle.model ||
      !approvedVehicle.registration
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Vehicle make, model and registration are required before approval."
      );
    }

    let authUser = null;

    try {
      authUser =
        await admin.auth()
          .getUser(uid);
    } catch (error) {
      console.warn(
        "Driver auth profile could not be loaded during approval:",
        uid,
        error?.message || error
      );
    }

    const currentTaxiSnapshot =
      await admin.database()
        .ref(`taxis/${uid}`)
        .once("value");

    const currentTaxi =
      currentTaxiSnapshot.val() || {};

    const fullName =
      safeAdminString(
        enrollment.fullName ||
        currentTaxi.fullName ||
        currentTaxi.name ||
        authUser?.displayName ||
        "Asiye Driver",
        120
      );

    const nameParts =
      fullName.split(/\s+/).filter(Boolean);

    const driverPatch = {
      name:
        fullName,
      fullName:
        fullName,
      surname:
        nameParts.slice(1).join(" "),
      email:
        safeAdminString(
          authUser?.email ||
          currentTaxi.email ||
          "",
          180
        ),
      phone:
        safeAdminString(
          enrollment.phone ||
          authUser?.phoneNumber ||
          currentTaxi.phone ||
          "",
          40
        ),
      authUid:
        uid,
      userUid:
        uid,
      hasLogin:
        true,
      taxiRegistrationNumber:
        approvedVehicle.registration,
      vehicleReg:
        approvedVehicle.registration,
      vehicleType:
        approvedVehicle.type,
      vehicleMake:
        approvedVehicle.make,
      vehicleModel:
        approvedVehicle.model,
      vehicleColor:
        approvedVehicle.colour,
      vehicleSeats:
        approvedVehicle.seats,
      seats:
        approvedVehicle.seats,
      vehicle: {
        type:
          approvedVehicle.type,
        make:
          approvedVehicle.make,
        model:
          approvedVehicle.model,
        colour:
          approvedVehicle.colour,
        registration:
          approvedVehicle.registration,
        seats:
          approvedVehicle.seats
      },
      vehiclePending:
        null,
      vehicleApproved:
        true,
      vehicleApprovalStatus:
        "approved",
      vehicleApprovedAt:
        now,
      vehicleApprovedBy:
        actor.uid,
      profile_picture_url:
        enrollment.profile_picture_url ||
        enrollment.documents?.selfie ||
        currentTaxi.profile_picture_url ||
        "",
      profileImageUrl:
        enrollment.profile_picture_url ||
        enrollment.documents?.selfie ||
        currentTaxi.profileImageUrl ||
        "",
      vehiclePhoto:
        enrollment.vehiclePhoto ||
        enrollment.documents?.car ||
        currentTaxi.vehiclePhoto ||
        "",
      documents:
        enrollment.documents ||
        currentTaxi.documents ||
        {},
      references:
        enrollment.references ||
        currentTaxi.references ||
        {},
      banking:
        enrollment.banking ||
        currentTaxi.banking ||
        {},
      verificationStatus:
        "verified",
      status:
        "active",
      provisionalActivation:
        true,
      isOnline:
        false,
      isBroadcasting:
        false,
      isFull:
        false,
      verifiedAt:
        now,
      verifiedBy:
        actor.uid,
      enrollmentVersion:
        1,
      updatedAt:
        now
    };

    if (!currentTaxi.createdAt) {
      driverPatch.createdAt =
        now;
    }

    if (currentTaxi.walletBalance == null) {
      driverPatch.walletBalance =
        0;
    }

    if (currentTaxi.totalEarnings == null) {
      driverPatch.totalEarnings =
        0;
    }

    if (currentTaxi.totalTrips == null) {
      driverPatch.totalTrips =
        0;
    }

    if (!currentTaxi.ratingSummary) {
      driverPatch.ratingSummary = {
        total: 0,
        count: 0
      };
    }

    updates[
      `taxis/${uid}`
    ] = {
      ...currentTaxi,
      ...driverPatch
    };

    updates[
      `driverEnrollments/${uid}/approvedVehicle`
    ] =
      approvedVehicle;

    updates[
      `notifications/taxis/${uid}/admin_review_${Date.now()}`
    ] = {
      type:
        "driver_application_approved",
      title:
        "Driver application approved",
      body:
        "Your Asiye driver profile has been approved. Sign in to continue.",
      timestamp:
        now
    };

    await admin.database()
      .ref()
      .update(updates);

    await writeAdminAudit(
      actor,
      "driver_enrollment_approved",
      uid,
      {
        registration:
          approvedVehicle.registration,
        vehicle:
          `${approvedVehicle.make} ${approvedVehicle.model}`
            .trim()
      }
    );

    return {
      ok: true,
      status: "approved",
      driverId: uid
    };
  }
);

exports.adminManagePlatform = functions.https.onCall(
  async (data, context) => {
    const actor =
      await requireAsiyeAdmin(context);

    const action =
      safeAdminString(
        data?.action,
        60
      );

    if (!action) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Admin action is required."
      );
    }

    const root =
      admin.database()
        .ref();

    if (action === "updatePassenger") {
      const id =
        safeAdminString(data?.id, 160);

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Passenger ID is required."
        );
      }

      const source =
        data?.patch || {};

      const patch = {};

      if ("name" in source) {
        patch.name =
          safeAdminString(
            source.name,
            120
          );
      }

      if ("phone" in source) {
        patch.phone =
          safeAdminString(
            source.phone,
            40
          );
      }

      if ("email" in source) {
        patch.email =
          safeAdminString(
            source.email,
            180
          );
      }

      if ("isActive" in source) {
        patch.isActive =
          source.isActive !== false;
      }

      if ("homeAddress" in source) {
        patch.homeAddress =
          safeAdminString(
            source.homeAddress,
            300
          );
      }

      if ("workAddress" in source) {
        patch.workAddress =
          safeAdminString(
            source.workAddress,
            300
          );
      }

      patch.adminUpdatedAt =
        admin.database.ServerValue.TIMESTAMP;

      await admin.database()
        .ref(`commuters/${id}`)
        .update(patch);

      await writeAdminAudit(
        actor,
        "passenger_updated",
        id,
        {
          fields:
            Object.keys(patch)
              .filter(
                key =>
                  key !==
                  "adminUpdatedAt"
              )
        }
      );

      return {
        ok: true
      };
    }

    if (action === "updateDriver") {
      const id =
        safeAdminString(data?.id, 160);

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Driver ID is required."
        );
      }

      const source =
        data?.patch || {};

      const patch = {};

      const strings = [
        ["name", 120],
        ["fullName", 120],
        ["phone", 40],
        ["email", 180],
        ["area", 120],
        ["assignedRank", 120],
        ["vehicleType", 60],
        ["vehicleMake", 80],
        ["vehicleModel", 80],
        ["vehicleColor", 60],
        ["vehicleReg", 30],
        ["taxiRegistrationNumber", 30]
      ];

      for (const [field, max] of strings) {
        if (field in source) {
          patch[field] =
            safeAdminString(
              source[field],
              max
            );
        }
      }

      if ("vehicleSeats" in source) {
        patch.vehicleSeats =
          Math.min(
            15,
            Math.max(
              1,
              Math.round(
                safeAdminNumber(
                  source.vehicleSeats,
                  4
                )
              )
            )
          );

        patch.seats =
          patch.vehicleSeats;
      }

      if ("isOnline" in source) {
        patch.isOnline =
          source.isOnline === true;
      }

      if ("verificationStatus" in source) {
        const status =
          safeAdminString(
            source.verificationStatus,
            30
          );

        if (
          ![
            "verified",
            "unverified",
            "suspended"
          ].includes(status)
        ) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "Unsupported driver verification status."
          );
        }

        patch.verificationStatus =
          status;

        if (
          status !==
          "verified"
        ) {
          patch.isOnline =
            false;
          patch.isBroadcasting =
            false;
          patch.provisionalActivation =
            false;
        }
      }

      patch.adminUpdatedAt =
        admin.database.ServerValue.TIMESTAMP;

      await admin.database()
        .ref(`taxis/${id}`)
        .update(patch);

      await writeAdminAudit(
        actor,
        "driver_updated",
        id,
        {
          fields:
            Object.keys(patch)
              .filter(
                key =>
                  key !==
                  "adminUpdatedAt"
              )
        }
      );

      return {
        ok: true
      };
    }

    if (action === "adjustWallet") {
      const passengerId =
        safeAdminString(
          data?.passengerId,
          160
        );

      const delta =
        safeAdminNumber(
          data?.delta,
          NaN
        );

      const reason =
        safeAdminString(
          data?.reason,
          400
        );

      if (!passengerId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Passenger ID is required."
        );
      }

      if (
        !Number.isFinite(delta) ||
        delta === 0 ||
        Math.abs(delta) > 5000
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Wallet adjustment must be between -R5,000 and R5,000 and cannot be zero."
        );
      }

      if (!reason) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "A wallet adjustment reason is required."
        );
      }

      const passengerRef =
        admin.database()
          .ref(
            `commuters/${passengerId}`
          );

      const result =
        await passengerRef.transaction(
          current => {
            if (!current) {
              return;
            }

            const balance =
              safeAdminNumber(
                current.walletBalance ??
                current.credits,
                0
              );

            const next =
              Math.max(
                0,
                Math.round(
                  (balance + delta) * 100
                ) / 100
              );

            current.walletBalance =
              next;

            current.credits =
              next;

            current.walletAdminUpdatedAt =
              Date.now();

            return current;
          }
        );

      if (!result.committed) {
        throw new functions.https.HttpsError(
          "not-found",
          "Passenger could not be found."
        );
      }

      const balance =
        safeAdminNumber(
          result.snapshot.val()
            ?.walletBalance,
          0
        );

      const adjustmentRef =
        admin.database()
          .ref("walletAdjustments")
          .push();

      await adjustmentRef.set({
        passengerId,
        delta,
        balanceAfter:
          balance,
        reason,
        adminUid:
          actor.uid,
        adminEmail:
          actor.email || "",
        createdAt:
          admin.database.ServerValue.TIMESTAMP
      });

      await writeAdminAudit(
        actor,
        "wallet_adjusted",
        passengerId,
        {
          delta,
          balanceAfter:
            balance,
          reason
        }
      );

      return {
        ok: true,
        balance
      };
    }

    if (action === "updateRequest") {
      const id =
        safeAdminString(data?.id, 160);

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Request ID is required."
        );
      }

      const snapshot =
        await admin.database()
          .ref(`requests/${id}`)
          .once("value");

      const request =
        snapshot.val();

      if (!request) {
        throw new functions.https.HttpsError(
          "not-found",
          "Booking was not found."
        );
      }

      const source =
        data?.patch || {};

      const patch = {};

      if ("status" in source) {
        const status =
          safeAdminString(
            source.status,
            50
          );

        const allowed = [
          "pending",
          "searching",
          "driver_busy",
          "pooling",
          "waiting_members",
          "driver_waiting",
          "pool_ready",
          "accepted",
          "driver_on_way",
          "arrived",
          "collecting_passengers",
          "all_onboard",
          "passenger_onboard",
          "in_transit",
          "completed",
          "cancelled_by_admin",
          "cancelled_by_driver",
          "cancelled_by_commuter",
          "rejected"
        ];

        if (!allowed.includes(status)) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "Unsupported booking status."
          );
        }

        patch.status =
          status;
      }

      for (
        const field
        of [
          "finalAmount",
          "agreedFare",
          "calculatedPrice"
        ]
      ) {
        if (field in source) {
          const amount =
            safeAdminNumber(
              source[field],
              NaN
            );

          if (
            !Number.isFinite(amount) ||
            amount < 0 ||
            amount > 100000
          ) {
            throw new functions.https.HttpsError(
              "invalid-argument",
              "Fare amount is invalid."
            );
          }

          patch[field] =
            Math.round(
              amount * 100
            ) / 100;
        }
      }

      if ("paymentMethod" in source) {
        patch.paymentMethod =
          safeAdminString(
            source.paymentMethod,
            40
          );
      }

      patch.adminUpdatedAt =
        admin.database.ServerValue.TIMESTAMP;
      patch.adminUpdatedBy =
        actor.uid;

      const multi = {
        [`requests/${id}`]:
          {
            ...request,
            ...patch
          }
      };

      if (
        request.type ===
        "delivery"
      ) {
        const mirrorSnapshot =
          await admin.database()
            .ref(
              `delivery_requests/${id}`
            )
            .once("value");

        multi[
          `delivery_requests/${id}`
        ] = {
          ...(mirrorSnapshot.val() || request),
          ...patch
        };
      }

      await root.update(
        multi
      );

      await writeAdminAudit(
        actor,
        "booking_updated",
        id,
        {
          fields:
            Object.keys(patch)
              .filter(
                key =>
                  ![
                    "adminUpdatedAt",
                    "adminUpdatedBy"
                  ].includes(key)
              )
        }
      );

      return {
        ok: true
      };
    }

    if (action === "assignDriver") {
      const requestId =
        safeAdminString(
          data?.requestId,
          160
        );

      const driverId =
        safeAdminString(
          data?.driverId,
          160
        );

      if (
        !requestId ||
        !driverId
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Booking and driver IDs are required."
        );
      }

      const [
        requestSnapshot,
        driverSnapshot
      ] =
        await Promise.all([
          admin.database()
            .ref(
              `requests/${requestId}`
            )
            .once("value"),
          admin.database()
            .ref(
              `taxis/${driverId}`
            )
            .once("value")
        ]);

      const request =
        requestSnapshot.val();
      const driver =
        driverSnapshot.val();

      if (!request) {
        throw new functions.https.HttpsError(
          "not-found",
          "Booking was not found."
        );
      }

      if (!driver) {
        throw new functions.https.HttpsError(
          "not-found",
          "Driver was not found."
        );
      }

      if (
        driver.verificationStatus !==
          "verified" &&
        driver.provisionalActivation !==
          true
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Only an approved driver can be assigned."
        );
      }

      const timestamp =
        admin.database.ServerValue.TIMESTAMP;

      const requestPatch = {
        taxiId:
          driverId,
        assignedTaxiId:
          driverId,
        driverAuthUid:
          driver.authUid ||
          driver.userUid ||
          driverId,
        driverName:
          driver.name ||
          driver.fullName ||
          "Asiye Driver",
        driverPhone:
          driver.phone ||
          "",
        driverRating:
          safeAdminNumber(
            driver.rating,
            0
          ),
        status:
          request.type ===
          "club"
            ? (
                request.poolReady
                  ? "pool_ready"
                  : "driver_waiting"
              )
            : "accepted",
        acceptedAt:
          timestamp,
        assignedByAdmin:
          actor.uid
      };

      const multi = {
        [`requests/${requestId}`]:
          {
            ...request,
            ...requestPatch
          },
        [`taxis/${driverId}/currentRequest`]:
          requestId,
        [`taxis/${driverId}/isFull`]:
          false
      };

      if (
        request.type ===
        "delivery"
      ) {
        const mirror =
          (
            await admin.database()
              .ref(
                `delivery_requests/${requestId}`
              )
              .once("value")
          ).val() || request;

        multi[
          `delivery_requests/${requestId}`
        ] = {
          ...mirror,
          ...requestPatch
        };
      }

      const passengerIds =
        request.type ===
          "club"
          ? Object.keys(
              request.passengers || {}
            )
          : [
              request.commuterId
            ].filter(Boolean);

      for (
        const passengerId
        of passengerIds
      ) {
        const key =
          admin.database()
            .ref(
              `notifications/commuters/${passengerId}`
            )
            .push()
            .key;

        multi[
          `notifications/commuters/${passengerId}/${key}`
        ] = {
          type:
            "request_accepted",
          requestId,
          driverId,
          driverName:
            requestPatch.driverName,
          title:
            "Driver assigned",
          timestamp
        };
      }

      await root.update(
        multi
      );

      await writeAdminAudit(
        actor,
        "driver_assigned",
        requestId,
        {
          driverId
        }
      );

      return {
        ok: true
      };
    }

    if (action === "cancelRequest") {
      const requestId =
        safeAdminString(
          data?.requestId,
          160
        );

      const reason =
        safeAdminString(
          data?.reason,
          500
        );

      if (!requestId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Booking ID is required."
        );
      }

      const requestRef =
        admin.database()
          .ref(
            `requests/${requestId}`
          );

      const snapshot =
        await requestRef.once("value");

      const request =
        snapshot.val();

      if (!request) {
        throw new functions.https.HttpsError(
          "not-found",
          "Booking was not found."
        );
      }

      const timestamp =
        admin.database.ServerValue.TIMESTAMP;

      const patch = {
        status:
          "cancelled_by_admin",
        cancelledAt:
          timestamp,
        cancelledBy:
          actor.uid,
        cancellationReason:
          reason ||
          "Cancelled by Asiye Admin"
      };

      const multi = {
        [`requests/${requestId}`]:
          {
            ...request,
            ...patch
          }
      };

      if (
        request.type ===
        "delivery"
      ) {
        const mirror =
          (
            await admin.database()
              .ref(
                `delivery_requests/${requestId}`
              )
              .once("value")
          ).val() || request;

        multi[
          `delivery_requests/${requestId}`
        ] = {
          ...mirror,
          ...patch
        };
      }

      if (request.taxiId) {
        multi[
          `taxis/${request.taxiId}/currentRequest`
        ] =
          null;
        multi[
          `taxis/${request.taxiId}/isFull`
        ] =
          false;
      }

      const passengerIds =
        request.type ===
          "club"
          ? Object.keys(
              request.passengers || {}
            )
          : [
              request.commuterId
            ].filter(Boolean);

      for (
        const passengerId
        of passengerIds
      ) {
        multi[
          `commuters/${passengerId}/currentRequest`
        ] =
          null;
      }

      await root.update(
        multi
      );

      await writeAdminAudit(
        actor,
        "booking_cancelled",
        requestId,
        {
          reason:
            patch.cancellationReason
        }
      );

      return {
        ok: true
      };
    }

    if (action === "reviewPayout") {
      const collection =
        safeAdminString(
          data?.collection,
          40
        );

      const id =
        safeAdminString(
          data?.id,
          160
        );

      const status =
        safeAdminString(
          data?.status,
          30
        )
          .toLowerCase();

      const note =
        safeAdminString(
          data?.note,
          500
        );

      if (
        ![
          "payout_requests",
          "withdrawals"
        ].includes(collection)
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Unsupported payout collection."
        );
      }

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Payout ID is required."
        );
      }

      if (
        ![
          "pending",
          "approved",
          "rejected",
          "paid"
        ].includes(status)
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Unsupported payout status."
        );
      }

      await admin.database()
        .ref(
          `${collection}/${id}`
        )
        .update({
          status,
          adminNote:
            note,
          reviewedAt:
            admin.database.ServerValue.TIMESTAMP,
          reviewedBy:
            actor.uid
        });

      await writeAdminAudit(
        actor,
        "payout_reviewed",
        `${collection}/${id}`,
        {
          status,
          note
        }
      );

      return {
        ok: true
      };
    }

    if (action === "updateSupport") {
      const id =
        safeAdminString(
          data?.id,
          160
        );

      const status =
        safeAdminString(
          data?.status,
          30
        )
          .toLowerCase();

      const note =
        safeAdminString(
          data?.note,
          1500
        );

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Support ticket ID is required."
        );
      }

      if (
        ![
          "open",
          "pending",
          "resolved",
          "closed"
        ].includes(status)
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Unsupported support status."
        );
      }

      const ref =
        admin.database()
          .ref(
            `support_chats/${id}`
          );

      const existing =
        (
          await ref.once("value")
        ).val();

      if (!existing) {
        throw new functions.https.HttpsError(
          "not-found",
          "Support ticket was not found."
        );
      }

      const patch = {
        status,
        adminNote:
          note,
        adminUpdatedAt:
          admin.database.ServerValue.TIMESTAMP,
        adminUpdatedBy:
          actor.uid
      };

      if (
        status ===
          "resolved" ||
        status ===
          "closed"
      ) {
        patch.resolvedAt =
          admin.database.ServerValue.TIMESTAMP;
      }

      await ref.update(
        patch
      );

      await writeAdminAudit(
        actor,
        "support_updated",
        id,
        {
          status
        }
      );

      return {
        ok: true
      };
    }

    if (action === "updatePaymentNote") {
      const id =
        safeAdminString(
          data?.id,
          180
        );

      const note =
        safeAdminString(
          data?.note,
          800
        );

      if (!id) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Payment ID is required."
        );
      }

      await admin.database()
        .ref(
          `walletPayments/${id}`
        )
        .update({
          adminNote:
            note,
          adminReviewedAt:
            admin.database.ServerValue.TIMESTAMP,
          adminReviewedBy:
            actor.uid
        });

      await writeAdminAudit(
        actor,
        "payment_noted",
        id,
        {}
      );

      return {
        ok: true
      };
    }

    if (action === "reviewLegacyDriver") {
      const id =
        safeAdminString(
          data?.id,
          160
        );

      const decision =
        safeAdminString(
          data?.decision,
          30
        )
          .toLowerCase();

      const reason =
        safeAdminString(
          data?.reason,
          600
        );

      if (
        !id ||
        ![
          "approved",
          "rejected"
        ].includes(decision)
      ) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Legacy application and decision are required."
        );
      }

      const appRef =
        admin.database()
          .ref(
            `driver_applications/${id}`
          );

      const application =
        (
          await appRef.once("value")
        ).val();

      if (!application) {
        throw new functions.https.HttpsError(
          "not-found",
          "Legacy driver application was not found."
        );
      }

      if (
        decision ===
        "rejected"
      ) {
        await appRef.update({
          status:
            "rejected",
          rejectionReason:
            reason ||
            "Application not approved.",
          rejectedAt:
            admin.database.ServerValue.TIMESTAMP,
          rejectedBy:
            actor.uid
        });

        await writeAdminAudit(
          actor,
          "legacy_driver_rejected",
          id,
          {
            reason
          }
        );

        return {
          ok: true
        };
      }

      const driverId =
        safeAdminString(
          application.authUid ||
          application.userUid ||
          application.driverId ||
          id,
          160
        );

      const approvedVehicle =
        normaliseApprovedVehicle(
          data?.vehicle || {},
          application.approvedVehicle ||
          application.vehiclePending ||
          application
        );

      const currentTaxi =
        (
          await admin.database()
            .ref(
              `taxis/${driverId}`
            )
            .once("value")
        ).val() || {};

      const fullName =
        safeAdminString(
          application.fullName ||
          application.name ||
          currentTaxi.name ||
          "Asiye Driver",
          120
        );

      await root.update({
        [`taxis/${driverId}`]:
          {
            ...currentTaxi,
            name:
              fullName,
            fullName:
              fullName,
            phone:
              application.phone ||
              currentTaxi.phone ||
              "",
            email:
              application.email ||
              currentTaxi.email ||
              "",
            authUid:
              application.authUid ||
              application.userUid ||
              currentTaxi.authUid ||
              null,
            userUid:
              application.userUid ||
              application.authUid ||
              currentTaxi.userUid ||
              null,
            profile_picture_url:
              application.profile_picture_url ||
              application.documents?.FACE ||
              application.documents?.selfie ||
              currentTaxi.profile_picture_url ||
              "",
            vehiclePhoto:
              application.vehiclePhoto ||
              application.documents?.CAR_FRONT ||
              application.documents?.car ||
              currentTaxi.vehiclePhoto ||
              "",
            taxiRegistrationNumber:
              approvedVehicle.registration,
            vehicleReg:
              approvedVehicle.registration,
            vehicleType:
              approvedVehicle.type,
            vehicleMake:
              approvedVehicle.make,
            vehicleModel:
              approvedVehicle.model,
            vehicleColor:
              approvedVehicle.colour,
            vehicleSeats:
              approvedVehicle.seats,
            seats:
              approvedVehicle.seats,
            vehicle:
              approvedVehicle,
            vehicleApproved:
              true,
            vehicleApprovalStatus:
              "approved",
            verificationStatus:
              "verified",
            provisionalActivation:
              true,
            status:
              "active",
            isOnline:
              false,
            verifiedAt:
              admin.database.ServerValue.TIMESTAMP,
            verifiedBy:
              actor.uid
          },
        [`driver_applications/${id}/status`]:
          "verified",
        [`driver_applications/${id}/driverId`]:
          driverId,
        [`driver_applications/${id}/verifiedAt`]:
          admin.database.ServerValue.TIMESTAMP,
        [`driver_applications/${id}/verifiedBy`]:
          actor.uid
      });

      await writeAdminAudit(
        actor,
        "legacy_driver_approved",
        id,
        {
          driverId
        }
      );

      return {
        ok: true,
        driverId
      };
    }

    throw new functions.https.HttpsError(
      "invalid-argument",
      "Unsupported admin action."
    );
  }
);
