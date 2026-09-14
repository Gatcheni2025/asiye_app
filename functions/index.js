const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const merchantId = defineSecret("PAYFAST_MERCHANT_ID");
const merchantKey = defineSecret("PAYFAST_MERCHANT_KEY");
const passphrase = defineSecret("PAYFAST_PASSPHRASE");
const processUrl = "https://sandbox.payfast.co.za/eng/process";
const siteUrl = "https://asiye.cloud";
const notifyUrl =
  "https://us-central1-asiye-80386.cloudfunctions.net/payfastWalletNotify";

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

exports.createPayfastWalletTopup = onRequest(
  {region: "us-central1", secrets: [merchantId, merchantKey, passphrase]},
  async (request, response) => {
    cors(request, response);
    if (request.method === "OPTIONS") return response.status(204).send("");
    if (request.method !== "POST") return response.status(405).json({error: "POST required."});
    try {
      const match = (request.get("authorization") || "").match(/^Bearer (.+)$/);
      if (!match) return response.status(401).json({error: "Sign in again."});
      const decoded = await admin.auth().verifyIdToken(match[1]);
      const amount = Number(request.body?.amount);
      if (!Number.isFinite(amount) || amount < 10 || amount > 5000) {
        return response.status(400).json({error: "Amount must be between R10 and R5,000."});
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
      return response.json({action: processUrl, fields});
    } catch (error) {
      console.error("Create wallet top-up failed", error);
      return response.status(500).json({error: "Unable to start the payment."});
    }
  });

exports.payfastWalletNotify = onRequest(
  {region: "us-central1", secrets: [merchantId, merchantKey, passphrase]},
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
        {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: validationBody});
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
