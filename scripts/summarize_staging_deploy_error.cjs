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
// Only report identifiers from an explicit, non-sensitive secret-name allowlist.
const knownMissingSecrets = new Set();
const crossProjectLookups = new Set();
const deniedServiceUsageRequests = new Set();
const safeGoogleServices = new Set([
  "cloudbilling.googleapis.com", "cloudfunctions.googleapis.com",
  "cloudbuild.googleapis.com", "artifactregistry.googleapis.com",
  "run.googleapis.com", "eventarc.googleapis.com", "pubsub.googleapis.com",
  "firebaseextensions.googleapis.com", "runtimeconfig.googleapis.com",
  "cloudscheduler.googleapis.com", "storage.googleapis.com",
  "secretmanager.googleapis.com", "serviceusage.googleapis.com",
  "iam.googleapis.com", "compute.googleapis.com",
  "cloudresourcemanager.googleapis.com", "firebasedatabase.googleapis.com"
]);
function serviceUsageTarget(pathname) {
  // Firebase CLI may GET service metadata or POST to an API-enable RPC.
  // Print only the allowlisted service name and project class.
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (_) { return null; }
  const match = decoded.match(/^\/v1(?:beta1)?\/projects\/([^/]+)\/services(?:(?:\/([a-z0-9.-]+\.googleapis\.com))?(?::(enable|disable|batchEnable|batchGet))?)?$/i);
  if (!match) return null;
  const service = (match[2] || "").toLowerCase();
  return {
    project: projectLabel(match[1]),
    service: safeGoogleServices.has(service) ? service : service ? "OTHER_API (redacted)" : "unspecified",
    operation: match[3] || (match[2] ? "getService" : "listServices")
  };
}

function projectLabel(raw) {
  if (raw === "asiye-paystack-staging" || raw === "1000800408896") return "staging";
  if (raw === "asiye-80386") return "PRODUCTION";
  return "OTHER (redacted)";
}
// Cloud Resource Manager appends RPC operation suffixes after the project ID,
// e.g. /v1/projects/{id}:getIamPolicy. Never mistake those for a different
// project. Keep only an allowlisted operation label in the output.
function resourceManagerProject(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (_) { return null; }
  const match = decoded.match(/^\/v1\/projects\/([^/:]+)(?::([^/]+))?$/);
  if (!match) return null;
  const knownMethods = new Map([
    ["testIamPermissions", "testIamPermissions"],
    ["getIamPolicy", "getIamPolicy"],
    ["setIamPolicy", "setIamPolicy"],
    ["getAncestry", "getAncestry"]
  ]);
  return {
    project: projectLabel(match[1]),
    operation: match[2] ? (knownMethods.get(match[2]) || "OTHER_RPC (redacted)") : "getProject"
  };
}
function redactApiPath(host, pathname) {
  // Only known literal endpoint families are displayed; never raw resource IDs,
  // query parameters, tokens, paths or response bodies.
  if (host === "serviceusage.googleapis.com") {
    const target = serviceUsageTarget(pathname);
    if (target) return "Service Usage " + target.operation + " " + target.service + " (" + target.project + ")";
  }
  if (host === "cloudresourcemanager.googleapis.com") {
    const target = resourceManagerProject(pathname);
    if (target) {
      return target.operation === "getProject" ? "project metadata" :
        target.operation === "testIamPermissions" ? "project IAM permission probe" :
        target.operation === "getIamPolicy" ? "project IAM policy read" :
        target.operation === "setIamPolicy" ? "project IAM policy write" :
        target.operation === "getAncestry" ? "project ancestry read" :
        "project RPC (redacted)";
    }
  }
  if (host === "compute.googleapis.com") {
    if (/^\/compute\/v1\/projects\/[^/]+$/.test(pathname)) return "compute project metadata";
    if (/^\/compute\/v1\/projects\/[^/]+\//.test(pathname)) return "compute resource metadata";
  }
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
    if (host === "cloudresourcemanager.googleapis.com" && code === "403") {
      // Distinguish staging/production from a suffix-style Resource Manager
      // operation. No raw project identifiers or unrecognized RPC names.
      const target = resourceManagerProject(uri.pathname);
      if (target) crossProjectLookups.add(m[0].split(" ")[0] + " " + target.project + " " + target.operation);
    }
    if (host === "serviceusage.googleapis.com" && code === "403") {
      const target = serviceUsageTarget(uri.pathname);
      if (target) deniedServiceUsageRequests.add(m[0].split(" ")[0] + " " +
        target.project + " " + target.operation + " " + target.service);
    }
    if (host === "secretmanager.googleapis.com" && code === "404") {
      const secretName = uri.pathname.match(/\/secrets\/(PAYSTACK_SECRET_KEY|TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_FROM_NUMBER)(?:\/|$)/i);
      if (secretName) knownMissingSecrets.add(secretName[1].toUpperCase());
    }
    httpFailures.add(host + " " + redactApiPath(host, uri.pathname) + " -> HTTP " + code);
  } catch (_) { /* Keep diagnostics fail-closed */ }
}
for (const line of lines) {
  for (const m of line.matchAll(/\b(?:HTTP RESPONSE|HTTP Error|status(?:Code)?[:=]?)\s*[:=]?\s*([45]\d{2})\b/gi)) {
    codes.add(m[1]);
  }
  // Read service identifiers only, not URLs, JSON error bodies or paths.
  if (!/serviceusage\.googleapis\.com/i.test(line)) continue;
  const match = line.match(/\/services\/([a-z0-9.-]+\.googleapis\.com)(?:\b|\/)/i);
  if (match && safeGoogleServices.has(match[1].toLowerCase())) services.add(match[1].toLowerCase());
}
console.error("HTTP failures: " + (codes.size ? [...codes].join(", ") : "Firebase CLI did not expose a status"));
console.error("Failing API endpoints: " + ([...httpFailures].slice(-10).join("; ") || "not exposed"));
console.error("Google services checked: " + ([...services].join(", ") || "not exposed"));
if (crossProjectLookups.size) console.error("Denied Resource Manager lookup targets (redacted): " + [...crossProjectLookups].join(", "));
if (deniedServiceUsageRequests.size) console.error("Denied Service Usage operations (sanitized): " + [...deniedServiceUsageRequests].join(", "));
if (knownMissingSecrets.size) console.error("Known missing secret IDs (names only): " + [...knownMissingSecrets].join(", "));
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
// Recognize only fixed, non-sensitive error categories. Do not reproduce
// arbitrary Firebase CLI text, which may contain URLs, tokens, or user data.
// Search the final diagnostic section preferentially to avoid false positives
// from CLI command echoes.
const terminal = lines.slice(-180).join("\\n");
const terminalPatterns = [
  [/Must enable required APIs to deploy/i, "Firebase refused missing required API(s)"],
  [/not on the Blaze|must be on the Blaze|billing account.*(?:disabled|missing)/i, "Firebase billing-plan requirement"],
  [/Failed to load function definition|Functions codebase could not be analyzed/i, "Cloud Functions code discovery failed"],
  [/Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i, "Cloud Functions runtime dependency missing"],
  [/Cannot determine Firebase Database URL|Can't determine Firebase Database URL/i, "Firebase Database runtime URL missing"],
  [/Failed to parse.*(?:environment|config)|Invalid value.*environment/i, "Functions environment configuration invalid"],
  [/Failed to grant IAM roles|failed to modify the IAM policy/i, "Project IAM role bootstrap failed"],
  [/Missing required permission|permission denied to enable service/i, "Insufficient staging deployer permissions"],
  [/Failed to create .*\bfunction|Failed to update .*\bfunction/i, "Cloud Functions resource create or update failed"],
  [/Cloud Functions deployment.*failed|Error deploying functions/i, "Cloud Functions deployment failed after preparation"],
  [/Error:.*(?:timeout|ECONNRESET|ETIMEDOUT)/i, "Firebase CLI network timeout"],
];
const categories = [...new Set(terminalPatterns.filter(([pattern]) => pattern.test(terminal)).map(([,label]) => label))];
console.error("Firebase terminal error category: " + (categories.length ? categories.slice(0,3).join("; ") : "unclassified; inspect the restricted debug log privately"));
console.error("Raw Firebase debug output is withheld and discarded after this step.");
