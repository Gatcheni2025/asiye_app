"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("staging deploy only includes reviewed Cash/Card endpoints, not discontinued wallet topups", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve("scripts/paystack_function_manifest.json"), "utf8"));
  const functions = fs.readFileSync(path.resolve("functions/index.js"), "utf8");
  assert.ok(Array.isArray(manifest));
  assert.equal(new Set(manifest).size, manifest.length, "duplicate function deployment target");
  for (const name of manifest) {
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/, "invalid function name");
    assert.ok(functions.includes("exports." + name + " ="), "missing function export: " + name);
  }
  for (const legacy of ["createEftSmsTopup", "initializePaystackWalletTopup", "verifyPaystackWalletTopup"]) {
    assert.ok(!manifest.includes(legacy), "discontinued prepaid wallet endpoint must not be deployed: " + legacy);
  }
  for (const required of ["configureDriverCardPayout", "prepareTripPayment", "verifyTripCardPayment", "paystackWebhook", "paystackPaymentReturn", "releaseTripPayment", "goTripActionSecure", "joinClubPoolSecure", "parcelTripActionSecure"]) {
    assert.ok(manifest.includes(required), "missing mandatory Cash/Card or secure trip endpoint: " + required);
  }
});
