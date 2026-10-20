"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {renderEntry,verifyNames} = require("../scripts/prepare_staging_function_scope.cjs");
const names = require("../scripts/paystack_function_manifest.json");
test("staging entrypoint exports exactly reviewed functions without legacy Twilio and wallet exports", () => {
  verifyNames(names);
  const source=renderEntry(names);
  assert.match(source,/require\("\.\/index\.js"\)/);
  assert.match(source,/module\.exports = Object\.fromEntries/);
  const vm=require("node:vm");
  const exports=vm.runInNewContext(source+"; module.exports", {
    require: () => Object.fromEntries(names.concat(["createEftSmsTopup","sendEftPaymentStatusSms"]).map(n => [n,()=>{}])),
    module:{exports:{}}
  });
  assert.deepEqual(Object.keys(exports), names);
  assert.equal(exports.createEftSmsTopup,undefined);
  assert.equal(exports.sendEftPaymentStatusSms,undefined);
});
test("staging allowlist rejects duplicate and legacy functions", () => {
  assert.throws(()=>verifyNames(names.concat(names[0])),/duplicate/);
  assert.throws(()=>renderEntry(["createEftSmsTopup"]),/legacy/);
  assert.throws(()=>renderEntry(["x", "bad:selector"]),/invalid/);
});
test("scope generator fails before altering files for production or wrong branch", () => {
  const run=spawnSync(process.execPath,["scripts/prepare_staging_function_scope.cjs"],{
    encoding:"utf8",
    env:{...process.env,STAGING_PROJECT:"asiye-80386",GITHUB_REF_NAME:"main"}
  });
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/restricted to the isolated staging workflow/);
});

test("staging export generator fails closed when Firebase database URL is missing", () => {
  const run=spawnSync(process.execPath,["scripts/prepare_staging_function_scope.cjs"],{
    encoding:"utf8",
    env:{...process.env,STAGING_PROJECT:"asiye-paystack-staging",
      GITHUB_REF_NAME:"fix/paystack-subaccounts-cash-card-no-wallet",FIREBASE_CONFIG:"{}"}
  });
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/staging Firebase WEB config|staging Firebase runtime configuration/i);
});
test("workflow supplies staging DB URL only to scoped function generation and deployment", () => {
  const fs=require("node:fs");
  const yaml=fs.readFileSync(".github/workflows/deploy_paystack_review_staging.yml","utf8");
  for (const step of ["Generate reviewed staging-only Cloud Functions entrypoint",
    "Deploy reviewed secure Cloud Functions to isolated staging"]) {
    const start=yaml.indexOf("      - name: "+step);
    assert.notEqual(start,-1,"missing "+step);
    const next=yaml.indexOf("      - name:",start+12);
    const slice=yaml.slice(start,next<0?undefined:next);
    assert.ok(slice.includes("FIREBASE_CONFIG: ${{ vars.FIREBASE_STAGING_WEB_CONFIG }}"),
      "Missing scoped staging runtime DB config in "+step);
  }
});
