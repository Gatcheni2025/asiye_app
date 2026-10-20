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
