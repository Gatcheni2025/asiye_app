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
      "[debug] Authorization: Bearer DO_NOT_LEAK",
      "Error: Permission denied, DO_NOT_LEAK",
    ].join("\n"));
    const output = spawnSync(process.execPath, ["scripts/summarize_staging_deploy_error.cjs", file, "Cloud Functions"], {encoding: "utf8"});
    assert.equal(output.status, 0, output.stderr);
    assert.match(output.stderr, /cloudfunctions\.googleapis\.com/);
    assert.match(output.stderr, /HTTP 404/);
    assert.match(output.stderr, /permission error/i);
    assert.doesNotMatch(output.stderr, /DO_NOT_LEAK|Bearer|token=/i);
  } finally { fs.rmSync(folder, {force: true, recursive: true}); }
});
