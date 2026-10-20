"use strict";
// A credential-safe Firebase CLI --debug summarizer. Raw CLI logs may
// contain bearer tokens, user data, service-account fields or secrets.
// Never print a raw line, query parameter, HTTP body or credential.
const fs = require("node:fs");
const file = process.argv[2];
const step = process.argv[3] || "staging deployment";
if (!file || !fs.existsSync(file)) {
  console.error("Firebase " + step + " failed; no diagnostic log is available.");
  process.exit(0);
}
const raw = fs.readFileSync(file, "utf8");
const lines = raw.split(/\r?\n/);
console.error("Firebase " + step + " failed. Sanitized diagnostics only.");
const httpFailures = new Set();
const codes = new Set();
const services = new Set();
function redactApiPath(pathname) {
  // Restrict output to allowlisted *service names*, never arbitrary paths.
  const match = pathname.match(/\/services\/([a-z0-9.-]+\.googleapis\.com)(?:\/|$)/i);
  if (match) return "service=" + match[1].toLowerCase();
  const known = ["/serviceAccounts/", "/functions", "/locations", "/projects/"];
  if (known.some(part => pathname.includes(part))) return "resource metadata";
  return "API request";
}
for (const line of lines) {
  // Firebase CLI emits: <<< [apiv2][status] GET https://api... 403
  // Match status lines only. Any query string (which can include credentials)
  // is parsed and discarded, never printed.
  if (!/\[status\]|HTTP RESPONSE/i.test(line)) continue;
  const m = line.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+(https:\/\/\S+)\s+([45]\d{2})\b/i);
  if (!m) continue;
  try {
    const uri = new URL(m[1]);
    const host = uri.hostname.toLowerCase();
    if (!host.endsWith(".googleapis.com")) continue;
    const code = m[2];
    codes.add(code);
    httpFailures.add(host + " " + redactApiPath(uri.pathname) + " -> HTTP " + code);
  } catch (_) { /* Keep diagnostics fail-closed */ }
}
for (const line of lines) {
  for (const m of line.matchAll(/\b(?:HTTP RESPONSE|HTTP Error|status(?:Code)?[:=]?)\s*[:=]?\s*([45]\d{2})\b/gi)) {
    codes.add(m[1]);
  }
  // Read service identifiers only, not URLs, JSON error bodies or paths.
  if (!/serviceusage\.googleapis\.com/i.test(line)) continue;
  const match = line.match(/\/services\/([a-z0-9.-]+\.googleapis\.com)(?:\b|\/)/i);
  if (match) services.add(match[1].toLowerCase());
}
console.error("HTTP failures: " + (codes.size ? [...codes].join(", ") : "Firebase CLI did not expose a status"));
console.error("Failing API endpoints: " + ([...httpFailures].slice(-10).join("; ") || "not exposed"));
console.error("Google services checked: " + ([...services].join(", ") || "not exposed"));
const hints = [
  [/\bPERMISSION_DENIED\b|permission denied|not authorized|does not have permission/i,
   "An IAM permission error was present; inspect staging-only Cloud Functions Developer and runtime service-account access."],
  [/ECONNRESET|ETIMEDOUT|ENOTFOUND|network.*timeout/i,
   "An intermittent network error was observed."],
  [/Syntax error in database rules|rules.*invalid|Expected ['"]rules['"] property/i,
   "A database rules validation error was observed; do not bypass security tests."],
  [/API .*not enabled|API .*disabled|SERVICE_DISABLED|has not been used in project/i,
   "A Google Cloud API appears disabled; check Cloud Functions, Cloud Build, Artifact Registry, Cloud Run."],
];
let hintsFound = 0;
for (const [pattern, hint] of hints) if (pattern.test(raw)) {
  console.error("Diagnostic: " + hint);
  hintsFound++;
}
if (codes.has("404")) console.error("Diagnostic: HTTP 404 could mean a missing service, API, or runtime identity. Inspect the *failing* endpoint above before changing IAM.");
if (!hintsFound && !codes.size) console.error("The Firebase CLI returned an unclassified error.");
console.error("Raw Firebase debug output is withheld and discarded after this step.");
