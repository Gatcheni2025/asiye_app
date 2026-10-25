'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {PROJECT, NUMBER, DATABASE, CALLBACK, SECRET_FUNCTIONS, PRODUCTION_FILES, productionFunctions,
  parseArgs, bindingOf, driverCheck, main, cloudChecks} = require('../scripts/production_card_preflight.cjs');
const {renderPaymentReturn} = require('../functions/paystack-return');
const root = path.resolve(__dirname, '..');
const driverId = 'PRIVATE_DRIVER_ID', uid = 'PRIVATE_AUTH_UID';
const liveKey = 'sk_live_PRIVATEKEY', testKey = 'sk_test_PRIVATEKEY', token = 'PRIVATE_GOOGLE_TOKEN';
const saved = {ownerUid: uid, status: 'verified', platformCommissionPercent: 20,
  subaccountCode: 'ACCT_PRIVATE', accountLast4: '9123'};
const driver = {authUid: uid, verificationStatus: 'verified', vehicleApproved: true};
const provider = {domain: 'live', currency: 'ZAR', subaccount_code: saved.subaccountCode,
  account_number: 'PRIVATE_BANK_9123', percentage_charge: 20, is_verified: true, active: true};
const binding = version => ({key: 'PAYSTACK_SECRET_KEY', secret: 'PAYSTACK_SECRET_KEY', projectId: PROJECT, version});
const response = value => ({ok: true, text: async () => typeof value === 'string' ? value : JSON.stringify(value)});
function harness({oldBinding = false, allBindingsTest = false, stagedTest = false, launchEnabled = false, wrongDriver = false, providerFailure = false, missingPayout = false, secretDenied = false} = {}) {
  const calls = [], output = [];
  const inventory = productionFunctions().map(name => ({name: 'projects/' + PROJECT + '/locations/us-central1/functions/' + name,
    state: 'ACTIVE', environment: 'GEN_2', serviceConfig: {secretEnvironmentVariables:
      SECRET_FUNCTIONS.includes(name) ? [binding(allBindingsTest || oldBinding && name === 'paystackWebhook' ? '1' : '2')] : []}}));
  const command = (program, args) => {
    assert.ok(['gcloud', 'git'].includes(program));
    if (program === 'git') return args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
    if (args[0] === 'config') return PROJECT;
    if (args[0] === 'projects') return NUMBER;
    assert.deepEqual(args, ['auth', 'print-access-token']); return token;
  };
  const http = async (url, options) => {
    const parsed = new URL(url); calls.push(parsed);
    assert.equal(options.method, 'GET', 'No deployment, activation, refund or charge request is allowed');
    assert.equal(options.redirect, 'error');
    if (parsed.origin === 'https://' + PROJECT + '.web.app') {
      assert.equal(options.headers.Authorization, undefined);
      assert.ok(PRODUCTION_FILES.includes(parsed.pathname.slice(1)));
      return response(fs.readFileSync(path.join(root, 'assets', parsed.pathname), 'utf8'));
    }
    if (url === CALLBACK) {
      assert.equal(options.headers.Authorization, undefined);
      return response(renderPaymentReturn(PROJECT, undefined));
    }
    if (parsed.origin === 'https://api.paystack.co') {
      assert.equal(options.headers.Authorization, 'Bearer ' + liveKey);
      assert.ok(parsed.pathname === '/bank' || parsed.pathname === '/subaccount/' + saved.subaccountCode);
      if (providerFailure) return {ok: false, status: 403, text: async () => 'PRIVATE_PROVIDER_ERROR_BODY'};
      return response({status: true, data: parsed.pathname === '/bank' ? [] : provider});
    }
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (parsed.origin === 'https://cloudfunctions.googleapis.com') {
      assert.equal(parsed.pathname, '/v2/projects/' + PROJECT + '/locations/us-central1/functions');
      return response({functions: missingPayout ? inventory.filter(item => !item.name.endsWith('/configureDriverCardPayout')) : inventory});
    }
    if (parsed.origin === 'https://secretmanager.googleapis.com') {
      assert.match(parsed.pathname, new RegExp('^/v1/projects/' + PROJECT + '/secrets/PAYSTACK_SECRET_KEY/versions/(?:[12]|latest):access$'));
      if (secretDenied) return {ok: false, status: 403, text: async () => 'PRIVATE_SECRET_ACCESS_ERROR'};
      const secret = parsed.pathname.endsWith('/1:access') || stagedTest && parsed.pathname.endsWith('/latest:access') ? testKey : liveKey;
      return response({name: 'projects/' + NUMBER + '/secrets/PAYSTACK_SECRET_KEY/versions/' +
        (parsed.pathname.endsWith('/latest:access') ? '3' : parsed.pathname.endsWith('/1:access') ? '1' : '2'),
        payload: {data: Buffer.from(secret).toString('base64')}});
    }
    assert.equal(parsed.origin, DATABASE);
    const values = {
      '/.settings/rules.json': JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8')),
      '/paymentLaunch/paystack.json': {liveEnabled: launchEnabled, approvalReference: 'PRIVATE_APPROVAL_REF', validationReference: 'PRIVATE_VALIDATION_REF'},
      ['/taxis/' + driverId + '.json']: driver,
      ['/driverPaystackSubaccounts/' + driverId + '.json']: wrongDriver ? {...saved, ownerUid: 'wrong'} : saved
    };
    if (parsed.pathname === '/driverPaystackSubaccounts.json') {
      assert.equal(parsed.searchParams.get('shallow'), 'true');
      return response(null);
    }
    assert.ok(Object.hasOwn(values, parsed.pathname), 'Never read customer collections or unrelated profiles');
    return response(values[parsed.pathname]);
  };
  return {command, fetch: http, calls, output, deps: {run: command, http, print: line => output.push(line)}};
}
test('release inspection exposes no write mode, validates IDs and excludes the staging test console', () => {
  assert.deepEqual(parseArgs([]), {mode: '--check', driver: null});
  assert.equal(productionFunctions().length, 42);
  assert.equal(productionFunctions().includes('adminStagingTestConsole'), false);
  assert.equal(PRODUCTION_FILES.length, 44);
  assert.equal(PRODUCTION_FILES.some(file => file.startsWith('admin/testing.')), false);
  for (const args of [['--enable'], ['--apply'], ['--public-only', '--driver=x'], ['--check', '--driver=../../requests'], ['--check', '--key=secret']])
    assert.throws(() => parseArgs(args), /ARGUMENT_INVALID/);
});
test('wrong project and tracked edits stop before authentication or remote reads', async () => {
  let reads = 0;
  await assert.rejects(cloudChecks({run: () => 'asiye-paystack-staging', http: async () => {reads++;}}), /PRODUCTION_PROJECT_IDENTITY_MISMATCH/);
  const h = harness();
  await assert.rejects(cloudChecks({...h.deps, run: (program, args) => args[0] === 'diff' ? 'functions/index.js' : h.command(program, args)}), /REVIEW_SOURCE_HAS_TRACKED_CHANGES/);
  assert.equal(reads, 0); assert.equal(h.calls.length, 0);
});
test('only exact numeric secret bindings in the production project qualify', () => {
  assert.equal(bindingOf({serviceConfig: {secretEnvironmentVariables: [binding('2')]}}), '2');
  for (const changed of [{version: 'latest'}, {projectId: 'asiye-paystack-staging'}, {secret: 'ANOTHER_KEY'}])
    assert.equal(bindingOf({serviceConfig: {secretEnvironmentVariables: [{...binding('2'), ...changed}]}}), null);
  assert.equal(bindingOf({serviceConfig: {secretEnvironmentVariables: [binding('2'), binding('2')]}}), null);
});
test('all checks use pinned GETs and redact credentials, private records and approval references', async () => {
  const h = harness();
  const result = await main(['--check', '--driver=' + driverId], h.deps);
  assert.equal(result.infrastructureChecksPass, true);
  assert.equal(result.liveActivationPerformed, false);
  assert.equal(result.cloud.launchEnabled, false);
  assert.equal(result.cloud.deployedSourceRevisionVerified, false);
  assert.match(h.output.join('\n'), /LIVE_ACTIVATION: NOT_PERFORMED/);
  for (const secret of [token, liveKey, driverId, uid, provider.account_number, saved.subaccountCode, saved.accountLast4, 'PRIVATE_APPROVAL_REF', 'PRIVATE_VALIDATION_REF'])
    assert.equal(h.output.join('\n').includes(secret), false);
});
test('default infrastructure readback can pass while explicitly reporting that driver banking remains required', async () => {
  const h = harness();
  const result = await main(['--check'], h.deps);
  assert.equal(result.infrastructureChecksPass, true);
  assert.equal(result.cloud.driverChecked, false);
  assert.equal(result.cloud.driverSubaccountVerified, false);
  assert.equal(result.cloud.driverPayoutProfileCount, 0);
  assert.equal(result.liveActivationPerformed, false);
  assert.ok(h.output.includes('DRIVER_BANKING_SETUP: REQUIRED_IN_APP'));
  assert.ok(h.output.includes('DRIVER_LIVE_SUBACCOUNT: NOT_CHECKED'));
  assert.equal(h.calls.some(url => url.pathname.startsWith('/taxis/')), false);
});
test('an older TEST-bound webhook fails even when other functions use a live key', async () => {
  const h = harness({oldBinding: true});
  const result = await main(['--check', '--driver=' + driverId], h.deps);
  assert.equal(result.infrastructureChecksPass, false);
  assert.equal(result.cloud.secretBindingsLiveAndConsistent, false);
  assert.deepEqual(result.cloud.secretBindingFailures, ['paystackWebhook']);
  assert.ok(h.output.includes('BOUND_SECRET_MODE: paystackWebhook=TEST'));
  assert.equal(h.calls.some(url => url.pathname.startsWith('/subaccount/')), false);
  assert.ok(h.calls.some(url => url.pathname.endsWith('/versions/1:access')));
  assert.ok(h.calls.some(url => url.pathname.endsWith('/versions/2:access')));
});
test('a newly staged authenticated LIVE key never substitutes for older TEST function bindings', async () => {
  const h = harness({allBindingsTest: true});
  const result = await main(['--check'], h.deps);
  assert.equal(result.cloud.stagedSecretMode, 'LIVE');
  assert.equal(result.cloud.stagedSecretVersion, '3');
  assert.equal(result.cloud.stagedLiveKeyAuthenticated, true);
  assert.equal(result.cloud.secretBindingsLiveAndConsistent, false);
  assert.equal(result.infrastructureChecksPass, false);
  assert.ok(result.cloud.secretBindingModes.every(item => item.mode === 'TEST'));
  for (const secret of [liveKey, testKey]) assert.equal(h.output.join('\n').includes(secret), false);
});
test('storing another TEST key is reported accurately and cannot verify a staged live credential', async () => {
  const h = harness({allBindingsTest: true, stagedTest: true});
  const result = await main(['--check'], h.deps);
  assert.equal(result.cloud.stagedSecretMode, 'TEST');
  assert.equal(result.cloud.stagedLiveKeyAuthenticated, false);
  assert.equal(result.infrastructureChecksPass, false);
});
test('a missing payout endpoint cannot hide an existing live credential or pass readiness', async () => {
  const h = harness({missingPayout: true});
  const result = await main(['--check', '--driver=' + driverId], h.deps);
  assert.equal(result.cloud.liveProviderAuthentication, true);
  assert.equal(result.cloud.secretBindingsLiveAndConsistent, false);
  assert.equal(result.infrastructureChecksPass, false);
  assert.ok(h.output.includes('BOUND_SECRET_MODE: configureDriverCardPayout=BINDING_MISSING_OR_NOT_PINNED'));
});
test('blocked Secret Manager reads are reported as HTTP categories without claiming TEST mode', async () => {
  const h = harness({secretDenied: true});
  const result = await main(['--check'], h.deps);
  assert.equal(result.cloud.liveProviderAuthentication, false);
  assert.ok(result.cloud.secretBindingModes.every(item => item.mode === 'READ_HTTP_403'));
  assert.equal(h.output.join('\n').includes('PRIVATE_SECRET_ACCESS_ERROR'), false);
});
test('live driver validation rejects TEST accounts, wrong owner, bank, currency, commission or verification', async () => {
  assert.equal(driverCheck(driver, saved, provider, driverId), true);
  for (const patch of [{domain: 'test'}, {currency: 'NGN'}, {percentage_charge: 80}, {active: false}, {is_verified: false}, {account_number: 'other1234'}, {subaccount_code: 'ACCT_OTHER'}])
    assert.equal(driverCheck(driver, saved, {...provider, ...patch}, driverId), false);
  const h = harness({wrongDriver: true});
  assert.equal((await main(['--check', '--driver=' + driverId], h.deps)).infrastructureChecksPass, false);
});
test('provider errors stay private; an existing enabled gate is reported without modifying it', async () => {
  const h = harness({launchEnabled: true, providerFailure: true});
  const result = await main(['--check', '--driver=' + driverId], h.deps);
  assert.equal(result.cloud.launchEnabled, true);
  assert.equal(result.infrastructureChecksPass, false);
  assert.equal(h.output.join('\n').includes('PRIVATE_PROVIDER_ERROR_BODY'), false);
  assert.ok(h.output.includes('CURRENT_LIVE_LAUNCH_GATE: ENABLED'));
});
test('an HTTP 200 error page or wrong-project callback cannot pass public parity', async () => {
  const h = harness();
  const result = await main(['--public-only'], {...h.deps, http: async (url, options) =>
    url === CALLBACK ? response(renderPaymentReturn('asiye-paystack-staging', undefined)) : h.fetch(url, options)});
  assert.equal(result.public.callbackMatches, false);
  assert.equal(result.public.hostingMatches, PRODUCTION_FILES.length);
  assert.equal(result.infrastructureChecksPass, false);
  assert.equal(h.calls.some(url => url.hostname === 'secretmanager.googleapis.com'), false);
});
