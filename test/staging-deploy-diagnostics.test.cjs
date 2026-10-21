"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
test("Firebase deploy diagnostics report failing API without printing bearer tokens or raw log", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "asiye-deploy-log-"));
  const file = path.join(folder, "firebase.log");
  try {
    fs.writeFileSync(file, [
      "[debug] >>> [apiv2][query] GET https://serviceusage.googleapis.com/v1/projects/asiye-paystack-staging/services/cloudfunctions.googleapis.com?token=DO_NOT_LEAK",
      "[debug] <<< [apiv2][status] GET https://serviceusage.googleapis.com/v1/projects/asiye-paystack-staging/services/cloudfunctions.googleapis.com?token=DO_NOT_LEAK 404",
      "[debug] <<< [apiv2][body] GET https://serviceusage.googleapis.com/v1/projects/asiye-paystack-staging/services/cloudfunctions.googleapis.com { \"secret\": \"DO_NOT_LEAK\" }",
      "[debug] <<< [apiv2][status] GET https://secretmanager.googleapis.com/v1/projects/asiye-paystack-staging/secrets/TWILIO_ACCOUNT_SID?token=DO_NOT_LEAK 404",
      "[debug] <<< [apiv2][status] GET https://secretmanager.googleapis.com/v1/projects/asiye-paystack-staging/secrets/PRIVATE_DO_NOT_LEAK?token=DO_NOT_LEAK 404",
      "[debug] <<< [apiv2][status] GET https://compute.googleapis.com/compute/v1/projects/asiye-paystack-staging?auth=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] POST https://cloudresourcemanager.googleapis.com/v1/projects/asiye-paystack-staging:testIamPermissions?auth=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] POST https://cloudresourcemanager.googleapis.com/v1/projects/asiye-paystack-staging:getIamPolicy?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] POST https://cloudresourcemanager.googleapis.com/v1/projects/1000800408896:testIamPermissions?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] POST https://cloudresourcemanager.googleapis.com/v1/projects/asiye-80386:getIamPolicy?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] POST https://cloudresourcemanager.googleapis.com/v1/projects/UNKNOWN_PROJECT_PRIVATE_ID:unknownRpcPrivateSuffix?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] GET https://cloudresourcemanager.googleapis.com/v1/projects/asiye-paystack-staging?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] GET https://cloudresourcemanager.googleapis.com/v1/projects/asiye-80386?token=DO_NOT_LEAK 403",
      "[debug] <<< [apiv2][status] GET https://cloudresourcemanager.googleapis.com/v1/projects/UNRELATED_PROJECT_PRIVATE_ID?token=DO_NOT_LEAK 403",
      "[debug] Authorization: Bearer DO_NOT_LEAK",
      "Error: Permission denied, DO_NOT_LEAK",
    ].join("\n"));
    const output = spawnSync(process.execPath, ["scripts/summarize_staging_deploy_error.cjs", file, "Cloud Functions"], {encoding: "utf8"});
    assert.equal(output.status, 0, output.stderr);
    assert.match(output.stderr, /cloudfunctions\.googleapis\.com/);
    assert.match(output.stderr, /HTTP 404/);
    assert.match(output.stderr, /permission error/i);
    assert.match(output.stderr, /Known missing secret IDs \(names only\): TWILIO_ACCOUNT_SID/);
    assert.match(output.stderr, /compute.googleapis.com compute project metadata -> HTTP 403/);
    assert.match(output.stderr, /cloudresourcemanager.googleapis.com project IAM permission probe -> HTTP 403/);
    assert.doesNotMatch(output.stderr,/asiye-paystack-staging:testIamPermissions/);
    assert.match(output.stderr,/Denied Resource Manager lookup targets \(redacted\):/);
    assert.match(output.stderr,/GET staging/);
    assert.match(output.stderr,/GET PRODUCTION/);
    assert.ok(output.stderr.includes("GET OTHER (redacted) getProject"), "expected safe classification: GET OTHER (redacted) getProject");
    assert.ok(output.stderr.includes("POST staging getIamPolicy"), "expected safe classification: POST staging getIamPolicy");
    assert.ok(output.stderr.includes("POST staging testIamPermissions"), "expected safe classification: POST staging testIamPermissions");
    assert.ok(output.stderr.includes("POST PRODUCTION getIamPolicy"), "expected safe classification: POST PRODUCTION getIamPolicy");
    assert.ok(output.stderr.includes("POST OTHER (redacted) OTHER_RPC (redacted)"), "expected safe classification: POST OTHER (redacted) OTHER_RPC (redacted)");
    assert.match(output.stderr,/project IAM policy read -> HTTP 403/);
    assert.doesNotMatch(output.stderr,/UNRELATED_PROJECT_PRIVATE_ID|UNKNOWN_PROJECT_PRIVATE_ID|unknownRpcPrivateSuffix|asiye-80386|1000800408896/);
    assert.doesNotMatch(output.stderr, /DO_NOT_LEAK|Bearer|token=/i);
  } finally { fs.rmSync(folder, {force: true, recursive: true}); }
});
