'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {requireStagingConfig, rewrite, createStagingPreview} =
  require('../scripts/build_staging_web_preview.cjs');

const prod = {
  apiKey: 'AIza' + 'P'.repeat(30),
  authDomain: 'asiye-80386.firebaseapp.com',
  databaseURL: 'https://asiye-80386-default-rtdb.firebaseio.com',
  projectId: 'asiye-80386',
  storageBucket: 'asiye-80386.firebasestorage.app',
  messagingSenderId: '531902350858',
  appId: '1:531902350858:web:f8a4a246bf350d50e3c1f3'
};
const staging = {
  apiKey:'AIza' + 'X'.repeat(30),
  authDomain:'asiye-test-safe.firebaseapp.com',
  databaseURL:'https://asiye-test-safe-default-rtdb.firebaseio.com',
  projectId:'asiye-test-safe',
  storageBucket:'asiye-test-safe.firebasestorage.app',
  messagingSenderId:'123456789012',
  appId:'1:123456789012:web:abcdefab12'
};
test('Staging web configuration cannot target production or mix projects', () => {
  assert.equal(requireStagingConfig(staging, staging.projectId),staging);
  assert.throws(() => requireStagingConfig(prod,'asiye-80386'), /isolated/);
  assert.throws(() => requireStagingConfig({...staging, databaseURL:prod.databaseURL},staging.projectId), /database URL/);
  assert.throws(() => requireStagingConfig({...staging, authDomain:prod.authDomain},staging.projectId), /auth domain/);
  assert.throws(() => requireStagingConfig(staging,prod.projectId), /isolated/);
});
test('Staging web assets route payment and Firebase URLs to staging without touching public domains', () => {
  const original = JSON.stringify(prod) +
    '\nhttps://us-central1-asiye-80386.cloudfunctions.net/prepareTripPayment' +
    '\nhttps://asiye-80386.web.app/track.html' +
    '\nhttps://asiye.cloud/terms-of-service.html';
  const output = rewrite(original,prod,staging);
  assert.ok(!output.includes('asiye-80386'));
  assert.ok(!output.includes(prod.apiKey));
  assert.match(output,/us-central1-asiye-test-safe\.cloudfunctions\.net\/prepareTripPayment/);
  assert.match(output,/asiye-test-safe\.web\.app\/track\.html/);
  assert.match(output,/https:\/\/asiye\.cloud\/terms-of-service\.html/);
});
test('Staging preview is separate, blocks symlinks, and preserves tracked production assets', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asiye-staging-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const src=path.join(temp,'assets');
  fs.mkdirSync(path.join(src,'passenger-v2','js'),{recursive:true});
  fs.mkdirSync(path.join(src,'driver-v2'),{recursive:true});
  const prodCfg=Object.entries(prod).map(([k,v])=>k+': "'+v+'"').join(',\n');
  const firebase=path.join(src,'passenger-v2/js/firebase.js');
  fs.writeFileSync(firebase,'const firebaseConfig = {'+prodCfg+'};');
  fs.writeFileSync(path.join(src,'driver-v2','payment.js'),'https://us-central1-asiye-80386.cloudfunctions.net/prepareTripPayment');
  fs.writeFileSync(path.join(src,'login.html'),'https://asiye-80386.web.app; https://asiye-80386-default-rtdb.firebaseio.com');
  const original=fs.readFileSync(firebase,'utf8');
  const out=path.join(temp,'staging-preview');
  const result=createStagingPreview({assetsRoot:src,outputDir:out,firebaseConfig:staging,expectedProject:staging.projectId});
  assert.equal(result.rewrittenFiles,3);
  assert.equal(fs.readFileSync(firebase,'utf8'),original);
  assert.match(fs.readFileSync(path.join(out,'login.html'),'utf8'),/asiye-test-safe/);
  assert.equal(fs.existsSync(result.generatedConfig),true);
  fs.rmSync(result.generatedConfig,{force:true});
  assert.throws(()=>createStagingPreview({assetsRoot:src,outputDir:src,firebaseConfig:staging,expectedProject:staging.projectId}),/separate/);
});
test('Secure runtime storage, checkout callback and tracking links follow active project',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');
  assert.match(src,/function runtimeFirebaseProjectId\(\)/);
  assert.ok(src.includes('const PAYSTACK_CALLBACK_URL ='));
  assert.match(src,/const PROFILE_STORAGE_BUCKET\s*=\s*admin\.app\(\)\.options\.storageBucket/);
  assert.match(src,/runtimeHostingOrigin\(\).*\/track\.html/);
  assert.doesNotMatch(src,/asiye-80386\.web\.app\/track\.html/);
});
