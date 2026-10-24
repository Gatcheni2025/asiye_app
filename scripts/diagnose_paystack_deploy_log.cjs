'use strict';
// Offline, READ-ONLY diagnosis of the private Firebase CLI --debug log.
// Never upload the log or print raw lines, URLs, request bodies, identities or tokens.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manifest = require('./paystack_function_manifest.json');

const rules = [
  ['PERMISSION_DENIED', /\bPERMISSION_DENIED\b|\b403\b|iam\.serviceAccounts\.actAs|not authorized|permission denied|does not have permission/i],
  ['QUOTA_OR_RATE_LIMIT', /\b429\b|RESOURCE_EXHAUSTED|quota exceeded|rate.?limit/i],
  ['INVALID_CONFIGURATION', /\b400\b|INVALID_ARGUMENT|invalid (?:value|argument|configuration)/i],
  ['CLOUD_RUN_STARTUP', /container healthcheck|container failed to start|revision.*not ready|port (?:defined|8080)|failed to listen/i],
  ['MISSING_SECRET', /secret.*(?:not found|does not exist|404)|secretmanager.*404/i],
  ['MISSING_IDENTITY', /service account.*(?:not found|does not exist|missing)|runtime identity.*missing/i],
  ['API_NOT_ENABLED', /SERVICE_DISABLED|API .*not enabled|API .*disabled|must enable required APIs/i],
  ['NETWORK_OR_TIMEOUT', /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network.*timeout|deadline exceeded/i],
  ['BUILD_FAILED', /cloud build failed|build failed|build status.*FAILURE/i],
  ['FUNCTION_CREATE_OR_UPDATE_FAILED', /failed to (?:create|update) function|failed to (?:create|update) cloud run service/i]
];
function kinds(s) {
  return rules.filter(([_, p]) => p.test(s)).map(([kind]) => kind);
}
function functionNames(s) {
  return manifest.filter(name =>
    new RegExp('(?:^|[^A-Za-z0-9])' + name + '(?![A-Za-z0-9])').test(s));
}
function chooseLog() {
  const home = os.homedir();
  const requested = process.argv[2];
  let file;
  if (requested) {
    file = fs.realpathSync(path.resolve(requested));
    if (path.dirname(file) !== home ||
        !/^asiye-staging-functions\.[A-Za-z0-9]+\.log$/.test(path.basename(file))) {
      throw Error('For safety, select only the private asiye-staging-functions.*.log in your Cloud Shell home directory.');
    }
  } else {
    const candidates = fs.readdirSync(home)
      .filter(name => /^asiye-staging-functions\.[A-Za-z0-9]+\.log$/.test(name))
      .map(name => ({file:path.join(home,name), when:fs.statSync(path.join(home,name)).mtimeMs}))
      .sort((a,b) => b.when-a.when);
    if (!candidates.length) throw Error('No private staging deployment log found in your Cloud Shell home directory.');
    file = candidates[0].file;
  }
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 30*1024*1024) {
    throw Error('Invalid or unusually large private deployment log. Inspect it locally without publishing.');
  }
  return file;
}
function analyze(raw) {
  if (!Array.isArray(manifest) || manifest.length !== 37) throw Error('Unexpected staging manifest');
  const lines = raw.split(/\r?\n/);
  const terminal = lines.slice(-350);
  const direct = [];
  const activity = {create:new Set(),update:new Set()};
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    const hasFailure = /failed to (?:create|update) function|failed to (?:create|update) cloud run service|functions: failed|error deploying functions/i.test(line);
    const hasCreate = /functions: creating |creating node\.js \d+.*function/i.test(line);
    const hasUpdate = /functions: updating |updating node\.js \d+.*function/i.test(line);
    if (hasCreate || hasUpdate) {
      const target = hasCreate ? activity.create : activity.update;
      for(const name of functionNames(line)) target.add(name);
    }
    if (hasFailure) {
      for(const name of functionNames(line)) if (!direct.includes(name)) direct.push(name);
      // Firebase also emits a plain name(regional-location) list below the
      // final 'functions deploy had errors' summary. Read that bounded list.
      if (/error deploying functions|functions deploy had errors/i.test(line)) {
        for(const next of lines.slice(i+1,i+24)) {
          if (next.trim()==='' && direct.length) break;
          for(const name of functionNames(next)) if (!direct.includes(name)) direct.push(name);
        }
      }
    }
  }
  const counts = new Map();
  const interesting = terminal.filter(line =>
    /Error:|Failed to |HTTP Error|PERMISSION_DENIED|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|quota exceeded|revision.*not ready|cloud run service|service account|SERVICE_DISABLED/i.test(line));
  for(const line of interesting) {
    for(const kind of kinds(line)) counts.set(kind, (counts.get(kind)||0)+1);
  }
  const terminalCodes = new Set();
  for(const line of terminal) {
    if (/HTTP Error:|response.*status|statusCode|status\s*:\s*|\[status\]/i.test(line)) {
      for (const m of line.matchAll(/\b(400|401|403|404|409|429|500|502|503|504)\b/g)) terminalCodes.add(m[1]);
    }
  }
  return {
    totalLines: lines.length,
    attemptedCreate: [...activity.create],
    attemptedUpdate: [...activity.update],
    explicitFailed:direct,
    categories:[...counts].sort((a,b)=>b[1]-a[1]),
    terminalCodes:[...terminalCodes].sort(),
    terminalErrorLines: interesting.length
  };
}
function main() {
  const result = analyze(fs.readFileSync(chooseLog(),'utf8'));
  console.log('Asiye staging private deployment failure analysis — READ ONLY');
  console.log('Manifest size: '+manifest.length+' | log lines: '+result.totalLines);
  console.log('Functions explicitly named in deployment failure lines: '+(result.explicitFailed.join(', ')||'none detected'));
  console.log('Functions with creation attempts observed: '+(result.attemptedCreate.join(', ')||'none detected'));
  console.log('Functions with update attempts observed: '+(result.attemptedUpdate.join(', ')||'none detected'));
  console.log('Terminal HTTP codes (unattributed): '+(result.terminalCodes.join(', ')||'none detected'));
  console.log('Last 350 log lines: failure-category matches: '+result.terminalErrorLines);
  console.log('Terminal failure categories (counts are signals, not confirmed causes):');
  console.log(result.categories.length ? result.categories.map(([key,n]) => '  '+key+': '+n).join('\n') : '  none detected');
  console.log('No raw log contents were printed or uploaded. No cloud resources were changed.');
}
if (require.main === module) {
  try {main();} catch(e) {console.error('Private log analysis unavailable: '+e.message);process.exitCode=1;}
}
module.exports={analyze, functionNames, kinds};
