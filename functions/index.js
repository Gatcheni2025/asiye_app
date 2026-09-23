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
      "https://app.asiye.cloud"
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

      let rawPhone =
        request.body?.phone ||
        passenger?.data?.phone ||
        passenger?.data?.phoneNumber ||
        decoded.phone_number ||
        "";

      if (rawPhone.startsWith("0")) {
        rawPhone = "+27" + rawPhone.substring(1);
      }

      const smsTo =
        normaliseSmsPhone(
          rawPhone
        );

      let reference =
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

      // If user provided a valid new phone, save it to profile
      if (smsTo && request.body?.phone && !passenger?.data?.phone && !passenger?.data?.phoneNumber) {
        await commuterRef.update({
          phone: smsTo
        });
      }

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
            smsTo ? smsTo.replace(
              /(\+27\d{2})\d+(\d{2})$/,
              "$1•••••$2"
            ) : undefined,
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
      (request.clubMode === "club7" ? 5 : 3)
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
      passengerCount < requiredSeats
    ) {
      console.warn(
        `Work pool ${requestId} became ready before ${requiredSeats} passengers were recorded.`
      );

      return null;
    }

    /*
     * Canonical Work fare at dispatch time.
     * This also repairs a legacy pool that was split by 4/7 instead
     * of the current 3/5 paying-passenger capacity.
     */
    const poolTotal =
      Number(
        request.totalPoolFare ||
        0
      );

    if (
      Number.isFinite(poolTotal) &&
      poolTotal > 0
    ) {
      const canonicalPassengerFare =
        Math.round(
          (
            poolTotal /
            requiredSeats
          ) *
          100
        ) / 100;

      const pricingUpdates = {
        pricePerPassenger:
          canonicalPassengerFare,
        agreedFare:
          canonicalPassengerFare,
        pricingVersion:
          2
      };

      Object.keys(
        request.passengers ||
        {}
      ).forEach(
        passengerId => {
          pricingUpdates[
            `passengers/${passengerId}/price`
          ] =
            canonicalPassengerFare;
        }
      );

      await change.after.ref
        .parent
        .update(
          pricingUpdates
        );

      request.pricePerPassenger =
        canonicalPassengerFare;

      request.agreedFare =
        canonicalPassengerFare;
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

    const documentReview =
      data?.documentReview || {};

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

    const requiredDocuments =
      [
        "selfie",
        "car",
        "identity",
        "licence"
      ];

    const completeDocumentReview =
      requiredDocuments.every(
        key =>
          typeof enrollment.documents?.[key] === "string" &&
          enrollment.documents[key].trim() &&
          documentReview[key] === "approved"
      );

    if (!completeDocumentReview) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Open and approve each required driver document before activating this driver."
      );
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
      `driverEnrollments/${uid}/documentReview`
    ] = {
      selfie: "approved",
      car: "approved",
      identity: "approved",
      licence: "approved",
      reviewedAt: now,
      reviewedBy: actor.uid
    };

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
