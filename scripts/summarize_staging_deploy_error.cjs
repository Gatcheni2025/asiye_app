"use strict";
// Extract ONLY status/endpoint/category from Firebase --debug output.
// Firebase verbose logs can contain authentication data: never print the log,
// request/response bodies, bearer tokens, query parameters or stack traces.
const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[2];
const step = process.argv[3] || "staging deployment";
if (!file || !fs.existsSync(file)) {
  console.error("Firebase " + step + " failed. No diagnostic log available.");
  process.exit(0);
}
const raw = fs.readFileSync(file, "utf8");
const lines = raw.split(/\r?\n/);
console.error("Firebase " + step + " failed. Sanitized diagnostics follow; raw debug output is NOT uploaded or printed.");
const codes = new Set();
const endpoints = new Set();
for (const line of lines) {
  // Only extract bare HTTP status codes, not whole response bodies.
  for (const m of line.matchAll(/\b(?:HTTP RESPONSE|HTTP Error|status(?:Code)?[:=]?)\s*[:=]?\s*([45]\d{2})\b/gi)) codes.add(m[1]);
  if (!/(?:HTTP RESPONSE|HTTP REQUEST|https?:\/\/)/i.test(line)) continue;
  for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+)(\/[a-zA-Z0-9/_%.-]*)?/gi)) {
    const hostname = m[1].toLowerCase();
    if (!hostname.endsWith(".googleapis.com") && !hostname.endsWith(".firebaseio.com") && !hostname.endsWith(".firebasedatabase.app")) continue;
    const pathname = m[2] || "/";
    // An allowlisted endpoint path helps identify the failing API, without query params.
    endpoints.add(hostname + pathname.slice(0, 130));
  }
}
console.error("HTTP failures: " + (codes.size ? [...codes].join(", ") : "CLI did not expose a status"));
console.error("Google endpoints contacted: " + ([...endpoints].slice(-8).join(", ") || "not exposed"));
const hints = [
  [/PERMISSION_DENIED|permission denied|not authorized|does not have permission/i, "A permission-denied message was observed. Check staging-only IAM permissions, especially Firebase Realtime Database for rules, Cloud Functions Developer for functions."],
  [/ECONNRESET|ETIMEDOUT|ENOTFOUND|network.*timeout/i, "A network/transient failure was observed. Retry only after verifying the API response."],
  [/Syntax error in database rules|rules.*invalid|Expected ['"]rules['"] property/i, "A database rules syntax/validation error was observed. Do not bypass the rule tests."],
  [/API .*not enabled|API .*disabled|SERVICE_DISABLED|has not been used in project/i, "A required Google Cloud service API is not enabled for staging."],
];
let found = 0;
for (const [pattern, message] of hints) {
  if (pattern.test(raw)) {console.error("Diagnostic: " + message); found++;}
}
if (!found) console.error("No recognized error class. Investigate staging IAM/API access; Firebase CLI only returned a generic error.");
console.error("Raw CLI debug is withheld because it may contain credential material.");
