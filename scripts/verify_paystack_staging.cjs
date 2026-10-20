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
  // Confirm the actual hosted WEB-only clients, not merely the uploaded files.
  // Validate the project before contacting any URL to prevent prod access.
  const clients = {};
  for (const [label, relative] of Object.entries({
    passenger: '/passenger-v2/js/firebase.js',
    driver: '/driver-v2/js/firebase.js',
    payment: '/passenger-v2/js/wallet.js'
  })) {
    const response = await fetch('https://' + projectId + '.web.app' + relative, {
      redirect:'error', signal: AbortSignal.timeout(15000), cache:'no-store'
    });
    if (!response.ok) throw Error('Staging hosting ' + label + ' returned HTTP ' + response.status);
    const body = await response.text();
    if (body.includes('asiye-80386') || body.includes('asiye-80386-default-rtdb')) {
      throw Error('Production Firebase reference found in staging hosted ' + label + ' script.');
    }
    if (label !== 'payment' && !body.includes(projectId)) {
      throw Error('Staging hosted ' + label + ' Firebase configuration does not name its project.');
    }
    const robots = response.headers.get('x-robots-tag') || '';
    if (!robots.includes('noindex')) throw Error('Staging hosting no-index header is missing for ' + label);
    clients[label] = {sourceUrl:relative, projectIsolated:true, noIndex:true};
  }
  const checks = {
    projectId,
    reviewedSourceSha: process.env.GITHUB_SHA || 'unknown',
    checkedAt: new Date().toISOString(),
    verifiedReadOnly: true,
    endpointInventoryMatches: inventory.missingOrInactiveFunctions.length === 0,
    rulesMatch: inventory.rulesMatchReviewedSource === true,
    hostedWebClients: clients,
    hostedWebClientsVerified: true,
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
    '- Staging hosted WEB clients: MATCH; no-index; no production Firebase references',
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
