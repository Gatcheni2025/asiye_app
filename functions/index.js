const functions = require("firebase-functions/v1");
const { onRequest } = require("firebase-functions/v2/https");
const { onValueUpdated } = require("firebase-functions/v2/database");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// =================================================================
// --- INITIALIZE FIREBASE ADMIN ---
// =================================================================
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// =================================================================
// --- NATIVE FIREBASE AUTH -> WEBVIEW SESSION BRIDGE ---
// =================================================================
// Flutter completes provider authentication with the native Firebase SDK.
// The WebView then presents the resulting Firebase ID token here. We verify
// that token server-side and mint a short-lived custom token for the SAME UID
// so the Firebase JS SDK can establish the matching authenticated session.
function nativeAuthCors(request, response) {
  const origin =
    request.get("origin") || "";

  const allowedOrigins =
    new Set([
      "https://asiye.cloud",
      "https://www.asiye.cloud",
      "https://app.asiye.cloud",
      "https://asiye-80386.web.app",
      "https://asiye-80386.firebaseapp.com",
      "https://appassets.androidplatform.net"
    ]);

  if (
    allowedOrigins.has(origin) ||
    origin.startsWith(
      "https://appassets."
    ) ||
    !origin ||
    origin === "null"
  ) {
    response.set(
      "Access-Control-Allow-Origin",
      origin && origin !== "null"
        ? origin
        : "*"
    );
  }

  response.set(
    "Vary",
    "Origin"
  );

  response.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );

  response.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
}

exports.exchangeNativeAuthSession =
  onRequest(
    {
      region:
        "us-central1"
    },
    async (
      request,
      response
    ) => {
      nativeAuthCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) || ""
          )
            .match(
              /^Bearer (.+)$/
            );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Native Firebase authentication is required."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const customToken =
          await admin.auth()
            .createCustomToken(
              decoded.uid
            );

        return response
          .status(200)
          .json({
            ok:
              true,
            uid:
              decoded.uid,
            customToken
          });

      } catch (error) {
        console.error(
          "Native auth session exchange failed",
          {
            code:
              error?.code ||
              "unknown",
            message:
              error?.message ||
              String(error)
          }
        );

        return response
          .status(401)
          .json({
            error:
              "Unable to verify the native Firebase session.",
            code:
              error?.code ||
              "native-session-verification-failed"
          });
      }
    }
  );


// =================================================================
// --- MANUAL EFT WALLET TOP-UP VIA TWILIO SMS ---
// =================================================================
// Twilio sends the user's banking instructions. It does not confirm that an
// EFT reached FNB. A matching bank-statement reference must be reconciled by
// Asiye Admin (or a future FNB/bank-feed integration) before the wallet is
// credited.
const twilioAccountSid =
  defineSecret("TWILIO_ACCOUNT_SID");

const twilioAuthToken =
  defineSecret("TWILIO_AUTH_TOKEN");

const twilioFromNumber =
  defineSecret("TWILIO_FROM_NUMBER");

const ASIYE_EFT_BANK =
  "FNB";

const ASIYE_EFT_ACCOUNT =
  "63182341065";

function walletSmsCors(request, response) {
  const origin =
    request.get("origin") || "";

  const allowedOrigins =
    new Set([
      "https://asiye.cloud",
      "https://www.asiye.cloud",
      "https://app.asiye.cloud",
      "https://asiye-80386.web.app",
      "https://asiye-80386.firebaseapp.com"
    ]);

  if (
    allowedOrigins.has(origin)
  ) {
    response.set(
      "Access-Control-Allow-Origin",
      origin
    );
  } else if (
    !origin ||
    origin === "null" ||
    origin.startsWith("https://appassets.")
  ) {
    response.set(
      "Access-Control-Allow-Origin",
      "*"
    );
  }

  response.set(
    "Vary",
    "Origin"
  );

  response.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );

  response.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
}

function normaliseSmsPhone(rawPhone) {
  const original =
    String(rawPhone || "")
      .trim();

  if (!original) {
    return null;
  }

  let digits =
    original.replace(/\D/g, "");

  if (
    digits.startsWith("00")
  ) {
    digits =
      digits.substring(2);
  }

  if (
    digits.startsWith("27") &&
    digits.length === 11
  ) {
    return "+27" +
      digits.substring(2);
  }

  if (
    digits.startsWith("0") &&
    digits.length === 10
  ) {
    return "+27" +
      digits.substring(1);
  }

  if (
    digits.length === 9
  ) {
    return "+27" +
      digits;
  }

  if (
    digits.length >= 8 &&
    digits.length <= 15
  ) {
    return "+" +
      digits;
  }

  return null;
}

function eftReferenceFromPhone(phone) {
  const e164 =
    normaliseSmsPhone(phone);

  if (!e164) {
    return "";
  }

  const digits =
    e164.replace(/\D/g, "");

  if (
    digits.startsWith("27") &&
    digits.length === 11
  ) {
    return "0" +
      digits.substring(2);
  }

  return digits.slice(-15);
}

async function resolvePassengerForWallet(decoded) {
  const uid =
    String(decoded?.uid || "");

  if (!uid) {
    return null;
  }

  const directRef =
    admin.database()
      .ref(
        `commuters/${uid}`
      );

  const directSnapshot =
    await directRef.once("value");

  if (
    directSnapshot.exists()
  ) {
    return {
      id:
        uid,
      data:
        directSnapshot.val() || {}
    };
  }

  for (
    const field
    of [
      "authUid",
      "userUid"
    ]
  ) {
    const snapshot =
      await admin.database()
        .ref("commuters")
        .orderByChild(field)
        .equalTo(uid)
        .limitToFirst(1)
        .once("value");

    let match =
      null;

    snapshot.forEach(
      child => {
        if (!match) {
          match = {
            id:
              child.key,
            data:
              child.val() || {}
          };
        }
      }
    );

    if (match) {
      return match;
    }
  }

  return {
    id:
      uid,
    data:
      {}
  };
}

async function sendTwilioSms({
  to,
  body
}) {
  const accountSid =
    String(
      twilioAccountSid.value() ||
      ""
    ).trim();

  const authToken =
    String(
      twilioAuthToken.value() ||
      ""
    ).trim();

  const from =
    normaliseSmsPhone(
      twilioFromNumber.value()
    );

  if (
    !accountSid ||
    !authToken ||
    !from
  ) {
    throw new Error(
      "Twilio SMS is not configured."
    );
  }

  const endpoint =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

  const form =
    new URLSearchParams({
      To:
        to,
      From:
        from,
      Body:
        body
    });

  const response =
    await fetch(
      endpoint,
      {
        method:
          "POST",
        headers: {
          "Authorization":
            "Basic " +
            Buffer
              .from(
                accountSid +
                ":" +
                authToken
              )
              .toString(
                "base64"
              ),
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          form.toString()
      }
    );

  const payload =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok ||
    !payload.sid
  ) {
    console.error(
      "Twilio EFT SMS failed",
      {
        status:
          response.status,
        code:
          payload.code,
        message:
          payload.message
      }
    );

    throw new Error(
      payload.message ||
      "Unable to send the EFT SMS."
    );
  }

  return payload;
}

exports.createEftSmsTopup = onRequest(
  {
    region:
      "us-central1",
    secrets: [
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber
    ]
  },
  async (request, response) => {
    walletSmsCors(
      request,
      response
    );

    if (
      request.method ===
      "OPTIONS"
    ) {
      return response
        .status(204)
        .send("");
    }

    if (
      request.method !==
      "POST"
    ) {
      return response
        .status(405)
        .json({
          error:
            "POST required."
        });
    }

    try {
      const match =
        (
          request.get(
            "authorization"
          ) || ""
        )
          .match(
            /^Bearer (.+)$/
          );

      if (!match) {
        return response
          .status(401)
          .json({
            error:
              "Sign in again before adding funds."
          });
      }

      const decoded =
        await admin.auth()
          .verifyIdToken(
            match[1]
          );

      const amount =
        Number(
          request.body?.amount
        );

      if (
        !Number.isFinite(amount) ||
        amount < 10 ||
        amount > 5000
      ) {
        return response
          .status(400)
          .json({
            error:
              "Amount must be between R10 and R5,000."
          });
      }

      const passenger =
        await resolvePassengerForWallet(
          decoded
        );

      const rawPhone =
        passenger?.data?.phone ||
        passenger?.data?.phoneNumber ||
        decoded.phone_number ||
        "";

      const smsTo =
        normaliseSmsPhone(
          rawPhone
        );

      const reference =
        eftReferenceFromPhone(
          rawPhone
        );

      if (
        !smsTo ||
        !reference
      ) {
        return response
          .status(400)
          .json({
            error:
              "Your Asiye account needs a valid mobile number before EFT instructions can be sent."
          });
      }

      const passengerId =
        passenger?.id ||
        decoded.uid;

      const commuterRef =
        admin.database()
          .ref(
            `commuters/${passengerId}`
          );

      const current =
        passenger?.data || {};

      const lastSmsAt =
        Number(
          current.lastEftSmsAt ||
          0
        );

      if (
        lastSmsAt &&
        Date.now() -
          lastSmsAt <
          60 * 1000
      ) {
        return response
          .status(429)
          .json({
            error:
              "Please wait a minute before requesting another EFT SMS."
          });
      }

      const roundedAmount =
        Math.round(
          amount * 100
        ) / 100;

      const paymentRef =
        admin.database()
          .ref(
            "walletPayments"
          )
          .push();

      const paymentId =
        paymentRef.key;

      await paymentRef.set({
        uid:
          decoded.uid,
        passengerId,
        phone:
          smsTo,
        reference,
        amount:
          roundedAmount,
        currency:
          "ZAR",
        provider:
          "manual_eft",
        bank:
          ASIYE_EFT_BANK,
        accountNumber:
          ASIYE_EFT_ACCOUNT,
        status:
          "awaiting_payment",
        smsStatus:
          "sending",
        createdAt:
          admin.database
            .ServerValue
            .TIMESTAMP
      });

      const message =
        `Asiye wallet EFT: Pay R${roundedAmount.toFixed(2)} to FNB account ${ASIYE_EFT_ACCOUNT}. Use reference ${reference} exactly. Your wallet is credited after Asiye matches the payment. Request ${String(paymentId).slice(-6)}.`;

      let smsStatus =
        "failed";

      try {
        const twilioMessage =
          await sendTwilioSms({
            to:
              smsTo,
            body:
              message
          });

        smsStatus =
          "sent";

        await admin.database()
          .ref()
          .update({
            [`walletPayments/${paymentId}/smsStatus`]:
              "sent",
            [`walletPayments/${paymentId}/twilioMessageSid`]:
              String(
                twilioMessage.sid
              ),
            [`walletPayments/${paymentId}/twilioDeliveryStatus`]:
              String(
                twilioMessage.status ||
                "accepted"
              ),
            [`walletPayments/${paymentId}/instructionsSentAt`]:
              admin.database
                .ServerValue
                .TIMESTAMP,
            [`commuters/${passengerId}/lastEftSmsAt`]:
              admin.database
                .ServerValue
                .TIMESTAMP
          });

      } catch (smsError) {
        /*
         * Keep the EFT payable even if Twilio is temporarily unavailable.
         * The passenger still receives the exact banking details in-app.
         */
        await paymentRef.update({
          smsStatus:
            "failed",
          smsError:
            String(
              smsError?.message ||
              "SMS failed"
            )
              .slice(0, 300),
          updatedAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        });

        console.error(
          "EFT instruction SMS delivery failed",
          {
            paymentId,
            message:
              smsError?.message ||
              "SMS failed"
          }
        );
      }

      return response
        .status(200)
        .json({
          ok:
            true,
          paymentId,
          bank:
            ASIYE_EFT_BANK,
          accountNumber:
            ASIYE_EFT_ACCOUNT,
          reference,
          amount:
            roundedAmount,
          smsTo:
            smsTo.replace(
              /(\+27\d{2})\d+(\d{2})$/,
              "$1•••••$2"
            ),
          smsStatus,
          status:
            "awaiting_payment",
          message:
            smsStatus === "sent"
              ? "EFT banking instructions were accepted for SMS delivery."
              : "EFT banking details are ready on screen. SMS delivery is temporarily unavailable."
        });

    } catch (error) {
      console.error(
        "Create EFT SMS top-up failed",
        error
      );

      return response
        .status(500)
        .json({
          error:
            error?.message ||
            "Unable to send the EFT instructions."
        });
    }
  }
);

// =================================================================
// --- EFT PAYMENT CONFIRMATION SMS ---
// =================================================================
// When Asiye Admin reconciles a manual EFT and marks it complete, notify the
// passenger automatically. Twilio failure never rolls back the wallet credit.
exports.sendEftPaymentStatusSms =
  onValueUpdated(
    {
      ref:
        "/walletPayments/{paymentId}",
      region:
        "us-central1",
      secrets: [
        twilioAccountSid,
        twilioAuthToken,
        twilioFromNumber
      ]
    },
    async event => {
      const before =
        event.data.before.val() ||
        {};

      const after =
        event.data.after.val() ||
        {};

      if (
        after.provider !==
          "manual_eft" ||
        before.status ===
          after.status ||
        after.status !==
          "complete"
      ) {
        return;
      }

      const paymentId =
        event.params.paymentId;

      const phone =
        normaliseSmsPhone(
          after.phone
        );

      if (!phone) {
        await event.data.after.ref.update({
          confirmationSmsStatus:
            "failed",
          confirmationSmsError:
            "No valid mobile number is attached to this EFT payment."
        });

        return;
      }

      const statusRef =
        event.data.after.ref.child(
          "confirmationSmsStatus"
        );

      const claim =
        await statusRef.transaction(
          current => {
            if (current) {
              return;
            }

            return "sending";
          }
        );

      if (!claim.committed) {
        return;
      }

      const amount =
        Number(after.amount || 0);

      const balance =
        Number(
          after.creditedBalance ||
          0
        );

      const amountText =
        Number.isFinite(amount)
          ? `R${amount.toFixed(2)}`
          : "your EFT";

      const balanceText =
        Number.isFinite(balance)
          ? ` Your Asiye Wallet balance is now R${balance.toFixed(2)}.`
          : "";

      const confirmationMessage =
        `Asiye payment update: We received ${amountText} by EFT and your wallet has been credited.${balanceText} Ref ${after.reference || String(paymentId).slice(-6)}.`;

      try {
        const twilioMessage =
          await sendTwilioSms({
            to:
              phone,
            body:
              confirmationMessage
          });

        await event.data.after.ref.update({
          confirmationSmsStatus:
            "sent",
          confirmationSmsSid:
            String(
              twilioMessage.sid
            ),
          confirmationTwilioStatus:
            String(
              twilioMessage.status ||
              "accepted"
            ),
          confirmationSmsSentAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        });

      } catch (error) {
        console.error(
          "EFT confirmation SMS failed",
          {
            paymentId,
            message:
              error?.message ||
              "SMS failed"
          }
        );

        await event.data.after.ref.update({
          confirmationSmsStatus:
            "failed",
          confirmationSmsError:
            String(
              error?.message ||
              "SMS failed"
            ).slice(0, 300),
          confirmationSmsUpdatedAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        });
      }
    }
  );


// =================================================================
// --- RESTORED: CUSTOM AUTH TOKEN GENERATOR (1st Gen) ---
// =================================================================
exports.createCustomToken = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  const requestedUid =
    typeof data?.uid === "string" &&
    data.uid.trim()
      ? data.uid.trim()
      : context.auth.uid;

  if (requestedUid !== context.auth.uid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "A user can only request a token for their own Firebase account."
    );
  }

  try {
    const customToken =
      await admin.auth()
        .createCustomToken(
          context.auth.uid
        );

    return {
      token:
        customToken
    };

  } catch (error) {
    console.error(
      "Unable to create self custom token",
      error
    );

    throw new functions.https.HttpsError(
      "internal",
      "Unable to create custom token."
    );
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

function clubPickupTimeLabel(request) {
  const raw =
    request.departureTime ||
    request.pickupTime ||
    request.scheduledTime ||
    request.requestedPickupTime ||
    "ASAP";

  if (
    raw === "ASAP" ||
    raw === "asap"
  ) {
    return "ASAP";
  }

  const numeric =
    Number(raw);

  if (
    Number.isFinite(numeric) &&
    numeric > 100000000000
  ) {
    try {
      return new Date(numeric)
        .toLocaleTimeString(
          "en-ZA",
          {
            timeZone:
              "Africa/Johannesburg",
            hour:
              "2-digit",
            minute:
              "2-digit",
            hour12:
              false
          }
        );
    } catch (_) {
      return "ASAP";
    }
  }

  const text =
    String(raw || "")
      .trim();

  return text || "ASAP";
}

exports.notifyDriversWhenClubReady = functions
  .runWith({
    secrets: [
      twilioAccountSid,
      twilioAuthToken,
      twilioFromNumber
    ]
  })
  .database
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
        taxi.isFull === true
      ) {
        return;
      }

      const driverPhone =
        normaliseSmsPhone(
          taxi.phone ||
          taxi.phoneNumber ||
          taxi.mobile ||
          ""
        );

      if (!driverPhone) {
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
        driverId:
          child.key,
        distanceKm,
        phone:
          driverPhone,
        driverName:
          taxi.name ||
          taxi.fullName ||
          "Driver"
      });
    });

    candidates.sort((left, right) => left.distanceKm - right.distanceKm);
    const selected = candidates.slice(0, 8);

    const pickupTime =
      clubPickupTimeLabel(
        request
      );

    const passengerCount =
      Number(
        request.passengerCount ||
        Object.keys(
          request.passengers ||
          {}
        ).length
      );

    if (
      request.clubMode === "club4" &&
      passengerCount < 3
    ) {
      console.warn(
        `Club ${requestId} became ready before 3 passengers were recorded.`
      );

      return null;
    }

    await Promise.all(
      selected.map(
        async candidate => {
          await admin.database()
            .ref(
              `/notifications/taxis/${candidate.driverId}/${requestId}`
            )
            .set({
              type:
                "club_request",
              requestId,
              rideType:
                request.clubMode ||
                "club4",
              serviceName:
                "Asiye Work",
              commuterName:
                request.commuterName ||
                "Asiye Work passengers",
              pickupAddress:
                request.pickupAddress ||
                "Pickup",
              destination:
                request.destination ||
                "Destination",
              fare:
                Number(
                  request.pricePerPassenger ||
                  0
                ),
              passengerCount:
                passengerCount ||
                requiredSeats,
              capacity:
                requiredSeats,
              distanceKm:
                candidate.distanceKm,
              pickupTime,
              timestamp:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            });

          const smsRef =
            admin.database()
              .ref(
                `/requests/${requestId}/driverSmsNotifications/${candidate.driverId}`
              );

          const claim =
            await smsRef.transaction(
              current => {
                if (
                  current &&
                  (
                    current.status === "sent" ||
                    current.status === "sending"
                  )
                ) {
                  return;
                }

                return {
                  status:
                    "sending",
                  phone:
                    candidate.phone,
                  distanceKm:
                    candidate.distanceKm,
                  attemptedAt:
                    Date.now()
                };
              }
            );

          if (!claim.committed) {
            return;
          }

          const smsBody =
            `Asiye: You have a load to fetch at ${pickupTime}. Check your Asiye app to accept or reject.`;

          try {
            const result =
              await sendTwilioSms({
                to:
                  candidate.phone,
                body:
                  smsBody
              });

            await smsRef.update({
              status:
                "sent",
              twilioMessageSid:
                String(
                  result.sid ||
                  ""
                ),
              sentAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            });

          } catch (error) {
            console.error(
              `Club SMS failed for driver ${candidate.driverId}`,
              error
            );

            await smsRef.update({
              status:
                "failed",
              error:
                String(
                  error?.message ||
                  "SMS failed"
                ).slice(0, 300),
              failedAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            });
          }
        }
      )
    );

    console.log(
      `Asiye Work ${requestId} sent to ${selected.length} nearby driver(s) within 10 km, with Twilio SMS reminders.`
    );

    return null;
  });


// =================================================================
// --- LEGACY HOSTED WALLET GATEWAY REMOVED ---
// =================================================================
// Wallet funding now uses Twilio SMS instructions for a manual FNB EFT.

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
    year:
      Math.round(
        safeAdminNumber(
          source.year ??
          source.vehicleYear ??
          fallback.year ??
          fallback.vehicleYear,
          0
        )
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
      version: 2,
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

    const enrollmentProfileImage =
      safeAdminString(
        enrollment.profileImageUrl ||
        enrollment.profile_picture_url ||
        enrollment.documentUrls?.selfie ||
        "",
        2000
      );

    const enrollmentVehiclePhoto =
      safeAdminString(
        enrollment.vehiclePhoto ||
        enrollment.documentUrls?.car ||
        "",
        2000
      );

    const enrollmentPhone =
      safeAdminString(
        enrollment.phone ||
        "",
        40
      );

    if (
      !approvedVehicle.make ||
      !approvedVehicle.model ||
      !approvedVehicle.colour ||
      !approvedVehicle.registration ||
      !approvedVehicle.year ||
      !enrollmentPhone ||
      !enrollmentProfileImage ||
      !enrollmentVehiclePhoto
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Driver phone, selfie, car photo, vehicle make, model, colour, year and registration are required before approval."
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
      vehicleYear:
        approvedVehicle.year,
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
        year:
          approvedVehicle.year,
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
        enrollmentProfileImage ||
        currentTaxi.profile_picture_url ||
        "",
      profileImageUrl:
        enrollmentProfileImage ||
        currentTaxi.profileImageUrl ||
        "",
      vehiclePhoto:
        enrollmentVehiclePhoto ||
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
        Number(enrollment.version || 2),
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

      if ("vehicleYear" in source) {
        const vehicleYear =
          Math.round(
            safeAdminNumber(
              source.vehicleYear,
              0
            )
          );

        if (
          vehicleYear < 1990 ||
          vehicleYear > 2100
        ) {
          throw new functions.https.HttpsError(
            "invalid-argument",
            "Vehicle year is invalid."
          );
        }

        patch.vehicleYear =
          vehicleYear;
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
        driverProfileImageUrl:
          safeAdminString(
            driver.profileImageUrl ||
            driver.profile_picture_url ||
            "",
            2000
          ),
        driverVehiclePhoto:
          safeAdminString(
            driver.vehiclePhoto ||
            driver.carPhoto ||
            "",
            2000
          ),
        vehiclePhoto:
          safeAdminString(
            driver.vehiclePhoto ||
            driver.carPhoto ||
            "",
            2000
          ),
        vehicleMake:
          safeAdminString(
            driver.vehicleMake ||
            driver.vehicle?.make ||
            "",
            80
          ),
        vehicleModel:
          safeAdminString(
            driver.vehicleModel ||
            driver.vehicle?.model ||
            "",
            80
          ),
        vehicleColor:
          safeAdminString(
            driver.vehicleColor ||
            driver.vehicle?.colour ||
            driver.vehicle?.color ||
            "",
            60
          ),
        vehicleYear:
          Math.round(
            safeAdminNumber(
              driver.vehicleYear ||
              driver.vehicle?.year,
              0
            )
          ),
        vehicleReg:
          safeAdminString(
            driver.vehicleReg ||
            driver.vehicle?.registration ||
            driver.taxiRegistrationNumber ||
            "",
            30
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
          driverProfileImageUrl:
            requestPatch.driverProfileImageUrl,
          vehiclePhoto:
            requestPatch.vehiclePhoto,
          vehicleMake:
            requestPatch.vehicleMake,
          vehicleModel:
            requestPatch.vehicleModel,
          vehicleColor:
            requestPatch.vehicleColor,
          vehicleYear:
            requestPatch.vehicleYear,
          vehicleReg:
            requestPatch.vehicleReg,
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

    if (action === "reconcileEftTopup") {
      const id =
        safeAdminString(
          data?.id,
          180
        );

      const bankTrace =
        safeAdminString(
          data?.bankTrace,
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

      const paymentRef =
        admin.database()
          .ref(
            `walletPayments/${id}`
          );

      const payment =
        (
          await paymentRef
            .once("value")
        ).val();

      if (!payment) {
        throw new functions.https.HttpsError(
          "not-found",
          "Wallet top-up was not found."
        );
      }

      if (
        payment.provider !==
        "manual_eft"
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Only manual EFT top-ups can be reconciled with this action."
        );
      }

      if (
        payment.status ===
        "complete"
      ) {
        return {
          ok: true,
          alreadyComplete: true,
          balance:
            Number(
              payment.creditedBalance ||
              0
            )
        };
      }

      if (
        payment.status !==
        "awaiting_payment"
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "This EFT top-up is not awaiting payment."
        );
      }

      const passengerId =
        safeAdminString(
          payment.passengerId ||
          payment.uid,
          160
        );

      const amount =
        safeAdminNumber(
          payment.amount,
          NaN
        );

      if (
        !passengerId ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "The EFT top-up record is incomplete."
        );
      }

      const commuterRef =
        admin.database()
          .ref(
            `commuters/${passengerId}`
          );

      const markerKey =
        `manualEft_${id}`;

      const creditResult =
        await commuterRef
          .transaction(
            current => {
              if (!current) {
                return;
              }

              const applied =
                current
                  .walletAppliedPayments ||
                {};

              if (
                applied[markerKey]
              ) {
                return current;
              }

              const currentBalance =
                safeAdminNumber(
                  current.walletBalance ??
                  current.credits,
                  0
                );

              const nextBalance =
                Math.round(
                  (
                    currentBalance +
                    amount
                  ) *
                  100
                ) / 100;

              applied[markerKey] = {
                provider:
                  "manual_eft",
                paymentId:
                  id,
                amount,
                reference:
                  payment.reference ||
                  "",
                bankTrace:
                  bankTrace ||
                  "",
                appliedAt:
                  Date.now()
              };

              current
                .walletAppliedPayments =
                applied;

              current.walletBalance =
                nextBalance;

              current.credits =
                nextBalance;

              current
                .walletAdminUpdatedAt =
                Date.now();

              return current;
            }
          );

      if (!creditResult.committed) {
        throw new functions.https.HttpsError(
          "not-found",
          "Passenger account was not found."
        );
      }

      const creditedBalance =
        safeAdminNumber(
          creditResult
            .snapshot
            .val()
            ?.walletBalance,
          0
        );

      await paymentRef.update({
        status:
          "complete",
        bankTrace:
          bankTrace,
        adminNote:
          note,
        reconciledAt:
          admin.database
            .ServerValue
            .TIMESTAMP,
        reconciledBy:
          actor.uid,
        reconciledByEmail:
          actor.email ||
          "",
        creditedBalance:
          creditedBalance,
        completedAt:
          admin.database
            .ServerValue
            .TIMESTAMP
      });

      await writeAdminAudit(
        actor,
        "manual_eft_reconciled",
        id,
        {
          passengerId,
          amount,
          reference:
            payment.reference ||
            "",
          bankTrace:
            bankTrace ||
            "",
          balanceAfter:
            creditedBalance
        }
      );

      return {
        ok: true,
        balance:
          creditedBalance
      };
    }

    if (action === "cancelEftTopup") {
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

      const ref =
        admin.database()
          .ref(
            `walletPayments/${id}`
          );

      const payment =
        (
          await ref
            .once("value")
        ).val();

      if (!payment) {
        throw new functions.https.HttpsError(
          "not-found",
          "Wallet top-up was not found."
        );
      }

      if (
        payment.provider !==
        "manual_eft"
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Only manual EFT top-ups can be cancelled here."
        );
      }

      if (
        payment.status ===
        "complete"
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "A completed EFT top-up cannot be cancelled."
        );
      }

      await ref.update({
        status:
          "cancelled",
        adminNote:
          note,
        cancelledAt:
          admin.database
            .ServerValue
            .TIMESTAMP,
        cancelledBy:
          actor.uid
      });

      await writeAdminAudit(
        actor,
        "manual_eft_cancelled",
        id,
        {
          note
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
            vehicleYear:
              approvedVehicle.year,
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


// =================================================================
// --- ADMIN READ API ---
// =================================================================

exports.adminFetchData = functions.https.onCall(
  async (data, context) => {
    await requireAsiyeAdmin(context);

    const resource =
      safeAdminString(
        data?.resource,
        80
      );

    const allowed = new Set([
      "commuters",
      "taxis",
      "driverEnrollments",
      "driverApprovals",
      "driver_applications",
      "requests",
      "delivery_requests",
      "support_chats",
      "walletPayments",
      "walletAdjustments",
      "withdrawals",
      "payout_requests",
      "adminAudit"
    ]);

    if (!allowed.has(resource)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Unsupported admin data resource."
      );
    }

    const requestedLimit =
      Math.round(
        safeAdminNumber(
          data?.limit,
          250
        )
      );

    const limit =
      Math.min(
        500,
        Math.max(
          25,
          requestedLimit
        )
      );

    const snapshot =
      await admin.database()
        .ref(resource)
        .limitToLast(limit)
        .once("value");

    return {
      ok: true,
      resource,
      data:
        snapshot.val() ||
        {}
    };
  }
);


// =================================================================
// --- PUBLIC ACCOUNT DELETION REQUEST ---
// =================================================================

function deletionCors(request, response) {
  const origin = request.get("origin") || "";
  const allowedOrigins = new Set([
    "https://asiye.cloud",
    "https://www.asiye.cloud"
  ]);

  if (allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
  }

  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function deletionText(value, maxLength) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, maxLength);
}

exports.submitAccountDeletionRequest = onRequest(
  { region: "us-central1" },
  async (request, response) => {
    deletionCors(request, response);

    if (request.method === "OPTIONS") {
      return response.status(204).send("");
    }

    if (request.method !== "POST") {
      return response.status(405).json({
        error: "POST required."
      });
    }

    try {
      const accountType =
        deletionText(
          request.body?.accountType,
          20
        ).toLowerCase();

      const name =
        deletionText(
          request.body?.name,
          120
        );

      const phone =
        deletionText(
          request.body?.phone,
          40
        );

      const email =
        deletionText(
          request.body?.email,
          180
        ).toLowerCase();

      const reason =
        deletionText(
          request.body?.reason,
          800
        );

      const confirmation =
        request.body?.confirmation ===
        true;

      const website =
        deletionText(
          request.body?.website,
          120
        );

      if (website) {
        return response.status(200).json({
          ok: true
        });
      }

      if (
        ![
          "passenger",
          "driver",
          "both"
        ].includes(accountType)
      ) {
        return response.status(400).json({
          error:
            "Choose passenger, driver, or both."
        });
      }

      if (!phone && !email) {
        return response.status(400).json({
          error:
            "Enter the phone number or email linked to your Asiye account."
        });
      }

      if (
        email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(email)
      ) {
        return response.status(400).json({
          error:
            "Enter a valid email address."
        });
      }

      const phoneDigits =
        phone.replace(/\D/g, "");

      if (
        phone &&
        (
          phoneDigits.length < 7 ||
          phoneDigits.length > 15
        )
      ) {
        return response.status(400).json({
          error:
            "Enter a valid phone number."
        });
      }

      if (!confirmation) {
        return response.status(400).json({
          error:
            "Confirm that you want Asiye to delete your account and associated data."
        });
      }

      const ref =
        admin.database()
          .ref(
            "accountDeletionRequests"
          )
          .push();

      await ref.set({
        requestId:
          ref.key,
        accountType,
        name,
        phone,
        email,
        reason,
        status:
          "pending",
        source:
          "asiye.cloud/delete",
        requestedAt:
          admin.database
            .ServerValue
            .TIMESTAMP,
        updatedAt:
          admin.database
            .ServerValue
            .TIMESTAMP
      });

      return response.status(200).json({
        ok: true,
        requestId:
          ref.key,
        message:
          "Your Asiye account deletion request has been received."
      });

    } catch (error) {
      console.error(
        "Account deletion request failed",
        error
      );

      return response.status(500).json({
        error:
          "Unable to submit the deletion request right now."
      });
    }
  }
);


// =================================================================
// --- SERVER-SIDE ASIYE GO DRIVER DISPATCH ---
// =================================================================
// The passenger client must not write into another driver's taxi profile.
// Dispatching via Admin SDK keeps Phase 2 profile rules intact and guarantees
// the request notification/queue write can reach eligible drivers.
exports.dispatchGoRideRequest =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public"
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) ||
            ""
          ).match(
            /^Bearer (.+)$/
          );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Passenger authentication is required."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        if (
          !/^[A-Za-z0-9_-]{1,160}$/.test(
            requestId
          )
        ) {
          return response
            .status(400)
            .json({
              error:
                "Ride reference is invalid."
            });
        }

        const passenger =
          await resolvePassengerForWallet(
            decoded
          );

        if (!passenger) {
          return response
            .status(403)
            .json({
              error:
                "Passenger profile could not be verified."
            });
        }

        const requestRef =
          admin.database()
            .ref(
              `requests/${requestId}`
            );

        const snapshot =
          await requestRef.once(
            "value"
          );

        if (!snapshot.exists()) {
          return response
            .status(404)
            .json({
              error:
                "Ride request was not found."
            });
        }

        const trip =
          snapshot.val() || {};

        const ownsTrip =
          trip.commuterId ===
            passenger.id ||
          trip.commuterId ===
            decoded.uid ||
          Boolean(
            trip.passengers?.[
              passenger.id
            ]
          ) ||
          Boolean(
            trip.passengers?.[
              decoded.uid
            ]
          );

        if (!ownsTrip) {
          return response
            .status(403)
            .json({
              error:
                "This ride does not belong to the signed-in passenger."
            });
        }

        if (
          trip.type === "club"
        ) {
          return response
            .status(400)
            .json({
              error:
                "Club rides use the Club dispatch flow."
            });
        }

        if (
          ![
            "pending",
            "searching",
            "driver_busy"
          ].includes(
            String(
              trip.status ||
              ""
            )
          )
        ) {
          return response
            .status(409)
            .json({
              error:
                "This ride is not ready for driver dispatch."
            });
        }

        const pickupLat =
          Number(
            trip.commuterLocation
              ?.latitude
          );

        const pickupLng =
          Number(
            trip.commuterLocation
              ?.longitude
          );

        if (
          !Number.isFinite(
            pickupLat
          ) ||
          !Number.isFinite(
            pickupLng
          )
        ) {
          return response
            .status(400)
            .json({
              error:
                "Pickup location is unavailable."
            });
        }

        const taxisSnapshot =
          await admin.database()
            .ref(
              "taxis"
            )
            .once(
              "value"
            );

        const idleDrivers =
          [];

        const busyDrivers =
          [];

        taxisSnapshot.forEach(
          child => {
            const taxi =
              child.val() ||
              {};

            if (
              taxi.isOnline !==
              true
            ) {
              return;
            }

            const lat =
              Number(
                taxi.latitude
              );

            const lng =
              Number(
                taxi.longitude
              );

            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng)
            ) {
              return;
            }

            const vehicleType =
              String(
                taxi.vehicleType ||
                ""
              )
                .toLowerCase();

            if (
              vehicleType &&
              ![
                "ehailing",
                "e-hailing",
                "go",
                "car"
              ].includes(
                vehicleType
              )
            ) {
              return;
            }

            const distanceKm =
              haversineKm(
                pickupLat,
                pickupLng,
                lat,
                lng
              );

            if (
              !Number.isFinite(
                distanceKm
              ) ||
              distanceKm >
                10
            ) {
              return;
            }

            const item = {
              driverId:
                child.key,
              taxi,
              distanceKm
            };

            if (
              taxi.currentRequest
            ) {
              busyDrivers.push(
                item
              );
            } else if (
              taxi.isFull !==
              true
            ) {
              idleDrivers.push(
                item
              );
            }
          }
        );

        idleDrivers.sort(
          (
            left,
            right
          ) =>
            left.distanceKm -
            right.distanceKm
        );

        busyDrivers.sort(
          (
            left,
            right
          ) =>
            left.distanceKm -
            right.distanceKm
        );

        if (
          idleDrivers.length
        ) {
          const candidates =
            idleDrivers.slice(
              0,
              8
            );

          const updates = {};

          for (
            const candidate
            of candidates
          ) {
            updates[
              `notifications/taxis/${candidate.driverId}/${requestId}`
            ] = {
              type:
                "ride_request",
              requestId,
              rideType:
                "go",
              commuterId:
                trip.commuterId ||
                passenger.id,
              commuterName:
                trip.commuterName ||
                "Passenger",
              pickupAddress:
                trip.pickupAddress ||
                "Pickup",
              destination:
                trip.destination ||
                trip.destinationName ||
                "Destination",
              fare:
                Number(
                  trip.finalAmount ||
                  trip.calculatedPrice ||
                  0
                ),
              distanceKm:
                candidate.distanceKm,
              paymentMethod:
                String(
                  trip.paymentMethod ||
                  "cash"
                ),
              timestamp:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            };
          }

          updates[
            `requests/${requestId}/status`
          ] =
            "searching";

          updates[
            `requests/${requestId}/driverDispatchCount`
          ] =
            candidates.length;

          updates[
            `requests/${requestId}/driverDispatchAt`
          ] =
            admin.database
              .ServerValue
              .TIMESTAMP;

          updates[
            `requests/${requestId}/driverBusy`
          ] =
            false;

          await admin.database()
            .ref()
            .update(
              updates
            );

          return response
            .status(200)
            .json({
              ok:
                true,
              mode:
                "broadcast",
              drivers:
                candidates.length
            });
        }

        if (
          busyDrivers.length
        ) {
          const selected =
            busyDrivers[0];

          const now =
            admin.database
              .ServerValue
              .TIMESTAMP;

          await admin.database()
            .ref()
            .update({
              [`requests/${requestId}/status`]:
                "driver_busy",
              [`requests/${requestId}/queuedTaxiId`]:
                selected.driverId,
              [`requests/${requestId}/driverBusy`]:
                true,
              [`requests/${requestId}/queuedAt`]:
                now,
              [`taxis/${selected.driverId}/bookingQueue/${requestId}`]:
                {
                  requestId,
                  commuterId:
                    trip.commuterId ||
                    passenger.id,
                  commuterName:
                    trip.commuterName ||
                    "Passenger",
                  pickupAddress:
                    trip.pickupAddress ||
                    "Pickup",
                  destination:
                    trip.destination ||
                    trip.destinationName ||
                    "Destination",
                  fare:
                    Number(
                      trip.finalAmount ||
                      trip.calculatedPrice ||
                      0
                    ),
                  paymentMethod:
                    String(
                      trip.paymentMethod ||
                      "cash"
                    ),
                  queuedAt:
                    now
                }
            });

          return response
            .status(200)
            .json({
              ok:
                true,
              mode:
                "queued",
              driverId:
                selected.driverId
            });
        }

        await requestRef.update({
          status:
            "searching",
          driverBusy:
            false,
          driverDispatchCount:
            0,
          driverDispatchAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        });

        return response
          .status(200)
          .json({
            ok:
              true,
            mode:
              "none",
            drivers:
              0
          });

      } catch (error) {
        console.error(
          "Go ride dispatch failed",
          {
            code:
              error?.code ||
              "unknown",
            message:
              error?.message ||
              String(error)
          }
        );

        return response
          .status(500)
          .json({
            error:
              "Unable to send this ride request to nearby drivers."
          });
      }
    }
  );


// =================================================================
// --- SERVER-SIDE ASIYE WALLET RIDE READINESS CHECK ---
// =================================================================
// Before a driver completes a wallet-funded trip, verify the passenger(s)
// still have enough confirmed wallet value for the fare. This is intentionally
// a server-side check so a modified WebView cannot fake the balance result.
async function driverOwnsTrip(decodedUid, trip) {
  if (
    !decodedUid ||
    !trip
  ) {
    return false;
  }

  if (
    trip.driverAuthUid ===
      decodedUid
  ) {
    return true;
  }

  const taxiId =
    String(
      trip.taxiId ||
      trip.driverId ||
      ""
    ).trim();

  if (!taxiId) {
    return false;
  }

  if (taxiId === decodedUid) {
    return true;
  }

  const taxi =
    (
      await admin.database()
        .ref(
          `taxis/${taxiId}`
        )
        .once(
          "value"
        )
    ).val() || {};

  return (
    taxi.authUid === decodedUid ||
    taxi.userUid === decodedUid
  );
}

function tripPassengerFare(
  trip,
  passenger = null
) {
  const raw =
    trip?.type === "club"
      ? (
          passenger?.price ??
          trip?.pricePerPassenger ??
          0
        )
      : (
          trip?.agreedFare ??
          trip?.finalAmount ??
          trip?.calculatedPrice ??
          0
        );

  const fare =
    Number(raw);

  return Number.isFinite(fare)
    ? Math.max(
        0,
        Math.round(fare * 100) / 100
      )
    : 0;
}

async function passengerWalletStatus(
  passengerId,
  required
) {
  const id =
    String(
      passengerId ||
      ""
    ).trim();

  if (!id) {
    return {
      id,
      balance:
        0,
      required,
      sufficient:
        false
    };
  }

  const profile =
    (
      await admin.database()
        .ref(
          `commuters/${id}`
        )
        .once(
          "value"
        )
    ).val() || {};

  const balance =
    Number(
      profile.walletBalance ??
      profile.credits ??
      0
    );

  const safeBalance =
    Number.isFinite(balance)
      ? Math.round(
          balance * 100
        ) / 100
      : 0;

  return {
    id,
    name:
      profile.name ||
      profile.firstName ||
      "Passenger",
    balance:
      safeBalance,
    required,
    sufficient:
      safeBalance + 0.00001 >=
      required
  };
}

exports.confirmTripWalletReady =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public"
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) ||
            ""
          ).match(
            /^Bearer (.+)$/
          );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Driver authentication is required."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(
            requestId
          )
        ) {
          return response
            .status(400)
            .json({
              error:
                "Trip reference is invalid."
            });
        }

        const trip =
          (
            await admin.database()
              .ref(
                `requests/${requestId}`
              )
              .once(
                "value"
              )
          ).val();

        if (!trip) {
          return response
            .status(404)
            .json({
              error:
                "Trip was not found."
            });
        }

        if (
          !await driverOwnsTrip(
            decoded.uid,
            trip
          )
        ) {
          return response
            .status(403)
            .json({
              error:
                "Only the assigned driver can complete this trip."
            });
        }

        const statuses =
          [];

        if (
          trip.type ===
            "club"
        ) {
          for (
            const [
              passengerId,
              passenger
            ]
            of Object.entries(
              trip.passengers ||
              {}
            )
          ) {
            if (
              [
                "cancelled",
                "cancelled_by_commuter",
                "cancelled_by_driver",
                "cancelled_by_admin",
                "rejected"
              ].includes(
                String(
                  passenger?.status ||
                  ""
                )
              )
            ) {
              continue;
            }

            const method =
              String(
                passenger?.paymentMethod ||
                trip.paymentMethod ||
                "wallet"
              )
                .toLowerCase();

            if (
              method !==
                "wallet"
            ) {
              continue;
            }

            const required =
              tripPassengerFare(
                trip,
                passenger
              );

            statuses.push(
              await passengerWalletStatus(
                passengerId,
                required
              )
            );
          }
        } else {
          const method =
            String(
              trip.paymentMethod ||
              "wallet"
            )
              .toLowerCase();

          if (
            method ===
              "wallet"
          ) {
            const required =
              tripPassengerFare(
                trip
              );

            statuses.push(
              await passengerWalletStatus(
                trip.commuterId,
                required
              )
            );
          }
        }

        const insufficient =
          statuses.filter(
            item =>
              !item.sufficient
          );

        if (
          insufficient.length
        ) {
          const first =
            insufficient[0];

          return response
            .status(409)
            .json({
              ok:
                false,
              ready:
                false,
              error:
                `${first.name}'s Asiye Wallet has R${first.balance.toFixed(2)} but R${first.required.toFixed(2)} is required before this trip can be completed.`,
              insufficient
            });
        }

        return response
          .status(200)
          .json({
            ok:
              true,
            ready:
              true,
            wallets:
              statuses
          });

      } catch (error) {
        console.error(
          "Trip wallet readiness check failed",
          error
        );

        return response
          .status(500)
          .json({
            error:
              error?.message ||
              "Unable to verify the Asiye Wallet."
          });
      }
    }
  );


// =================================================================
// --- AUTHENTICATED PROFILE IMAGE STORAGE ---
// =================================================================
// Profile scans are stored directly in Firebase Storage. The old PHP uploader
// at app.asiye.cloud/upload_handler.php no longer exists and returned the
// LiteSpeed 404 page seen on-device. Writing through Admin SDK also guarantees
// the profile URL is allocated to the correct commuter/taxi record.
const PROFILE_STORAGE_BUCKET =
  "asiye-80386.firebasestorage.app";

function safeProfileId(value) {
  const id =
    String(value || "")
      .trim();

  return /^[A-Za-z0-9_-]{1,160}$/.test(id)
    ? id
    : "";
}

async function profileOwnedByAuth(
  rootName,
  profileId,
  authUid
) {
  if (
    !rootName ||
    !profileId ||
    !authUid
  ) {
    return false;
  }

  if (profileId === authUid) {
    return true;
  }

  const snapshot =
    await admin.database()
      .ref(
        `${rootName}/${profileId}`
      )
      .once(
        "value"
      );

  const profile =
    snapshot.val() || {};

  return (
    profile.authUid === authUid ||
    profile.userUid === authUid
  );
}

function profileImageExtension(
  mimeType
) {
  if (
    mimeType === "image/png"
  ) {
    return "png";
  }

  if (
    mimeType === "image/webp"
  ) {
    return "webp";
  }

  return "jpg";
}

function firebaseStorageDownloadUrl({
  bucketName,
  objectPath,
  token
}) {
  return (
    "https://firebasestorage.googleapis.com/v0/b/" +
    encodeURIComponent(bucketName) +
    "/o/" +
    encodeURIComponent(objectPath) +
    "?alt=media&token=" +
    encodeURIComponent(token)
  );
}

exports.uploadProfileImageProxy =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public"
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) ||
            ""
          ).match(
            /^Bearer (.+)$/
          );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before uploading a profile picture."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const userId =
          safeProfileId(
            request.body?.userId
          );

        const purpose =
          String(
            request.body?.purpose ||
            "profile"
          )
            .trim()
            .slice(
              0,
              80
            );

        const role =
          purpose.startsWith(
            "driver"
          )
            ? "driver"
            : "passenger";

        const rootName =
          role === "driver"
            ? "taxis"
            : "commuters";

        if (!userId) {
          return response
            .status(400)
            .json({
              error:
                "Profile identity is invalid."
            });
        }

        if (
          !await profileOwnedByAuth(
            rootName,
            userId,
            decoded.uid
          )
        ) {
          return response
            .status(403)
            .json({
              error:
                "You cannot update this profile picture."
            });
        }

        const dataUrl =
          String(
            request.body?.dataUrl ||
            ""
          );

        const dataMatch =
          dataUrl.match(
            /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/
          );

        if (!dataMatch) {
          return response
            .status(400)
            .json({
              error:
                "Profile image data is invalid."
            });
        }

        const mimeType =
          dataMatch[1] ===
            "image/jpg"
            ? "image/jpeg"
            : dataMatch[1];

        const bytes =
          Buffer.from(
            dataMatch[2],
            "base64"
          );

        if (
          bytes.length < 100 ||
          bytes.length >
            3 * 1024 * 1024
        ) {
          return response
            .status(400)
            .json({
              error:
                "Profile image must be smaller than 3 MB."
            });
        }

        const extension =
          profileImageExtension(
            mimeType
          );

        const roleFolder =
          role === "driver"
            ? "drivers"
            : "passengers";

        const objectPath =
          `profile-images/${roleFolder}/${userId}/profile.${extension}`;

        const downloadToken =
          require("node:crypto")
            .randomUUID();

        const bucket =
          admin.storage()
            .bucket(
              PROFILE_STORAGE_BUCKET
            );

        const file =
          bucket.file(
            objectPath
          );

        await file.save(
          bytes,
          {
            resumable:
              false,
            metadata: {
              contentType:
                mimeType,
              cacheControl:
                "private,max-age=300",
              metadata: {
                firebaseStorageDownloadTokens:
                  downloadToken,
                asiyeProfileRole:
                  role,
                asiyeProfileId:
                  userId,
                asiyeAuthUid:
                  decoded.uid
              }
            }
          }
        );

        const url =
          firebaseStorageDownloadUrl({
            bucketName:
              PROFILE_STORAGE_BUCKET,
            objectPath,
            token:
              downloadToken
          });

        const now =
          admin.database
            .ServerValue
            .TIMESTAMP;

        const patch =
          role === "driver"
            ? {
                profile_picture_url:
                  url,
                profileImageUrl:
                  url,
                driverProfileImageUrl:
                  url,
                profilePhotoUrl:
                  url,
                photoURL:
                  url,
                faceScanCompleted:
                  true,
                faceScanVerified:
                  true,
                faceScanVerifiedAt:
                  now,
                profilePhotoUpdatedAt:
                  now,
                profileImageStoragePath:
                  objectPath,
                "documents/FACE":
                  url
              }
            : {
                profileImageUrl:
                  url,
                profile_picture_url:
                  url,
                profilePhotoUrl:
                  url,
                photoURL:
                  url,
                passengerProfileImageUrl:
                  url,
                faceScanCompleted:
                  true,
                faceScanVerified:
                  true,
                faceScanVerifiedAt:
                  now,
                profilePhotoUpdatedAt:
                  now,
                profileImageStoragePath:
                  objectPath
              };

        await admin.database()
          .ref(
            `${rootName}/${userId}`
          )
          .update(
            patch
          );

        return response
          .status(200)
          .json({
            ok:
              true,
            url,
            fileUrl:
              url,
            storagePath:
              objectPath,
            profileRoot:
              rootName,
            profileId:
              userId
          });

      } catch (error) {
        console.error(
          "Profile image storage failed",
          {
            code:
              error?.code ||
              "unknown",
            message:
              error?.message ||
              String(error)
          }
        );

        return response
          .status(500)
          .json({
            error:
              "Unable to save the profile picture. Please try again."
          });
      }
    }
  );


// =================================================================
// --- PAYSTACK WALLET TOP-UPS ---
// =================================================================
// Paystack becomes the primary online wallet top-up provider. Card, South
// African EFT and Capitec Pay are handled on Paystack's hosted checkout.
// Wallet value is only credited after a signed webhook or a server-side
// Verify Transaction call confirms a successful ZAR payment.
const paystackSecretKey =
  defineSecret("PAYSTACK_SECRET_KEY");

const paystackCrypto =
  require("node:crypto");

const {
  amountToSubunit,
  applyWalletCredit,
  sanitizeReference,
  transactionMatchesPayment
} = require("./paystack-wallet");

const PAYSTACK_API =
  "https://api.paystack.co";

const PAYSTACK_CALLBACK_URL =
  "https://us-central1-asiye-80386.cloudfunctions.net/paystackPaymentReturn";

function paystackReference() {
  return (
    "ASIYE-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    paystackCrypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase()
  );
}

function paystackFallbackEmail(uid) {
  const digest =
    paystackCrypto
      .createHash("sha256")
      .update(String(uid || "wallet"))
      .digest("hex")
      .slice(0, 18);

  return (
    "wallet+" +
    digest +
    "@asiye.cloud"
  );
}

async function paystackRequest(
  path,
  {
    method = "GET",
    body
  } = {}
) {
  const secret =
    String(
      paystackSecretKey.value() ||
      ""
    ).trim();

  if (!secret) {
    throw new Error(
      "Paystack is not configured."
    );
  }

  const response =
    await fetch(
      PAYSTACK_API + path,
      {
        method,
        headers: {
          Authorization:
            "Bearer " + secret,
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body)
      }
    );

  const payload =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok ||
    payload.status === false
  ) {
    const error =
      new Error(
        payload.message ||
        "Paystack request failed."
      );

    error.status =
      response.status;

    throw error;
  }

  return payload;
}

async function verifyPaystackReference(
  reference
) {
  const safeReference =
    sanitizeReference(
      reference
    );

  const payload =
    await paystackRequest(
      "/transaction/verify/" +
      encodeURIComponent(
        safeReference
      )
    );

  return payload.data || null;
}

async function adminDatabaseAccessToken() {
  const credential =
    admin.app().options.credential;

  if (
    !credential ||
    typeof credential.getAccessToken !==
      "function"
  ) {
    throw new Error(
      "Firebase Admin credential is unavailable."
    );
  }

  const access =
    await credential
      .getAccessToken();

  if (!access?.access_token) {
    throw new Error(
      "Firebase Admin access token is unavailable."
    );
  }

  return access.access_token;
}

function firebaseDatabaseBaseUrl() {
  let configured = {};

  try {
    configured =
      JSON.parse(
        process.env.FIREBASE_CONFIG ||
        "{}"
      );
  } catch (_) {
    configured = {};
  }

  return String(
    configured.databaseURL ||
    "https://asiye-80386-default-rtdb.firebaseio.com"
  ).replace(/\/$/, "");
}

async function creditPaystackWallet(
  payment,
  transaction
) {
  if (
    !payment ||
    payment.provider !== "paystack"
  ) {
    throw new Error(
      "Paystack wallet payment was not found."
    );
  }

  if (
    payment.status ===
      "complete"
  ) {
    return {
      credited:
        false,
      balance:
        Number(
          payment.creditedBalance ||
          0
        )
    };
  }

  if (
    !transactionMatchesPayment(
      transaction,
      payment
    )
  ) {
    throw new Error(
      "Paystack transaction does not match the wallet top-up."
    );
  }

  const passengerId =
    String(
      payment.passengerId ||
      payment.uid ||
      ""
    ).trim();

  if (!passengerId) {
    throw new Error(
      "Wallet passenger identity is missing."
    );
  }

  const accessToken =
    await adminDatabaseAccessToken();

  const profileUrl =
    firebaseDatabaseBaseUrl() +
    "/commuters/" +
    encodeURIComponent(
      passengerId
    ) +
    ".json";

  let creditedBalance =
    null;

  let credited =
    false;

  for (
    let attempt = 0;
    attempt < 6;
    attempt += 1
  ) {
    const readResponse =
      await fetch(
        profileUrl,
        {
          method:
            "GET",
          headers: {
            Authorization:
              "Bearer " +
              accessToken,
            "X-Firebase-ETag":
              "true",
            "Cache-Control":
              "no-cache"
          }
        }
      );

    if (!readResponse.ok) {
      throw new Error(
        "Unable to load wallet profile."
      );
    }

    const profile =
      await readResponse.json();

    const etag =
      readResponse.headers.get(
        "etag"
      );

    if (
      !profile ||
      !etag
    ) {
      throw new Error(
        "Wallet profile is unavailable."
      );
    }

    const applied =
      applyWalletCredit(
        profile,
        payment,
        Date.now()
      );

    creditedBalance =
      applied.balance;

    if (!applied.credited) {
      credited =
        false;
      break;
    }

    const writeResponse =
      await fetch(
        profileUrl,
        {
          method:
            "PUT",
          headers: {
            Authorization:
              "Bearer " +
              accessToken,
            "Content-Type":
              "application/json",
            "If-Match":
              etag
          },
          body:
            JSON.stringify(
              applied.profile
            )
        }
      );

    if (
      writeResponse.status ===
      412
    ) {
      continue;
    }

    if (!writeResponse.ok) {
      throw new Error(
        "Unable to credit Asiye wallet."
      );
    }

    credited =
      true;
    break;
  }

  if (creditedBalance === null) {
    throw new Error(
      "Wallet credit could not be confirmed."
    );
  }

  await admin.database()
    .ref(
      "walletPayments/" +
      payment.reference
    )
    .update({
      status:
        "complete",
      provider:
        "paystack",
      channel:
        String(
          transaction.channel ||
          ""
        ),
      paystackTransactionId:
        String(
          transaction.id ||
          ""
        ),
      paidAt:
        transaction.paid_at ||
        transaction.paidAt ||
        admin.database
          .ServerValue
          .TIMESTAMP,
      creditedBalance,
      creditedAt:
        admin.database
          .ServerValue
          .TIMESTAMP
    });

  return {
    credited,
    balance:
      creditedBalance
  };
}

// =================================================================
// --- RIDE PAYMENT HOLDS: CASH / CARD / ASIYE WALLET ---
// =================================================================
// Go reserves non-cash payment immediately after booking.
// Club waits until the pool is full, then reserves each passenger's
// Wallet funds and requires each Card passenger to complete Paystack.
// Reserved funds remain held by Asiye until trip completion.

function normaliseRidePaymentMethod(value) {
  const method =
    String(value || "cash")
      .trim()
      .toLowerCase();

  return ["cash", "card", "wallet"].includes(method)
    ? method
    : "cash";
}

function activeClubPassenger(passenger) {
  return ![
    "cancelled",
    "cancelled_by_commuter",
    "cancelled_by_driver",
    "cancelled_by_admin",
    "rejected"
  ].includes(
    String(
      passenger?.status ||
      ""
    )
  );
}

async function tripPassengerContext(
  decoded,
  requestId
) {
  const passenger =
    await resolvePassengerForWallet(
      decoded
    );

  const passengerId =
    String(
      passenger?.id ||
      decoded.uid
    );

  const trip =
    (
      await admin.database()
        .ref(
          `requests/${requestId}`
        )
        .once(
          "value"
        )
    ).val();

  if (!trip) {
    const error =
      new Error(
        "Trip was not found."
      );

    error.code =
      "payment/trip-not-found";

    throw error;
  }

  let passengerEntry =
    null;

  if (
    trip.type ===
      "club"
  ) {
    passengerEntry =
      trip.passengers?.[
        passengerId
      ] ||
      null;

    if (!passengerEntry) {
      const error =
        new Error(
          "You are not part of this Club ride."
        );

      error.code =
        "payment/not-passenger";

      throw error;
    }
  } else if (
    String(
      trip.commuterId ||
      ""
    ) !== passengerId
  ) {
    const error =
      new Error(
        "You cannot pay for this trip."
      );

    error.code =
      "payment/not-passenger";

    throw error;
  }

  const amount =
    tripPassengerFare(
      trip,
      passengerEntry
    );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    const error =
      new Error(
        "Trip fare is unavailable."
      );

    error.code =
      "payment/invalid-fare";

    throw error;
  }

  const method =
    normaliseRidePaymentMethod(
      passengerEntry
        ?.paymentMethod ||
      trip.paymentMethod
    );

  return {
    decoded,
    trip,
    requestId,
    passenger,
    passengerId,
    passengerEntry,
    method,
    amount
  };
}

function tripPaymentPath(
  requestId,
  passengerId
) {
  return (
    "tripPayments/" +
    requestId +
    "/" +
    passengerId
  );
}

async function updateWalletProfileWithEtag(
  passengerId,
  mutate
) {
  const accessToken =
    await adminDatabaseAccessToken();

  const profileUrl =
    firebaseDatabaseBaseUrl() +
    "/commuters/" +
    encodeURIComponent(
      passengerId
    ) +
    ".json";

  for (
    let attempt = 0;
    attempt < 7;
    attempt += 1
  ) {
    const readResponse =
      await fetch(
        profileUrl,
        {
          method:
            "GET",
          headers: {
            Authorization:
              "Bearer " +
              accessToken,
            "X-Firebase-ETag":
              "true",
            "Cache-Control":
              "no-cache"
          }
        }
      );

    if (!readResponse.ok) {
      throw new Error(
        "Unable to load Asiye Wallet."
      );
    }

    const profile =
      await readResponse
        .json();

    const etag =
      readResponse.headers.get(
        "etag"
      );

    if (
      !profile ||
      !etag
    ) {
      throw new Error(
        "Passenger wallet profile is unavailable."
      );
    }

    const result =
      mutate(
        structuredClone(
          profile
        )
      );

    if (
      result &&
      result.write ===
        false
    ) {
      return result;
    }

    const nextProfile =
      result?.profile ||
      profile;

    const writeResponse =
      await fetch(
        profileUrl,
        {
          method:
            "PUT",
          headers: {
            Authorization:
              "Bearer " +
              accessToken,
            "Content-Type":
              "application/json",
            "If-Match":
              etag
          },
          body:
            JSON.stringify(
              nextProfile
            )
        }
      );

    if (
      writeResponse.status ===
        412
    ) {
      continue;
    }

    if (!writeResponse.ok) {
      throw new Error(
        "Unable to update Asiye Wallet."
      );
    }

    return result;
  }

  throw new Error(
    "Wallet changed while reserving payment. Please try again."
  );
}

async function holdWalletTripPayment(
  requestId,
  passengerId,
  amount
) {
  const safeAmount =
    Math.round(
      Number(amount) *
      100
    ) / 100;

  const result =
    await updateWalletProfileWithEtag(
      passengerId,
      profile => {
        const holds = {
          ...(
            profile
              .walletRideHolds ||
            {}
          )
        };

        const existing =
          holds[
            requestId
          ];

        const available =
          Number(
            profile.walletBalance ??
            profile.credits ??
            0
          );

        const safeAvailable =
          Number.isFinite(
            available
          )
            ? Math.round(
                available *
                100
              ) / 100
            : 0;

        if (
          existing &&
          [
            "held",
            "captured"
          ].includes(
            String(
              existing.status ||
              ""
            )
          )
        ) {
          return {
            write:
              false,
            balance:
              safeAvailable,
            hold:
              existing
          };
        }

        if (
          safeAvailable +
            0.00001 <
          safeAmount
        ) {
          const error =
            new Error(
              `Your Asiye Wallet has R${safeAvailable.toFixed(2)} but this ride requires R${safeAmount.toFixed(2)}.`
            );

          error.code =
            "payment/insufficient-wallet";

          throw error;
        }

        const nextBalance =
          Math.round(
            (
              safeAvailable -
              safeAmount
            ) *
            100
          ) / 100;

        holds[
          requestId
        ] = {
          amount:
            safeAmount,
          status:
            "held",
          heldAt:
            Date.now()
        };

        profile.walletRideHolds =
          holds;

        profile.walletBalance =
          nextBalance;

        profile.credits =
          nextBalance;

        profile.walletUpdatedAt =
          Date.now();

        return {
          profile,
          balance:
            nextBalance,
          hold:
            holds[
              requestId
            ]
        };
      }
    );

  const payment = {
    provider:
      "asiye_wallet",
    method:
      "wallet",
    requestId,
    passengerId,
    amount:
      safeAmount,
    currency:
      "ZAR",
    status:
      "held",
    heldAt:
      admin.database
        .ServerValue
        .TIMESTAMP
  };

  await admin.database()
    .ref(
      tripPaymentPath(
        requestId,
        passengerId
      )
    )
    .update(
      payment
    );

  return {
    ...payment,
    balance:
      Number(
        result.balance ||
        0
      )
  };
}

async function settleWalletTripPayment(
  requestId,
  passengerId
) {
  const result =
    await updateWalletProfileWithEtag(
      passengerId,
      profile => {
        const holds = {
          ...(
            profile
              .walletRideHolds ||
            {}
          )
        };

        const existing =
          holds[
            requestId
          ];

        if (!existing) {
          const error =
            new Error(
              "Wallet hold was not found."
            );

          error.code =
            "payment/hold-missing";

          throw error;
        }

        if (
          existing.status ===
            "captured"
        ) {
          return {
            write:
              false,
            hold:
              existing
          };
        }

        if (
          existing.status !==
            "held"
        ) {
          const error =
            new Error(
              "Wallet hold is not ready to settle."
            );

          error.code =
            "payment/hold-not-ready";

          throw error;
        }

        holds[
          requestId
        ] = {
          ...existing,
          status:
            "captured",
          capturedAt:
            Date.now()
        };

        profile.walletRideHolds =
          holds;

        return {
          profile,
          hold:
            holds[
              requestId
            ]
        };
      }
    );

  await admin.database()
    .ref(
      tripPaymentPath(
        requestId,
        passengerId
      )
    )
    .update({
      status:
        "captured",
      capturedAt:
        admin.database
          .ServerValue
          .TIMESTAMP
    });

  return result;
}

async function releaseWalletTripPayment(
  requestId,
  passengerId
) {
  const result =
    await updateWalletProfileWithEtag(
      passengerId,
      profile => {
        const holds = {
          ...(
            profile
              .walletRideHolds ||
            {}
          )
        };

        const existing =
          holds[
            requestId
          ];

        const available =
          Number(
            profile.walletBalance ??
            profile.credits ??
            0
          );

        const safeAvailable =
          Number.isFinite(
            available
          )
            ? Math.round(
                available *
                100
              ) / 100
            : 0;

        if (
          !existing ||
          existing.status ===
            "released"
        ) {
          return {
            write:
              false,
            balance:
              safeAvailable,
            hold:
              existing ||
              null
          };
        }

        if (
          existing.status ===
            "captured"
        ) {
          const error =
            new Error(
              "Completed wallet payment cannot be released automatically."
            );

          error.code =
            "payment/already-captured";

          throw error;
        }

        if (
          existing.status !==
            "held"
        ) {
          return {
            write:
              false,
            balance:
              safeAvailable,
            hold:
              existing
          };
        }

        const amount =
          Number(
            existing.amount ||
            0
          );

        const nextBalance =
          Math.round(
            (
              safeAvailable +
              amount
            ) *
            100
          ) / 100;

        holds[
          requestId
        ] = {
          ...existing,
          status:
            "released",
          releasedAt:
            Date.now()
        };

        profile.walletRideHolds =
          holds;

        profile.walletBalance =
          nextBalance;

        profile.credits =
          nextBalance;

        profile.walletUpdatedAt =
          Date.now();

        return {
          profile,
          balance:
            nextBalance,
          hold:
            holds[
              requestId
            ]
        };
      }
    );

  await admin.database()
    .ref(
      tripPaymentPath(
        requestId,
        passengerId
      )
    )
    .update({
      status:
        "released",
      releasedAt:
        admin.database
          .ServerValue
          .TIMESTAMP
    });

  return result;
}

async function markTripPassengerPayment(
  requestId,
  passengerId,
  trip,
  patch
) {
  if (
    trip.type ===
      "club"
  ) {
    await admin.database()
      .ref(
        `requests/${requestId}/passengers/${passengerId}`
      )
      .update(
        patch
      );
  } else {
    await admin.database()
      .ref(
        `requests/${requestId}`
      )
      .update(
        patch
      );
  }
}

async function refreshClubPaymentsReady(
  requestId
) {
  const requestRef =
    admin.database()
      .ref(
        `requests/${requestId}`
      );

  const trip =
    (
      await requestRef
        .once(
          "value"
        )
    ).val();

  if (
    !trip ||
    trip.type !==
      "club" ||
    trip.poolReady !==
      true
  ) {
    return {
      ready:
        false
    };
  }

  const active =
    Object.entries(
      trip.passengers ||
      {}
    )
      .filter(
        ([, passenger]) =>
          activeClubPassenger(
            passenger
          )
      );

  const pending =
    active.filter(
      ([, passenger]) => {
        const method =
          normaliseRidePaymentMethod(
            passenger
              ?.paymentMethod ||
            trip.paymentMethod
          );

        const status =
          String(
            passenger
              ?.paymentStatus ||
            ""
          );

        if (
          method ===
            "cash"
        ) {
          return false;
        }

        return ![
          "held",
          "captured"
        ].includes(
          status
        );
      }
    );

  const ready =
    pending.length ===
      0;

  await requestRef
    .update({
      paymentsReady:
        ready,
      paymentStatus:
        ready
          ? "held"
          : "payment_required",
      status:
        ready
          ? "pool_ready"
          : "payment_required"
    });

  return {
    ready,
    pendingPassengerIds:
      pending.map(
        ([id]) =>
          id
      )
  };
}

async function prepareClubPoolPayments(
  requestId,
  trip
) {
  const passengerPatches =
    {};

  for (
    const [
      passengerId,
      passenger
    ]
    of Object.entries(
      trip.passengers ||
      {}
    )
  ) {
    if (
      !activeClubPassenger(
        passenger
      )
    ) {
      continue;
    }

    const method =
      normaliseRidePaymentMethod(
        passenger
          ?.paymentMethod ||
        trip.paymentMethod
      );

    const amount =
      tripPassengerFare(
        trip,
        passenger
      );

    if (
      method ===
        "cash"
    ) {
      passengerPatches[
        `passengers/${passengerId}/paymentStatus`
      ] =
        "cash_due";

      passengerPatches[
        `passengers/${passengerId}/paymentHeldAmount`
      ] =
        0;

      await admin.database()
        .ref(
          tripPaymentPath(
            requestId,
            passengerId
          )
        )
        .update({
          method:
            "cash",
          provider:
            "cash",
          requestId,
          passengerId,
          amount,
          currency:
            "ZAR",
          status:
            "cash_due",
          updatedAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        });

      continue;
    }

    if (
      method ===
        "wallet"
    ) {
      try {
        await holdWalletTripPayment(
          requestId,
          passengerId,
          amount
        );

        passengerPatches[
          `passengers/${passengerId}/paymentStatus`
        ] =
          "held";

        passengerPatches[
          `passengers/${passengerId}/paymentHeldAmount`
        ] =
          amount;

      } catch (error) {
        if (
          error?.code ===
            "payment/insufficient-wallet"
        ) {
          passengerPatches[
            `passengers/${passengerId}/paymentStatus`
          ] =
            "wallet_insufficient";

          continue;
        }

        throw error;
      }

      continue;
    }

    const payment =
      (
        await admin.database()
          .ref(
            tripPaymentPath(
              requestId,
              passengerId
            )
          )
          .once(
            "value"
          )
      ).val();

    passengerPatches[
      `passengers/${passengerId}/paymentStatus`
    ] =
      [
        "held",
        "captured"
      ].includes(
        String(
          payment?.status ||
          ""
        )
      )
        ? "held"
        : "payment_required";
  }

  if (
    Object.keys(
      passengerPatches
    ).length
  ) {
    await admin.database()
      .ref(
        `requests/${requestId}`
      )
      .update(
        passengerPatches
      );
  }

  return refreshClubPaymentsReady(
    requestId
  );
}

async function initialiseCardTripPayment(
  context
) {
  const {
    decoded,
    requestId,
    passengerId,
    passenger,
    trip,
    amount
  } =
    context;

  const paymentRef =
    admin.database()
      .ref(
        tripPaymentPath(
          requestId,
          passengerId
        )
      );

  const current =
    (
      await paymentRef
        .once(
          "value"
        )
    ).val();

  if (
    current &&
    [
      "held",
      "captured"
    ].includes(
      String(
        current.status ||
        ""
      )
    )
  ) {
    return {
      ready:
        true,
      status:
        current.status,
      reference:
        current.reference ||
        ""
    };
  }

  if (
    current?.status ===
      "initialized" &&
    current.authorizationUrl &&
    current.reference
  ) {
    return {
      ready:
        false,
      status:
        "payment_required",
      reference:
        current.reference,
      authorizationUrl:
        current.authorizationUrl
    };
  }

  const profile =
    passenger?.data ||
    {};

  const email =
    String(
      profile.email ||
      decoded.email ||
      paystackFallbackEmail(
        decoded.uid
      )
    )
      .trim()
      .toLowerCase();

  const reference =
    paystackReference();

  const initialized =
    await paystackRequest(
      "/transaction/initialize",
      {
        method:
          "POST",
        body: {
          email,
          amount:
            String(
              Math.round(
                amount *
                100
              )
            ),
          currency:
            "ZAR",
          reference,
          callback_url:
            PAYSTACK_CALLBACK_URL,
          channels: [
            "card"
          ],
          metadata: {
            purpose:
              "asiye_trip_card",
            uid:
              decoded.uid,
            passengerId,
            requestId,
            rideType:
              trip.type ===
                "club"
                ? trip.clubMode ||
                  "club"
                : trip.rideType ||
                  "go"
          }
        }
      }
    );

  const data =
    initialized.data ||
    {};

  if (
    !data.authorization_url ||
    !data.reference
  ) {
    throw new Error(
      "Paystack did not return a card checkout link."
    );
  }

  await admin.database()
    .ref()
    .update({
      [
        tripPaymentPath(
          requestId,
          passengerId
        )
      ]:
        {
          method:
            "card",
          provider:
            "paystack",
          requestId,
          passengerId,
          uid:
            decoded.uid,
          amount,
          amountSubunit:
            Math.round(
              amount *
              100
            ),
          currency:
            "ZAR",
          reference,
          authorizationUrl:
            data.authorization_url,
          accessCode:
            data.access_code ||
            "",
          status:
            "initialized",
          createdAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        },
      [
        `tripPaymentReferences/${reference}`
      ]:
        {
          requestId,
          passengerId,
          createdAt:
            admin.database
              .ServerValue
              .TIMESTAMP
        }
    });

  await markTripPassengerPayment(
    requestId,
    passengerId,
    trip,
    {
      paymentStatus:
        "payment_required",
      paymentReference:
        reference
    }
  );

  if (
    trip.type !==
      "club"
  ) {
    await admin.database()
      .ref(
        `requests/${requestId}`
      )
      .update({
        status:
          "payment_required",
        paymentsReady:
          false
      });
  }

  return {
    ready:
      false,
    status:
      "payment_required",
    reference,
    authorizationUrl:
      data.authorization_url
  };
}

async function prepareTripPaymentServer(
  context
) {
  const {
    requestId,
    passengerId,
    trip,
    method,
    amount
  } =
    context;

  if (
    trip.type ===
      "club" &&
    trip.poolReady !==
      true
  ) {
    return {
      ready:
        false,
      waitingForPool:
        true,
      status:
        "waiting_pool"
    };
  }

  if (
    method ===
      "cash"
  ) {
    await admin.database()
      .ref(
        tripPaymentPath(
          requestId,
          passengerId
        )
      )
      .update({
        method:
          "cash",
        provider:
          "cash",
        requestId,
        passengerId,
        amount,
        currency:
          "ZAR",
        status:
          "cash_due",
        updatedAt:
          admin.database
            .ServerValue
            .TIMESTAMP
      });

    await markTripPassengerPayment(
      requestId,
      passengerId,
      trip,
      {
        paymentStatus:
          "cash_due",
        paymentHeldAmount:
          0
      }
    );

    return {
      ready:
        true,
      status:
        "cash_due"
    };
  }

  if (
    method ===
      "wallet"
  ) {
    const hold =
      await holdWalletTripPayment(
        requestId,
        passengerId,
        amount
      );

    await markTripPassengerPayment(
      requestId,
      passengerId,
      trip,
      {
        paymentStatus:
          "held",
        paymentHeldAmount:
          amount
      }
    );

    return {
      ready:
        true,
      status:
        "held",
      balance:
        hold.balance
    };
  }

  return initialiseCardTripPayment(
    context
  );
}

async function recordCardTripPaymentHeld(
  payment,
  transaction
) {
  if (
    !transactionMatchesPayment(
      transaction,
      payment
    )
  ) {
    throw new Error(
      "Card transaction does not match the trip fare."
    );
  }

  const requestId =
    String(
      payment.requestId ||
      ""
    );

  const passengerId =
    String(
      payment.passengerId ||
      ""
    );

  const trip =
    (
      await admin.database()
        .ref(
          `requests/${requestId}`
        )
        .once(
          "value"
        )
    ).val();

  if (!trip) {
    throw new Error(
      "Trip was not found."
    );
  }

  await admin.database()
    .ref(
      tripPaymentPath(
        requestId,
        passengerId
      )
    )
    .update({
      status:
        "held",
      heldAt:
        admin.database
          .ServerValue
          .TIMESTAMP,
      paystackTransactionId:
        String(
          transaction.id ||
          ""
        ),
      channel:
        String(
          transaction.channel ||
          "card"
        ),
      paidAt:
        transaction.paid_at ||
        transaction.paidAt ||
        admin.database
          .ServerValue
          .TIMESTAMP
    });

  await markTripPassengerPayment(
    requestId,
    passengerId,
    trip,
    {
      paymentStatus:
        "held",
      paymentHeldAmount:
        Number(
          payment.amount ||
          0
        )
    }
  );

  if (
    trip.type ===
      "club"
  ) {
    await refreshClubPaymentsReady(
      requestId
    );
  } else {
    await admin.database()
      .ref(
        `requests/${requestId}`
      )
      .update({
        paymentStatus:
          "held",
        paymentsReady:
          true,
        status:
          trip.safetyShareCompleted
            ? "pending"
            : trip.status
      });
  }

  return {
    requestId,
    passengerId,
    status:
      "held"
  };
}

exports.prepareTripPayment =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const decoded =
          await verifiedRequestUser(
            request
          );

        if (!decoded) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before paying for this ride."
            });
        }

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(
            requestId
          )
        ) {
          return response
            .status(400)
            .json({
              error:
                "Trip reference is invalid."
            });
        }

        const context =
          await tripPassengerContext(
            decoded,
            requestId
          );

        const result =
          await prepareTripPaymentServer(
            context
          );

        return response
          .status(200)
          .json({
            ok:
              true,
            requestId,
            passengerId:
              context.passengerId,
            method:
              context.method,
            amount:
              context.amount,
            ...result
          });

      } catch (error) {
        const status =
          error?.code ===
            "payment/insufficient-wallet"
            ? 409
            : error?.code ===
                "payment/not-passenger"
              ? 403
              : error?.code ===
                  "payment/trip-not-found"
                ? 404
                : 500;

        console.error(
          "Prepare trip payment failed",
          {
            code:
              error?.code ||
              "unknown",
            message:
              error?.message ||
              String(error)
          }
        );

        return response
          .status(status)
          .json({
            error:
              error?.message ||
              "Unable to prepare ride payment."
          });
      }
    }
  );

exports.verifyTripCardPayment =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const decoded =
          await verifiedRequestUser(
            request
          );

        if (!decoded) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before checking this card payment."
            });
        }

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        const reference =
          sanitizeReference(
            request.body?.reference
          );

        const context =
          await tripPassengerContext(
            decoded,
            requestId
          );

        const paymentRef =
          admin.database()
            .ref(
              tripPaymentPath(
                requestId,
                context.passengerId
              )
            );

        const payment =
          (
            await paymentRef
              .once(
                "value"
              )
          ).val();

        if (
          !payment ||
          payment.method !==
            "card" ||
          payment.reference !==
            reference
        ) {
          return response
            .status(404)
            .json({
              error:
                "Card payment was not found."
            });
        }

        if (
          [
            "held",
            "captured"
          ].includes(
            String(
              payment.status ||
              ""
            )
          )
        ) {
          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                payment.status,
              requestId,
              passengerId:
                context.passengerId,
              ready:
                true
            });
        }

        const transaction =
          await verifyPaystackReference(
            reference
          );

        if (
          !transaction ||
          transaction.status !==
            "success"
        ) {
          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                String(
                  transaction?.status ||
                  "pending"
                ),
              requestId,
              ready:
                false
            });
        }

        await recordCardTripPaymentHeld(
          payment,
          transaction
        );

        return response
          .status(200)
          .json({
            ok:
              true,
            status:
              "held",
            requestId,
            passengerId:
              context.passengerId,
            ready:
              true
          });

      } catch (error) {
        console.error(
          "Verify trip card payment failed",
          error
        );

        return response
          .status(500)
          .json({
            error:
              error?.message ||
              "Unable to verify card payment."
          });
      }
    }
  );

exports.settleTripPayment =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public"
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const decoded =
          await verifiedRequestUser(
            request
          );

        if (!decoded) {
          return response
            .status(401)
            .json({
              error:
                "Driver authentication is required."
            });
        }

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        const trip =
          (
            await admin.database()
              .ref(
                `requests/${requestId}`
              )
              .once(
                "value"
              )
          ).val();

        if (!trip) {
          return response
            .status(404)
            .json({
              error:
                "Trip was not found."
            });
        }

        if (
          !await driverOwnsTrip(
            decoded.uid,
            trip
          )
        ) {
          return response
            .status(403)
            .json({
              error:
                "Only the assigned driver can settle this trip."
            });
        }

        const passengers =
          trip.type ===
            "club"
            ? Object.entries(
                trip.passengers ||
                {}
              )
                .filter(
                  ([, passenger]) =>
                    activeClubPassenger(
                      passenger
                    )
                )
                .map(
                  ([
                    passengerId,
                    passenger
                  ]) => ({
                    passengerId,
                    passenger
                  })
                )
            : [
                {
                  passengerId:
                    trip.commuterId,
                  passenger:
                    null
                }
              ];

        const results =
          [];

        for (
          const item
          of passengers
        ) {
          const method =
            normaliseRidePaymentMethod(
              item.passenger
                ?.paymentMethod ||
              trip.paymentMethod
            );

          const paymentRef =
            admin.database()
              .ref(
                tripPaymentPath(
                  requestId,
                  item.passengerId
                )
              );

          const payment =
            (
              await paymentRef
                .once(
                  "value"
                )
            ).val();

          if (
            method ===
              "cash"
          ) {
            results.push({
              passengerId:
                item.passengerId,
              method,
              status:
                "cash_due"
            });

            continue;
          }

          if (
            !payment ||
            ![
              "held",
              "captured"
            ].includes(
              String(
                payment.status ||
                ""
              )
            )
          ) {
            return response
              .status(409)
              .json({
                error:
                  "A non-cash passenger payment is not held yet.",
                passengerId:
                  item.passengerId,
                method
              });
          }

          if (
            payment.status ===
              "held"
          ) {
            if (
              method ===
                "wallet"
            ) {
              await settleWalletTripPayment(
                requestId,
                item.passengerId
              );

            } else {
              await paymentRef
                .update({
                  status:
                    "captured",
                  capturedAt:
                    admin.database
                      .ServerValue
                      .TIMESTAMP
                });
            }

            await markTripPassengerPayment(
              requestId,
              item.passengerId,
              trip,
              {
                paymentStatus:
                  "captured",
                paymentCapturedAt:
                  admin.database
                    .ServerValue
                    .TIMESTAMP
              }
            );
          }

          results.push({
            passengerId:
              item.passengerId,
            method,
            status:
              "captured"
          });
        }

        await admin.database()
          .ref(
            `requests/${requestId}`
          )
          .update({
            paymentSettlementStatus:
              "settled",
            paymentSettledAt:
              admin.database
                .ServerValue
                .TIMESTAMP
          });

        return response
          .status(200)
          .json({
            ok:
              true,
            settled:
              true,
            payments:
              results
          });

      } catch (error) {
        console.error(
          "Trip payment settlement failed",
          error
        );

        return response
          .status(500)
          .json({
            error:
              error?.message ||
              "Unable to settle ride payment."
          });
      }
    }
  );

exports.releaseTripPayment =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const decoded =
          await verifiedRequestUser(
            request
          );

        if (!decoded) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before cancelling this payment."
            });
        }

        const requestId =
          String(
            request.body?.requestId ||
            ""
          ).trim();

        const context =
          await tripPassengerContext(
            decoded,
            requestId
          );

        const paymentRef =
          admin.database()
            .ref(
              tripPaymentPath(
                requestId,
                context.passengerId
              )
            );

        const payment =
          (
            await paymentRef
              .once(
                "value"
              )
          ).val();

        if (!payment) {
          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                "nothing_to_release"
            });
        }

        if (
          payment.method ===
            "wallet"
        ) {
          const released =
            await releaseWalletTripPayment(
              requestId,
              context.passengerId
            );

          await markTripPassengerPayment(
            requestId,
            context.passengerId,
            context.trip,
            {
              paymentStatus:
                "released"
            }
          );

          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                "released",
              balance:
                Number(
                  released.balance ||
                  0
                )
            });
        }

        if (
          payment.method ===
            "card" &&
          payment.status ===
            "held"
        ) {
          const refund =
            await paystackRequest(
              "/refund",
              {
                method:
                  "POST",
                body: {
                  transaction:
                    payment.paystackTransactionId ||
                    payment.reference,
                  amount:
                    Math.round(
                      Number(
                        payment.amount ||
                        0
                      ) *
                      100
                    ),
                  currency:
                    "ZAR",
                  customer_note:
                    "Asiye ride cancelled before completion",
                  merchant_note:
                    `Asiye trip ${requestId} cancelled`
                }
              }
            );

          await paymentRef
            .update({
              status:
                "refund_pending",
              refundId:
                String(
                  refund.data?.id ||
                  ""
                ),
              refundStatus:
                String(
                  refund.data?.status ||
                  "pending"
                ),
              refundRequestedAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            });

          await markTripPassengerPayment(
            requestId,
            context.passengerId,
            context.trip,
            {
              paymentStatus:
                "refund_pending"
            }
          );

          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                "refund_pending"
            });
        }

        await paymentRef
          .update({
            status:
              payment.status ===
                "captured"
                ? "captured"
                : "released",
            releasedAt:
              admin.database
                .ServerValue
                .TIMESTAMP
          });

        return response
          .status(200)
          .json({
            ok:
              true,
            status:
              payment.status ===
                "captured"
                ? "captured"
                : "released"
          });

      } catch (error) {
        console.error(
          "Trip payment release failed",
          error
        );

        return response
          .status(500)
          .json({
            error:
              error?.message ||
              "Unable to release ride payment."
          });
      }
    }
  );


exports.paystackPaymentReturn =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public"
    },
    async (
      request,
      response
    ) => {
      const reference =
        String(
          request.query?.reference ||
          request.query?.trxref ||
          ""
        )
          .replace(
            /[^A-Za-z0-9.=\-]/g,
            ""
          )
          .slice(
            0,
            100
          );

      response
        .status(200)
        .set(
          "Content-Type",
          "text/html; charset=utf-8"
        )
        .set(
          "Cache-Control",
          "no-store"
        )
        .send(
          `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asiye Payment</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fb;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:#111}
main{max-width:520px;background:#fff;border-radius:24px;padding:30px;box-shadow:0 18px 60px rgba(0,0,0,.1);text-align:center}
strong{display:block;font-size:26px;margin-bottom:12px}
p{color:#596170;line-height:1.55}
.ref{background:#f2f4f7;border-radius:14px;padding:12px;margin:18px 0;word-break:break-all;font-family:ui-monospace,monospace}
</style>
</head>
<body>
<main>
<strong>Payment submitted</strong>
<p>Your payment has been submitted. Asiye is returning you to the app and will verify the payment before updating your wallet.</p>
<div class="ref">${reference ? "Reference: " + reference : "Payment reference received"}</div>
<p><a id="backToAsiye" href="asiye://payment-complete?reference=${encodeURIComponent(reference)}" style="display:inline-block;padding:14px 18px;border-radius:14px;background:#111;color:#fff;text-decoration:none;font-weight:700">Return to Asiye</a></p>
<script>
(function(){
  var reference = ${JSON.stringify(reference)};
  var target = "asiye://payment-complete?reference=" + encodeURIComponent(reference || "");
  setTimeout(function(){
    try { window.location.replace(target); } catch (_) {}
  }, 500);
})();
</script>
</main>
</body>
</html>`
        );
    }
  );

exports.initializePaystackWalletTopup =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) ||
            ""
          ).match(
            /^Bearer (.+)$/
          );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before adding funds."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const amountSubunit =
          amountToSubunit(
            request.body?.amount
          );

        const amount =
          amountSubunit /
          100;

        const passenger =
          await resolvePassengerForWallet(
            decoded
          );

        if (!passenger) {
          return response
            .status(404)
            .json({
              error:
                "Passenger profile was not found."
            });
        }

        const passengerId =
          String(
            passenger.id ||
            decoded.uid
          );

        const email =
          String(
            passenger.data?.email ||
            decoded.email ||
            paystackFallbackEmail(
              decoded.uid
            )
          )
            .trim()
            .toLowerCase();

        const reference =
          paystackReference();

        const initialize =
          await paystackRequest(
            "/transaction/initialize",
            {
              method:
                "POST",
              body: {
                email,
                amount:
                  String(
                    amountSubunit
                  ),
                currency:
                  "ZAR",
                reference,
                callback_url:
                  PAYSTACK_CALLBACK_URL,
                channels: [
                  "card",
                  "eft",
                  "capitec_pay"
                ],
                metadata: {
                  purpose:
                    "asiye_wallet_topup",
                  uid:
                    decoded.uid,
                  passengerId
                }
              }
            }
          );

        const data =
          initialize.data ||
          {};

        if (
          !data.authorization_url ||
          !data.reference
        ) {
          throw new Error(
            "Paystack did not return a checkout link."
          );
        }

        await admin.database()
          .ref(
            "walletPayments/" +
            reference
          )
          .set({
            uid:
              decoded.uid,
            passengerId,
            email,
            amount,
            amountSubunit,
            currency:
              "ZAR",
            reference,
            provider:
              "paystack",
            status:
              "initialized",
            authorizationUrl:
              data.authorization_url,
            accessCode:
              data.access_code ||
              "",
            createdAt:
              admin.database
                .ServerValue
                .TIMESTAMP
          });

        return response
          .status(200)
          .json({
            ok:
              true,
            provider:
              "paystack",
            amount,
            currency:
              "ZAR",
            reference,
            authorizationUrl:
              data.authorization_url
          });

      } catch (error) {
        console.error(
          "Paystack wallet initialization failed",
          {
            message:
              error?.message ||
              String(error),
            status:
              error?.status
          }
        );

        return response
          .status(
            error?.code ===
              "payment/invalid-amount"
              ? 400
              : 502
          )
          .json({
            error:
              error?.message ||
              "Unable to start Paystack payment."
          });
      }
    }
  );

exports.verifyPaystackWalletTopup =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      walletSmsCors(
        request,
        response
      );

      if (
        request.method ===
        "OPTIONS"
      ) {
        return response
          .status(204)
          .send("");
      }

      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .json({
            error:
              "POST required."
          });
      }

      try {
        const match =
          (
            request.get(
              "authorization"
            ) ||
            ""
          ).match(
            /^Bearer (.+)$/
          );

        if (!match) {
          return response
            .status(401)
            .json({
              error:
                "Sign in again before checking payment."
            });
        }

        const decoded =
          await admin.auth()
            .verifyIdToken(
              match[1]
            );

        const reference =
          sanitizeReference(
            request.body?.reference
          );

        const paymentRef =
          admin.database()
            .ref(
              "walletPayments/" +
              reference
            );

        const payment =
          (
            await paymentRef
              .once("value")
          ).val();

        if (
          !payment ||
          payment.provider !==
            "paystack"
        ) {
          return response
            .status(404)
            .json({
              error:
                "Payment was not found."
            });
        }

        if (
          payment.uid !==
          decoded.uid
        ) {
          return response
            .status(403)
            .json({
              error:
                "You cannot check this payment."
            });
        }

        if (
          payment.status ===
          "complete"
        ) {
          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                "complete",
              balance:
                Number(
                  payment.creditedBalance ||
                  0
                ),
              reference
            });
        }

        const transaction =
          await verifyPaystackReference(
            reference
          );

        if (
          !transaction ||
          transaction.status !==
            "success"
        ) {
          await paymentRef
            .update({
              status:
                String(
                  transaction?.status ||
                  "pending"
                ),
              lastVerifiedAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            });

          return response
            .status(200)
            .json({
              ok:
                true,
              status:
                String(
                  transaction?.status ||
                  "pending"
                ),
              reference
            });
        }

        const credit =
          await creditPaystackWallet(
            payment,
            transaction
          );

        return response
          .status(200)
          .json({
            ok:
              true,
            status:
              "complete",
            balance:
              credit.balance,
            reference
          });

      } catch (error) {
        console.error(
          "Paystack wallet verification failed",
          error
        );

        return response
          .status(
            error?.code ===
              "payment/invalid-reference"
              ? 400
              : 502
          )
          .json({
            error:
              error?.message ||
              "Unable to verify Paystack payment."
          });
      }
    }
  );

exports.paystackWebhook =
  onRequest(
    {
      region:
        "us-central1",
      invoker:
        "public",
      secrets: [
        paystackSecretKey
      ]
    },
    async (
      request,
      response
    ) => {
      if (
        request.method !==
        "POST"
      ) {
        return response
          .status(405)
          .send("POST required");
      }

      try {
        const secret =
          String(
            paystackSecretKey.value() ||
            ""
          );

        const raw =
          Buffer.isBuffer(
            request.rawBody
          )
            ? request.rawBody
            : Buffer.from(
                JSON.stringify(
                  request.body ||
                  {}
                )
              );

        const expected =
          paystackCrypto
            .createHmac(
              "sha512",
              secret
            )
            .update(raw)
            .digest("hex");

        const supplied =
          String(
            request.get(
              "x-paystack-signature"
            ) ||
            ""
          );

        const valid =
          supplied.length ===
            expected.length &&
          paystackCrypto
            .timingSafeEqual(
              Buffer.from(
                supplied,
                "utf8"
              ),
              Buffer.from(
                expected,
                "utf8"
              )
            );

        if (!valid) {
          return response
            .status(401)
            .send("Invalid signature");
        }

        const event =
          request.body ||
          {};

        if (
          event.event !==
          "charge.success"
        ) {
          return response
            .status(200)
            .send("ok");
        }

        const eventTransaction =
          event.data ||
          {};

        const reference =
          sanitizeReference(
            eventTransaction.reference
          );

        const paymentRef =
          admin.database()
            .ref(
              "walletPayments/" +
              reference
            );

        const payment =
          (
            await paymentRef
              .once("value")
          ).val();

        if (
          !payment ||
          payment.provider !==
            "paystack"
        ) {
          // A valid Paystack event may belong to another future payment
          // product. Acknowledge it without changing any wallet balance.
          return response
            .status(200)
            .send("ok");
        }

        /*
         * Never deliver wallet value from the webhook payload alone.
         * Re-verify the transaction directly with Paystack so amount,
         * currency, reference and final success state are all confirmed
         * server-to-server before crediting the wallet.
         */
        const verifiedTransaction =
          await verifyPaystackReference(
            reference
          );

        await creditPaystackWallet(
          payment,
          verifiedTransaction
        );

        return response
          .status(200)
          .send("ok");

      } catch (error) {
        console.error(
          "Paystack webhook processing failed",
          error
        );

        return response
          .status(500)
          .send("retry");
      }
    }
  );


// =================================================================
// --- SECURE ASIYE CLUB JOIN ---
// =================================================================
// Client users may request to join a Club pool, but all pool-wide mutations
// (capacity, pricing, ready state, passenger count) are performed here with
// the Admin SDK so a passenger cannot rewrite another passenger or trip state.
const { applyClubJoin } = require("./club-pool-security");

exports.joinClubPoolSecure = onRequest(
  {
    region: "us-central1"
  },
  async (request, response) => {
    walletSmsCors(request, response);

    if (request.method === "OPTIONS") {
      return response.status(204).send("");
    }

    if (request.method !== "POST") {
      return response.status(405).json({ error: "POST required." });
    }

    try {
      const match = (request.get("authorization") || "").match(/^Bearer (.+)$/);
      if (!match) {
        return response.status(401).json({
          error: "Sign in again before joining this Club ride."
        });
      }

      const decoded = await admin.auth().verifyIdToken(match[1]);
      const poolId = String(request.body?.poolId || "").trim();

      if (!/^[A-Za-z0-9_-]{1,128}$/.test(poolId)) {
        return response.status(400).json({ error: "Invalid Club pool." });
      }

      const passenger = await resolvePassengerForWallet(decoded);
      const passengerId = String(passenger?.id || decoded.uid);
      const profile = passenger?.data || {};
      const pin = String(request.body?.pickupPin || "").trim();

      if (!/^\d{4}$/.test(pin)) {
        return response.status(400).json({
          error: "A valid 4-digit trip PIN is required."
        });
      }

      const details = {
        name:
          profile.name ||
          profile.firstName ||
          decoded.name ||
          "Passenger",
        phone:
          profile.phone ||
          profile.phoneNumber ||
          decoded.phone_number ||
          "",
        profileImageUrl:
          profile.profile_picture_url ||
          profile.profileImageUrl ||
          profile.photoURL ||
          "",
        pickupPin: pin,
        pickupAddress: request.body?.pickupAddress,
        pickupLat: request.body?.pickupLat,
        pickupLng: request.body?.pickupLng,
        destination: request.body?.destination,
        destinationLat: request.body?.destinationLat,
        destinationLng: request.body?.destinationLng,
        departureTime: request.body?.departureTime,
        paymentMethod: request.body?.paymentMethod
      };

      /*
       * Use an RTDB ETag conditional write instead of the Admin SDK
       * transaction helper here. In Cloud Functions the Admin transaction
       * callback can begin with a local null cache value even when this pool
       * already exists, which caused valid Club joins to abort as
       * "Club pool was not found."
       *
       * ETag + If-Match keeps the join atomic without ever treating an empty
       * local cache as the authoritative server state. If another passenger
       * joins at the same time, the 412 response causes us to reload and
       * recompute capacity/pricing before retrying.
       */
      const firebaseConfig =
        (() => {
          try {
            return JSON.parse(
              process.env.FIREBASE_CONFIG ||
              "{}"
            );
          } catch (_) {
            return {};
          }
        })();

      const databaseURL =
        String(
          firebaseConfig.databaseURL ||
          "https://asiye-80386-default-rtdb.firebaseio.com"
        )
        .replace(/\\\/$/, "");

      const credential =
        admin.app().options.credential;

      if (
        !credential ||
        typeof credential.getAccessToken !==
          "function"
      ) {
        throw new Error(
          "Firebase Admin credential is unavailable."
        );
      }

      const access =
        await credential.getAccessToken();

      const accessToken =
        access?.access_token;

      if (!accessToken) {
        throw new Error(
          "Firebase Admin access token is unavailable."
        );
      }

      const poolUrl =
        `${databaseURL}/requests/${encodeURIComponent(poolId)}.json`;

      let saved = null;
      let joinError = null;

      for (
        let attempt = 0;
        attempt < 5;
        attempt += 1
      ) {
        const readResponse =
          await fetch(
            poolUrl,
            {
              method:
                "GET",
              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
                "X-Firebase-ETag":
                  "true",
                "Cache-Control":
                  "no-cache"
              }
            }
          );

        if (!readResponse.ok) {
          throw new Error(
            `Unable to load Club pool (${readResponse.status}).`
          );
        }

        const current =
          await readResponse.json();

        const etag =
          readResponse.headers.get(
            "etag"
          );

        if (
          !current ||
          current.type !== "club"
        ) {
          joinError =
            new Error(
              "Club pool was not found."
            );
          joinError.code =
            "club/not-found";
          break;
        }

        let next;

        try {
          next =
            applyClubJoin(
              current,
              passengerId,
              details,
              Date.now()
            ).pool;
        } catch (error) {
          joinError =
            error;
          break;
        }

        if (!etag) {
          throw new Error(
            "Club pool version token is unavailable."
          );
        }

        const writeResponse =
          await fetch(
            poolUrl,
            {
              method:
                "PUT",
              headers: {
                Authorization:
                  `Bearer ${accessToken}`,
                "Content-Type":
                  "application/json",
                "If-Match":
                  etag
              },
              body:
                JSON.stringify(
                  next
                )
            }
          );

        if (
          writeResponse.status ===
          412
        ) {
          continue;
        }

        if (!writeResponse.ok) {
          throw new Error(
            `Unable to save Club join (${writeResponse.status}).`
          );
        }

        saved =
          await writeResponse.json();

        break;
      }

      if (!saved) {
        const status =
          joinError?.code ===
            "club/full"
            ? 409
            : joinError?.code ===
                "club/not-found"
              ? 404
              : 409;

        return response.status(status).json({
          error:
            joinError?.message ||
            "The Club ride changed while you were joining. Please try again."
        });
      }

      await admin.database()
        .ref(`commuters/${passengerId}`)
        .update({
          currentRequest: poolId
        });

      const shareToken =
        validTripShareToken(
          request.body?.shareToken
        );

      if (shareToken) {
        const tokenRef =
          admin.database()
            .ref(
              `tripShareTokens/${shareToken}`
            );

        const tokenSnapshot =
          await tokenRef
            .once("value");

        const share =
          tokenSnapshot.val();

        if (
          share &&
          share.requestId === poolId &&
          share.issuedToUid === decoded.uid &&
          String(
            share.passengerId ||
            ""
          ) === passengerId
        ) {
          await tokenRef.update({
            active:
              true,
            activatedAt:
              admin.database
                .ServerValue
                .TIMESTAMP
          });
        }
      }

      return response.status(200).json({
        ok: true,
        poolId,
        passengerId,
        passengerCount: Number(saved.passengerCount || 0),
        status: saved.status || "pooling"
      });
    } catch (error) {
      console.error("Secure Club join failed", {
        code: error?.code || "unknown",
        message: error?.message || String(error)
      });

      return response.status(401).json({
        error: "Unable to verify or join this Club ride."
      });
    }
  }
);


// =================================================================
// --- SECURE FAMILY LIVE TRIP SHARING ---
// =================================================================
// New app builds use a high-entropy capability token. Existing released
// builds that already shared a Firebase request ID remain compatible through
// a time-limited legacy capability path. The public tracking page never reads
// protected Realtime Database nodes directly.
const crypto = require("node:crypto");
const {
  canIssueTripShare,
  isJoinableClubRequest,
  isTripShareParticipant,
  legacyShareAllowed,
  sanitizeRequest,
  sanitizeTaxi
} = require("./trip-share-security");

const TRIP_SHARE_TTL_MS =
  72 * 60 * 60 * 1000;

function publicTripShareCors(request, response) {
  response.set(
    "Access-Control-Allow-Origin",
    "*"
  );
  response.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  response.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  response.set(
    "Cache-Control",
    "no-store, max-age=0"
  );
}

async function verifiedRequestUser(request) {
  const match =
    (
      request.get("authorization") ||
      ""
    ).match(/^Bearer (.+)$/);

  if (!match) {
    return null;
  }

  return admin.auth()
    .verifyIdToken(match[1]);
}

function validRequestId(value) {
  const id =
    String(value || "")
      .trim();

  return /^[A-Za-z0-9_-]{16,128}$/.test(id)
    ? id
    : "";
}

function validTripShareToken(value) {
  const token =
    String(value || "")
      .trim();

  return /^[A-Za-z0-9_-]{32,96}$/.test(token)
    ? token
    : "";
}

exports.createTripShareToken = onRequest(
  {
    region: "us-central1"
  },
  async (request, response) => {
    walletSmsCors(
      request,
      response
    );

    if (request.method === "OPTIONS") {
      return response
        .status(204)
        .send("");
    }

    if (request.method !== "POST") {
      return response
        .status(405)
        .json({
          error:
            "POST required."
        });
    }

    try {
      const decoded =
        await verifiedRequestUser(
          request
        );

      if (!decoded) {
        return response
          .status(401)
          .json({
            error:
              "Sign in again before sharing this trip."
          });
      }

      const requestId =
        validRequestId(
          request.body?.requestId
        );

      if (!requestId) {
        return response
          .status(400)
          .json({
            error:
              "Invalid trip."
          });
      }

      const requestSnapshot =
        await admin.database()
          .ref(
            `requests/${requestId}`
          )
          .once("value");

      const trip =
        requestSnapshot.val();

      if (!trip) {
        return response
          .status(404)
          .json({
            error:
              "Trip was not found."
          });
      }

      const passenger =
        await resolvePassengerForWallet(
          decoded
        );

      const passengerId =
        String(
          passenger?.id ||
          decoded.uid
        );

      const participant =
        isTripShareParticipant(
          trip,
          passengerId,
          decoded.uid
        );

      const prospectiveClubJoin =
        !participant &&
        isJoinableClubRequest(
          trip
        );

      if (
        !canIssueTripShare(
          trip,
          passengerId,
          decoded.uid
        )
      ) {
        return response
          .status(403)
          .json({
            error:
              "This account cannot share that trip."
          });
      }

      const issuerRef =
        admin.database()
          .ref(
            `tripShareIssuers/${requestId}/${decoded.uid}`
          );

      const issuerSnapshot =
        await issuerRef
          .once("value");

      const previous =
        issuerSnapshot.val() ||
        {};

      const now =
        Date.now();

      const reusableToken =
        validTripShareToken(
          previous.token
        );

      if (
        reusableToken &&
        Number(
          previous.expiresAt ||
          0
        ) >
          now +
          5 * 60 * 1000
      ) {
        return response
          .status(200)
          .json({
            ok:
              true,
            requestId,
            shareToken:
              reusableToken,
            expiresAt:
              Number(
                previous.expiresAt
              ),
            liveTrackingUrl:
              `https://asiye-80386.web.app/track.html?share=${encodeURIComponent(reusableToken)}`
          });
      }

      const shareToken =
        crypto
          .randomBytes(32)
          .toString("base64url");

      const expiresAt =
        now +
        TRIP_SHARE_TTL_MS;

      const tokenRef =
        admin.database()
          .ref(
            `tripShareTokens/${shareToken}`
          );

      await admin.database()
        .ref()
        .update({
          [`tripShareTokens/${shareToken}`]:
            {
              requestId,
              issuedToUid:
                decoded.uid,
              passengerId,
              createdAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP,
              expiresAt,
              revoked:
                false,
              active:
                participant,
              requiresJoin:
                prospectiveClubJoin
            },
          [`tripShareIssuers/${requestId}/${decoded.uid}`]:
            {
              token:
                shareToken,
              expiresAt,
              updatedAt:
                admin.database
                  .ServerValue
                  .TIMESTAMP
            }
        });

      return response
        .status(200)
        .json({
          ok:
            true,
          requestId,
          shareToken,
          expiresAt,
          liveTrackingUrl:
            `https://asiye-80386.web.app/track.html?share=${encodeURIComponent(shareToken)}`
        });

    } catch (error) {
      console.error(
        "Create trip share token failed",
        {
          code:
            error?.code ||
            "unknown",
          message:
            error?.message ||
            String(error)
        }
      );

      return response
        .status(401)
        .json({
          error:
            "Unable to create the live tracking link."
        });
    }
  }
);

exports.getTripShare = onRequest(
  {
    region: "us-central1"
  },
  async (request, response) => {
    publicTripShareCors(
      request,
      response
    );

    if (request.method === "OPTIONS") {
      return response
        .status(204)
        .send("");
    }

    if (request.method !== "GET") {
      return response
        .status(405)
        .json({
          error:
            "GET required."
        });
    }

    try {
      const shareToken =
        validTripShareToken(
          request.query?.share
        );

      const legacyTripId =
        validRequestId(
          request.query?.trip ||
          request.query?.id ||
          request.query?.requestId
        );

      let requestId =
        "";

      let expiresAt =
        null;

      let legacy =
        false;

      if (shareToken) {
        const tokenSnapshot =
          await admin.database()
            .ref(
              `tripShareTokens/${shareToken}`
            )
            .once("value");

        const token =
          tokenSnapshot.val();

        if (
          !token ||
          token.revoked === true ||
          Number(
            token.expiresAt ||
            0
          ) <= Date.now()
        ) {
          return response
            .status(410)
            .json({
              error:
                "This live tracking link has expired."
            });
        }

        if (token.active === false) {
          return response
            .status(409)
            .json({
              error:
                "Waiting for the passenger to join this Club ride."
            });
        }

        requestId =
          validRequestId(
            token.requestId
          );

        expiresAt =
          Number(
            token.expiresAt
          ) ||
          null;

      } else if (legacyTripId) {
        requestId =
          legacyTripId;

        legacy =
          true;

      } else {
        return response
          .status(400)
          .json({
            error:
              "Invalid live tracking link."
          });
      }

      const tripSnapshot =
        await admin.database()
          .ref(
            `requests/${requestId}`
          )
          .once("value");

      const trip =
        tripSnapshot.val();

      if (!trip) {
        return response
          .status(404)
          .json({
            error:
              "Trip was not found."
          });
      }

      if (
        legacy &&
        !legacyShareAllowed(
          trip,
          requestId
        )
      ) {
        return response
          .status(410)
          .json({
            error:
              "This older live tracking link is no longer available. Ask the passenger to share a new link."
          });
      }

      const taxiId =
        String(
          trip.taxiId ||
          ""
        );

      let taxi =
        null;

      if (taxiId) {
        taxi =
          (
            await admin.database()
              .ref(
                `taxis/${taxiId}`
              )
              .once("value")
          ).val();
      }

      return response
        .status(200)
        .json({
          ok:
            true,
          legacy,
          expiresAt,
          updatedAt:
            Date.now(),
          trip:
            sanitizeRequest(
              trip,
              requestId
            ),
          taxi:
            sanitizeTaxi(
              taxi,
              trip
            )
        });

    } catch (error) {
      console.error(
        "Get trip share failed",
        {
          message:
            error?.message ||
            String(error)
        }
      );

      return response
        .status(500)
        .json({
          error:
            "Live tracking is temporarily unavailable."
        });
    }
  }
);
