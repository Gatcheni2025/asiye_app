'use strict';

// Post-deployment read-only check. Never tests production and never enables Card.
const fs = require('node:fs');
const path = require('node:path');
const {firebaseInventory} = require('./paystack_technical_readiness.cjs');

async function main() {
  const projectId = String(process.env.STAGING_PROJECT || '').trim();
  const creds = String(process.env.STAGING_CREDS || '');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
      projectId === 'asiye-80386') throw Error('An isolated nonproduction Firebase project is mandatory.');
  if (!creds) throw Error('Missing isolated staging credentials.');
  const inventory = await firebaseInventory(creds, projectId);
  const checks = {
    projectId,
    reviewedSourceSha: process.env.GITHUB_SHA || 'unknown',
    checkedAt: new Date().toISOString(),
    verifiedReadOnly: true,
    endpointInventoryMatches: inventory.missingOrInactiveFunctions.length === 0,
    rulesMatch: inventory.rulesMatchReviewedSource === true,
    missingOrInactiveFunctions: inventory.missingOrInactiveFunctions,
    deployedRulesSha256: inventory.deployedRulesSha256 || null,
    reviewRulesSha256: inventory.reviewRulesSha256 || null,
    // Function inventory and rule digest cannot prove the deployed source SHA.
    functionSourceRevisionVerified: false,
    realPaystackCheckoutWebhookRefundVerified: false,
    liveCardActivationApproved: false
  };
  const dest = path.join(__dirname, '..', 'paystack-readiness');
  fs.mkdirSync(dest, {recursive: true});
  fs.writeFileSync(path.join(dest, 'staging-verification.json'), JSON.stringify(checks, null, 2) + '\n');
  const summary = [
    '### Isolated Paystack staging deployment check',
    '- Firebase project: `' + projectId + '`',
    '- Active endpoint inventory: ' + (checks.endpointInventoryMatches ? 'MATCH' : 'MISMATCH'),
    '- Database rules digest: ' + (checks.rulesMatch ? 'MATCH' : 'MISMATCH'),
    '- Function source revision: not attested by endpoint inventory',
    '- Provider webhook/refund, supported-device acceptance and Paystack approval: still required',
    '- Live Card processing: disabled / not authorized by this workflow'
  ].join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!checks.endpointInventoryMatches || !checks.rulesMatch) {
    throw Error('Staging deployment does not match reviewed function inventory and database rules.');
  }
}
main().catch(error => {console.error('Staging verification failed:', error.message); process.exitCode = 1;});
