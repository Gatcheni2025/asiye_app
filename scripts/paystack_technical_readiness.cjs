'use strict';

// Read-only provider / Firebase inventory. This script never changes a secret,
// booking, balance, deployed function, rule, payment or launch approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const admin = require('../functions/node_modules/firebase-admin');
const root = path.join(__dirname, '..');
const requiredFunctions = require('./paystack_function_manifest.json');
const report = {source: process.env.GITHUB_SHA || 'local-uncommitted',
  checkedAt: new Date().toISOString(), readOnly: true, liveProcessingEnabledByThisCheck: false,
  blockers: []};
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

async function firebaseInventory(credentials, projectId) {
  const parsed = JSON.parse(credentials);
  if (parsed.project_id !== projectId) throw Error('Credential project does not match the requested inventory project.');
  const credential = admin.credential.cert(parsed);
  const {access_token: token} = await credential.getAccessToken();
  const get = async url => {
    const response = await fetch(url, {headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Error('Read-only Firebase inventory HTTP ' + response.status);
    return response.json();
  };
  const functions = [];
  let next = '';
  do {
    const query = new URLSearchParams({pageSize: '1000', fields: 'functions(name,state,updateTime),nextPageToken'});
    if (next) query.set('pageToken', next);
    const page = await get(`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/us-central1/functions?${query}`);
    functions.push(...(page.functions || [])); next = page.nextPageToken || '';
  } while (next);
  const active = new Set(functions.filter(f => f.state === 'ACTIVE').map(f => f.name.split('/').pop()));
  const output = {projectId, activeFunctionCount: active.size,
    missingOrInactiveFunctions: requiredFunctions.filter(name => !active.has(name)), sourceRevisionVerified: false};
  try {
    const deployed = await get(`https://${projectId}-default-rtdb.firebaseio.com/.settings/rules.json`);
    const local = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
    output.deployedRulesSha256 = digest(deployed);
    output.reviewRulesSha256 = digest(local);
    output.rulesMatchReviewedSource = output.deployedRulesSha256 === output.reviewRulesSha256;
  } catch (_) {
    output.rulesReadable = false;
  }
  return output;
}

async function main() {
  const key = String(process.env.PAYSTACK_TEST_SECRET_KEY || '').trim();
  const subaccount = String(process.env.PAYSTACK_TEST_DRIVER_SUBACCOUNT || '').trim();
  report.paystack = {testKeyConfigured: /^sk_test_[A-Za-z0-9]+$/.test(key),
    testSubaccountConfigured: /^ACCT_[A-Za-z0-9]+$/.test(subaccount), providerCheckPassed: false,
    actualCardJourneyVerified: false, bankSettlementVerified: false};
  if (!report.paystack.testKeyConfigured) report.blockers.push('Configure GitHub Actions secret PAYSTACK_TEST_SECRET_KEY with a TEST key.');
  if (!report.paystack.testSubaccountConfigured) report.blockers.push('Configure repository variable PAYSTACK_TEST_DRIVER_SUBACCOUNT with the assigned TEST subaccount.');
  if (report.paystack.testKeyConfigured && report.paystack.testSubaccountConfigured) {
    const checked = spawnSync(process.execPath, [path.join(__dirname, 'paystack_test_mode_preflight.cjs'), 'check'],
      {env: process.env, stdio: 'inherit', timeout: 45000});
    report.paystack.providerCheckPassed = checked.status === 0;
    if (!report.paystack.providerCheckPassed) report.blockers.push('Paystack TEST subaccount verification did not pass.');
  }
  if (process.env.FIREBASE_CREDS) {
    try {
      report.production = await firebaseInventory(process.env.FIREBASE_CREDS, 'asiye-80386');
      if (report.production.missingOrInactiveFunctions.length) report.blockers.push('Production does not have all reviewed secure endpoints active.');
      if (!report.production.rulesMatchReviewedSource) report.blockers.push('Production database rules do not match this reviewed source, or could not be inspected.');
    } catch (error) {
      report.production = {inventoryVerified: false};
      report.blockers.push(error.message.startsWith('Read-only Firebase') ? error.message : 'Firebase deployment credentials could not verify production inventory.');
    }
  } else report.blockers.push('Firebase deployment credentials are not configured in GitHub Actions.');
  report.staging = {projectConfigured: !!process.env.FIREBASE_STAGING_PROJECT,
    credentialsConfigured: !!process.env.FIREBASE_STAGING_CREDS};
  if (!report.staging.projectConfigured || !report.staging.credentialsConfigured) {
    report.blockers.push('Configure an isolated FIREBASE_STAGING_PROJECT variable and FIREBASE_STAGING_SERVICE_ACCOUNT secret before staging deployment/device tests.');
  } else if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.FIREBASE_STAGING_PROJECT) ||
      process.env.FIREBASE_STAGING_PROJECT === 'asiye-80386') {
    report.blockers.push('Staging must be a valid project separate from production asiye-80386.');
  } else {
    try { report.staging.inventory = await firebaseInventory(process.env.FIREBASE_STAGING_CREDS, process.env.FIREBASE_STAGING_PROJECT); }
    catch (_) { report.blockers.push('Staging inventory could not be verified.'); }
  }
  report.manualAcceptanceRequired = [
    'Real Paystack TEST checkout, authenticated webhook, refund and device acceptance evidence.',
    'Written merchant activation approval and legacy Wallet reconciliation before enabling live Card processing.'
  ];
}

main().catch(() => report.blockers.push('Technical readiness check could not finish.')).finally(() => {
  const output = path.join(root, 'paystack-readiness');
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'technical-readiness.json'), JSON.stringify(report, null, 2) + '\n');
  const summary = 'Paystack technical readiness — read-only\n' +
    report.blockers.map(item => '- BLOCKED: ' + item).join('\n') + '\n' +
    (report.manualAcceptanceRequired || []).map(item => '- Acceptance still required: ' + item).join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (report.blockers.length) process.exitCode = 1;
});
