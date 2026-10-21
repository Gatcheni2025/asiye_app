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
  const params={declaredParams:[
    {name:"TWILIO_ACCOUNT_SID"}, {name:"TWILIO_AUTH_TOKEN"}, {name:"TWILIO_FROM_NUMBER"},
    {name:"PAYSTACK_SECRET_KEY"}, {name:"OTHER_PARAMETER"}
  ]};
  const all=Object.fromEntries(names.concat(["createEftSmsTopup","sendEftPaymentStatusSms"]).map(n => [n,()=>{}]));
  const exported=vm.runInNewContext(source+"; module.exports", {
    require: id => id === "firebase-functions/params" ? params : all,
    module:{exports:{}}
  });
  assert.deepEqual(Object.keys(exported), names);
  assert.equal(exported.createEftSmsTopup,undefined);
  assert.equal(exported.sendEftPaymentStatusSms,undefined);
  assert.deepEqual(params.declaredParams.map(p=>p.name), ["PAYSTACK_SECRET_KEY","OTHER_PARAMETER"]);
  assert.match(source,/Legacy Twilio secret was retained/);
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
  assert.match(run.stderr,/staging Firebase WEB config|staging Firebase runtime configuration|Staging web project must exactly match the isolated FIREBASE_STAGING_PROJECT/i);
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

test("staging filtered exports reject missing SDK params registry", () => {
  const vm=require("node:vm");
  const all=Object.fromEntries(names.map(n=>[n,()=>{}]));
  assert.throws(()=>vm.runInNewContext(renderEntry(names)+"; module.exports",{
    require: id => id === "firebase-functions/params" ? {declaredParams:null} : all,
    module:{exports:{}}
  }),/registry is unavailable/);
});

test("staging workflow checks Compute and Resource Manager metadata before any resource writes", () => {
  const fs = require("node:fs");
  const yaml = fs.readFileSync(".github/workflows/deploy_paystack_review_staging.yml", "utf8");
  const metadata = yaml.indexOf("      - name: Read-only Compute and Resource Manager metadata access checks");
  const secretWrite = yaml.indexOf("      - name: Configure only the staging TEST secret");
  const functionsWrite = yaml.indexOf("      - name: Deploy reviewed secure Cloud Functions to isolated staging");
  assert.ok(metadata >= 0 && secretWrite > metadata && functionsWrite > metadata,
    "metadata preflight must precede staging writes");
  const next = yaml.indexOf("      - name:", metadata + 12);
  const step = yaml.slice(metadata, next < 0 ? undefined : next);
  assert.ok(step.includes('test "$STAGING_PROJECT" = "asiye-paystack-staging"'));
  assert.ok(step.includes("compute.googleapis.com/compute/v1/projects/"));
  assert.ok(step.includes("cloudresourcemanager.googleapis.com/v1/projects/"));
  assert.ok(step.includes("roles/compute.viewer"));
  assert.ok(step.includes("roles/browser"));
  for (const role of ["roles/owner", "roles/editor", "roles/compute.admin"]) {
    assert.ok(!step.includes(role), "preflight should not suggest elevated role " + role);
  }
  assert.ok(step.includes('--output "$RESP"'), "probe must suppress response bodies");
});
