'use strict';

// Read-only release preparation. No deployment, secret change, launch write,
// payment initialization, webhook delivery, refund or customer collection scan.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {hash, FILES, manifest} = require('./audit_347_staging_readonly.cjs');
const {renderPaymentReturn} = require('../functions/paystack-return');
const {keyDomain} = require('../functions/paystack-payment-safety');
const {isVerifiedSubaccount} = require('../functions/paystack-subaccount-split');

const ROOT = path.resolve(__dirname, '..');
const PROJECT = 'asiye-80386', NUMBER = '531902350858', REGION = 'us-central1';
const DATABASE = 'https://asiye-80386-default-rtdb.firebaseio.com';
const CALLBACK = 'https://us-central1-asiye-80386.cloudfunctions.net/paystackPaymentReturn';
const WEBHOOK = 'https://us-central1-asiye-80386.cloudfunctions.net/paystackWebhook';
const PRODUCTION_FILES = Object.freeze(FILES.filter(file => !file.startsWith('admin/testing.')));
const SECRET_FUNCTIONS = Object.freeze([
  'configureDriverCardPayout', 'prepareTripPayment', 'verifyTripCardPayment',
  'paystackWebhook', 'releaseTripPayment', 'releaseCancelledGoTripPayment',
  'releaseCancelledClubPassengerPayment', 'disburseCompletedCardTrips'
]);
function productionFunctions() {
  // The staging test console is never a production promotion target.
  return manifest().filter(name => name !== 'adminStagingTestConsole');
}
function command(program, args) {
  const result = spawnSync(program, args, {cwd: ROOT, encoding: 'utf8',
    timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  if (result.status !== 0 || result.error) throw Error('LOCAL_READ_UNAVAILABLE');
  return result.stdout.trim();
}
function parseArgs(args) {
  const mode = args[0] || '--check';
  if (!['--check', '--public-only'].includes(mode)) throw Error('ARGUMENT_INVALID');
  const driver = args[1]?.startsWith('--driver=') ? args[1].slice(9) : null;
  if (args.length > 2 || (args.length === 2 && (!driver || !/^[A-Za-z0-9_-]{1,160}$/.test(driver))) ||
      (mode === '--public-only' && driver)) throw Error('ARGUMENT_INVALID');
  return {mode, driver};
}
async function responseText(http, url, headers = {}) {
  let response;
  try {
    response = await http(url, {method: 'GET', headers, redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(20000)});
  } catch (_) { throw Error('REMOTE_READ_UNAVAILABLE'); }
  if (!response.ok) throw Error('READ_HTTP_' + response.status);
  const value = await response.text();
  if (value.length > 4 * 1024 * 1024) throw Error('READ_SIZE_LIMIT');
  return value;
}
async function publicChecks({http = fetch, readFile = file => fs.readFileSync(file, 'utf8')} = {}) {
  const result = {hostingMatches: 0, hostingExpected: PRODUCTION_FILES.length, hostingFailures: [], callbackMatches: false};
  // Bounded parallel GETs; print file paths and result categories only.
  for (let offset = 0; offset < PRODUCTION_FILES.length; offset += 6) {
    await Promise.all(PRODUCTION_FILES.slice(offset, offset + 6).map(async relative => {
      try {
        const expected = readFile(path.join(ROOT, 'assets', relative));
        const remote = await responseText(http, 'https://' + PROJECT + '.web.app/' + relative);
        if (hash(remote) !== hash(expected)) throw Error('CONTENT_MISMATCH');
        result.hostingMatches++;
      } catch (error) {
        const reason = /^(CONTENT_MISMATCH|READ_HTTP_\d{3})$/.test(error.message) ? error.message : 'READ_UNAVAILABLE';
        result.hostingFailures.push({file: relative, reason});
      }
    }));
  }
  result.hostingFailures.sort((a, b) => a.file.localeCompare(b.file));
  try {
    result.callbackMatches = await responseText(http, CALLBACK) === renderPaymentReturn(PROJECT, undefined);
  } catch (_) { /* Remains false: an HTML error page is not a callback match. */ }
  return result;
}
function bindingOf(item) {
  const bindings = item?.serviceConfig?.secretEnvironmentVariables || item?.secretEnvironmentVariables || [];
  const matching = bindings.filter(binding => binding.key === 'PAYSTACK_SECRET_KEY');
  if (matching.length !== 1) return null;
  const binding = matching[0];
  if (binding.secret !== 'PAYSTACK_SECRET_KEY' || ![PROJECT, NUMBER].includes(String(binding.projectId)) ||
      !/^[1-9][0-9]*$/.test(String(binding.version))) return null;
  return String(binding.version);
}
function driverCheck(driver, saved, provider, driverId) {
  const owner = driver?.authUid || driver?.userUid || driverId;
  return !!driver && driver.verificationStatus === 'verified' &&
    (driver.vehicleApproved === true || driver.vehicleApprovalStatus === 'approved') &&
    saved?.ownerUid === owner && saved.status === 'verified' &&
    saved.platformCommissionPercent === 20 && provider?.domain === 'live' &&
    provider.currency === 'ZAR' && isVerifiedSubaccount(provider, saved.subaccountCode) &&
    /^[0-9]{4}$/.test(String(saved.accountLast4 || '')) &&
    typeof provider.account_number === 'string' && provider.account_number.slice(-4) === saved.accountLast4;
}
async function cloudChecks({run = command, http = fetch, readFile = file => fs.readFileSync(file, 'utf8'), driver = null} = {}) {
  if (run('gcloud', ['config', 'get-value', 'project']) !== PROJECT ||
      run('gcloud', ['projects', 'describe', PROJECT, '--format=value(projectNumber)']) !== NUMBER)
    throw Error('PRODUCTION_PROJECT_IDENTITY_MISMATCH');
  const source = run('git', ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(source)) throw Error('REVIEW_SOURCE_UNAVAILABLE');
  // Ensure comparisons describe the checkout revision, including this helper.
  if (run('git', ['diff', '--name-only', 'HEAD', '--', 'functions', 'scripts', 'assets', 'database.rules.json']))
    throw Error('REVIEW_SOURCE_HAS_TRACKED_CHANGES');
  const token = run('gcloud', ['auth', 'print-access-token']);
  if (!token) throw Error('LOCAL_READ_UNAVAILABLE');
  const headers = {Authorization: 'Bearer ' + token};
  const get = async url => JSON.parse(await responseText(http, url, headers));
  const report = {source, activeExpected: 0, expectedFunctions: productionFunctions().length,
    missingOrInactiveFunctions: [], rulesMatch: false, secretBindingsLiveAndConsistent: false,
    secretBindingFailures: [], secretBindingModes: [], liveProviderAuthentication: false, driverSubaccountVerified: false,
    driverChecked: !!driver, launchEnabled: false, launchApprovalReferencePresent: false,
    launchValidationReferencePresent: false, deployedSourceRevisionVerified: false};
  const inventory = [];
  let next = '';
  do {
    const query = new URLSearchParams({pageSize: '1000'});
    if (next) query.set('pageToken', next);
    const page = await get('https://cloudfunctions.googleapis.com/v2/projects/' + PROJECT +
      '/locations/' + REGION + '/functions?' + query);
    inventory.push(...(page.functions || [])); next = page.nextPageToken || '';
  } while (next);
  const byName = new Map(inventory.filter(item =>
    [PROJECT, NUMBER].some(id => String(item.name).startsWith('projects/' + id + '/locations/' + REGION + '/functions/')))
    .map(item => [item.name.split('/').pop(), item]));
  for (const name of productionFunctions()) {
    if (byName.get(name)?.state === 'ACTIVE') report.activeExpected++;
    else report.missingOrInactiveFunctions.push(name);
  }
  try {
    const rules = await get(DATABASE + '/.settings/rules.json');
    report.rulesMatch = hash(rules) === hash(JSON.parse(readFile(path.join(ROOT, 'database.rules.json'))));
  } catch (_) { /* A blocked rules read cannot pass. */ }
  let launch;
  try { launch = await get(DATABASE + '/paymentLaunch/paystack.json'); }
  catch (_) { throw Error('LAUNCH_STATE_READ_UNAVAILABLE'); }
  report.launchEnabled = launch?.liveEnabled === true;
  report.launchApprovalReferencePresent = !!String(launch?.approvalReference || '').trim();
  report.launchValidationReferencePresent = !!String(launch?.validationReference || '').trim();
  const versions = new Map();
  for (const name of SECRET_FUNCTIONS) {
    let item = byName.get(name), version = bindingOf(item);
    if (item?.environment === 'GEN_1' && !version) {
      try {
        item = await get('https://cloudfunctions.googleapis.com/v1/projects/' + PROJECT +
          '/locations/' + REGION + '/functions/' + name);
        version = bindingOf(item);
      } catch (_) { /* Report the missing binding without printing API bodies. */ }
    }
    if (!version) {
      report.secretBindingFailures.push(name);
      report.secretBindingModes.push({name, mode: 'BINDING_MISSING_OR_NOT_PINNED'});
      continue;
    }
    if (!versions.has(version)) {
      try {
        const payload = await get('https://secretmanager.googleapis.com/v1/projects/' + PROJECT +
          '/secrets/PAYSTACK_SECRET_KEY/versions/' + version + ':access');
        const secret = Buffer.from(payload.payload?.data || '', 'base64').toString('utf8').trim();
        versions.set(version, {secret, domain: keyDomain(secret)});
      } catch (error) {
        const reason = /^READ_HTTP_\d{3}$/.test(error.message) ? error.message : 'SECRET_READ_OR_FORMAT_UNAVAILABLE';
        versions.set(version, {reason});
      }
    }
    report.secretBindingModes.push({name, mode: versions.get(version).domain?.toUpperCase() || versions.get(version).reason});
    if (versions.get(version)?.domain !== 'live') report.secretBindingFailures.push(name);
  }
  const keys = [...versions.values()].filter(value => value.secret).map(value => value.secret);
  const observedKeysLiveAndConsistent = keys.length > 0 &&
    [...versions.values()].every(value => value.domain === 'live') && keys.every(key => key === keys[0]);
  report.secretBindingsLiveAndConsistent = !report.secretBindingFailures.length && keys.length > 0 &&
    observedKeysLiveAndConsistent;
  // Inspect an already deployed LIVE credential even when an endpoint is absent.
  // Missing bindings still block infrastructure readiness and never authorize checkout.
  if (observedKeysLiveAndConsistent) {
    const providerGet = async route => {
      const result = JSON.parse(await responseText(http, 'https://api.paystack.co' + route,
        {Authorization: 'Bearer ' + keys[0]}));
      if (result.status !== true) throw Error('PROVIDER_READ_UNAVAILABLE');
      return result.data;
    };
    try {
      await providerGet('/bank?currency=ZAR&perPage=1');
      report.liveProviderAuthentication = true;
      if (driver) {
        const taxi = await get(DATABASE + '/taxis/' + driver + '.json');
        const saved = await get(DATABASE + '/driverPaystackSubaccounts/' + driver + '.json');
        if (/^ACCT_[A-Za-z0-9]+$/.test(String(saved?.subaccountCode || ''))) {
          const provider = await providerGet('/subaccount/' + encodeURIComponent(saved.subaccountCode));
          report.driverSubaccountVerified = driverCheck(taxi, saved, provider, driver);
        }
      }
    } catch (_) { /* No provider, bank, driver or credential data goes into output. */ }
  }
  return report;
}
function printReport(report, print = console.log) {
  print('PROJECT=' + PROJECT + ' NUMBER=' + NUMBER + ' | READ_ONLY');
  if (report.cloud) {
    const c = report.cloud;
    print('REVIEW_SOURCE=' + c.source);
    print('PRODUCTION_FUNCTIONS: ' + c.activeExpected + '/' + c.expectedFunctions + ' ACTIVE');
    if (c.missingOrInactiveFunctions.length) print('MISSING_OR_INACTIVE: ' + c.missingOrInactiveFunctions.join(', '));
    print('PRODUCTION_RTDB_RULES: ' + (c.rulesMatch ? 'MATCH' : 'MISMATCH_OR_READ_BLOCKED'));
    print('BOUND_PAYSTACK_SECRETS: ' + (c.secretBindingsLiveAndConsistent ? 'LIVE_AND_CONSISTENT' : 'NOT_VERIFIED_LIVE'));
    if (c.secretBindingFailures.length) print('SECRET_BINDING_CHECK: ' + c.secretBindingFailures.join(', '));
    for (const item of c.secretBindingModes) print('BOUND_SECRET_MODE: ' + item.name + '=' + item.mode);
    print('PAYSTACK_LIVE_API_AUTH: ' + (c.liveProviderAuthentication ? 'VERIFIED' : 'NOT_VERIFIED'));
    print('DRIVER_LIVE_SUBACCOUNT: ' + (c.driverSubaccountVerified ? 'VERIFIED_80_20_ZAR' : c.driverChecked ? 'NOT_VERIFIED' : 'NOT_CHECKED'));
    print('CURRENT_LIVE_LAUNCH_GATE: ' + (c.launchEnabled ? 'ENABLED' : 'OFF'));
    print('LAUNCH_EVIDENCE_REFERENCES: ' + (c.launchApprovalReferencePresent && c.launchValidationReferencePresent ? 'PRESENT_NOT_VALIDATED' : 'MISSING'));
  }
  print('PRODUCTION_HOSTED_FILES: MATCH=' + report.public.hostingMatches + '/' + report.public.hostingExpected);
  for (const item of report.public.hostingFailures) print('HOSTED_FILE_CHECK: ' + item.file + '=' + item.reason);
  print('PRODUCTION_PAYMENT_RETURN: ' + (report.public.callbackMatches ? 'MATCH_HTTP_200' : 'MISMATCH_OR_UNAVAILABLE'));
  print('DEPLOYED_FUNCTION_SOURCE_REVISION: NOT_ATTESTED');
  print('PROVIDER_WEBHOOK_REFUND_DEVICE_ACCEPTANCE: NOT_CERTIFIED_BY_THIS_CHECK');
  print('LIVE_ACTIVATION: NOT_PERFORMED');
  print('No keys, bank details, identities, customer collections or raw API bodies printed.');
}
async function main(args = process.argv.slice(2), deps = {}) {
  const options = parseArgs(args);
  const report = {readOnly: true, liveActivationPerformed: false};
  if (options.mode === '--check') report.cloud = await cloudChecks({...deps, driver: options.driver});
  report.public = await publicChecks(deps);
  printReport(report, deps.print);
  const c = report.cloud;
  report.infrastructureChecksPass = !!c && !c.missingOrInactiveFunctions.length && c.rulesMatch &&
    c.secretBindingsLiveAndConsistent && c.liveProviderAuthentication && c.driverSubaccountVerified &&
    report.public.hostingMatches === report.public.hostingExpected && report.public.callbackMatches;
  // Even infrastructure parity cannot certify deployed code or manual acceptance.
  // The exit code describes the requested checks, never authorizes live charges.
  const pass = options.mode === '--public-only' ?
    report.public.hostingMatches === report.public.hostingExpected && report.public.callbackMatches : report.infrastructureChecksPass;
  if (!deps.print) process.exitCode = pass ? 0 : 2;
  return report;
}
if (require.main === module) main().catch(error => {
  const safe = /^(ARGUMENT_INVALID|LOCAL_READ_UNAVAILABLE|PRODUCTION_PROJECT_IDENTITY_MISMATCH|REVIEW_SOURCE_UNAVAILABLE|REVIEW_SOURCE_HAS_TRACKED_CHANGES|LAUNCH_STATE_READ_UNAVAILABLE|REMOTE_READ_UNAVAILABLE|READ_HTTP_\d{3}|READ_SIZE_LIMIT)$/;
  console.error('PRODUCTION_CARD_PREFLIGHT: BLOCKED ' + (safe.test(error.message) ? error.message : 'CHECK_UNAVAILABLE'));
  process.exitCode = 2;
});
module.exports = {PROJECT, NUMBER, DATABASE, CALLBACK, WEBHOOK, PRODUCTION_FILES, SECRET_FUNCTIONS,
  productionFunctions, parseArgs, bindingOf, driverCheck, publicChecks, cloudChecks, printReport, main};
