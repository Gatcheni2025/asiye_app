'use strict';
// Read-only Cloud Shell diagnosis for the isolated Asiye Paystack project.
// Prints reviewed function names and fixed error categories, never raw logs.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const PROJECT = 'asiye-paystack-staging';
const REGION = 'us-central1';
const NUMBER = '1000800408896';

function command(args) {
  const p = spawnSync('gcloud', args, {encoding:'utf8', timeout:90000, maxBuffer:8*1024*1024});
  if (p.status !== 0 || p.error) {
    const msg = String(p.stderr || '');
    const kind = /permission|denied|403/i.test(msg) ? 'PERMISSION_DENIED' :
      /not found|404/i.test(msg) ? 'NOT_FOUND' :
      /timeout|deadline/i.test(msg) ? 'TIMEOUT' : 'UNKNOWN';
    throw Error('Read-only gcloud command failed: ' + kind + '. Keep full CLI errors private.');
  }
  return p.stdout.trim();
}
function json(args) {
  try { return JSON.parse(command(args)); }
  catch (e) {if (e.message.startsWith('Read-only')) throw e; throw Error('Unexpected JSON from gcloud');}
}
function category(msg) {
  if (/permission|denied|403|iam\.serviceAccounts\.actAs/i.test(msg)) return 'IAM';
  if (/secret|secretmanager/i.test(msg)) return 'SECRET';
  if (/service account.*(?:missing|not found|does not exist)/i.test(msg)) return 'RUNTIME_IDENTITY';
  if (/revision.*(?:fail|not ready)|container.*(?:fail|start)|health check/i.test(msg)) return 'RUN_STARTUP';
  if (/quota|exhausted|429/i.test(msg)) return 'QUOTA';
  if (/billing/i.test(msg)) return 'BILLING';
  if (/build.*fail/i.test(msg)) return 'BUILD';
  if (/timeout|deadline/i.test(msg)) return 'TIMEOUT';
  return 'UNCLASSIFIED';
}
function main() {
  if (command(['config','get-value','project']) !== PROJECT ||
      command(['projects','describe',PROJECT,'--format=value(projectNumber)']) !== NUMBER) {
    throw Error('BLOCKED: gcloud must target isolated staging project ' + PROJECT + ' (' + NUMBER + ')');
  }
  const names = JSON.parse(fs.readFileSync(path.join(__dirname,'paystack_function_manifest.json'),'utf8'));
  if (!Array.isArray(names) || names.length !== 37 ||
      new Set(names).size !== 37 || names.some(n=>typeof n !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(n))) {
    throw Error('Unexpected reviewed function manifest');
  }
  console.log('Asiye isolated staging: READ ONLY | ' + REGION);
  const functions = json(['functions','list','--v2','--regions='+REGION,'--project='+PROJECT,'--format=json']);
  if (!Array.isArray(functions)) throw Error('Expected a Functions array');
  const found = new Map();
  for (const f of functions) {
    const full = String(f.name || '');
    if (full.includes('/locations/') && !full.includes('/locations/'+REGION+'/')) continue;
    const name = full.split('/').pop();
    if (names.includes(name)) found.set(name, String(f.state || 'UNKNOWN').toUpperCase());
  }
  const active = names.filter(n=>found.get(n)==='ACTIVE');
  const missing = names.filter(n=>!found.has(n));
  const nonactive = names.filter(n=>found.has(n) && found.get(n)!=='ACTIVE');
  console.log('EXPECTED='+names.length+' ACTIVE='+active.length+' MISSING='+missing.length+' PRESENT_NONACTIVE='+nonactive.length);
  console.log('ACTIVE: '+(active.join(', ')||'none'));
  console.log('MISSING: '+(missing.join(', ')||'none'));
  console.log('NONACTIVE: '+(nonactive.map(n=>n+'='+found.get(n)).join(', ')||'none'));
  const filter = 'timestamp>="2026-10-21T10:00:00Z" AND (protoPayload.serviceName="cloudfunctions.googleapis.com" OR protoPayload.serviceName="run.googleapis.com") AND (severity>=ERROR OR protoPayload.status.code>0)';
  try {
    const logs = json(['logging','read',filter,'--project='+PROJECT,'--limit=100','--order=desc','--format=json']);
    if (!Array.isArray(logs)) throw Error('Unexpected audit result');
    console.log('AUDIT ERROR SUMMARY (max 25; no raw messages):');
    if (!logs.length) console.log('No matching logs visible. This does not prove success.');
    for (const entry of logs.slice(0,25)) {
      const p = entry.protoPayload || {};
      const labels = entry.resource && entry.resource.labels || {};
      const resource = [p.resourceName,labels.function_name,labels.service_name].filter(Boolean).join(' ');
      const name = names.find(n=>resource===n || resource.includes('/'+n) || resource.includes(' '+n) || resource.toLowerCase().includes(n.toLowerCase()+'-')) || 'unresolved';
      const method = String(p.methodName||'');
      const action = /Create(Function|Service)/.test(method)?'CREATE':/Update(Function|Service)/.test(method)?'UPDATE':/SetIamPolicy/.test(method)?'IAM_WRITE':'OTHER';
      const service = p.serviceName==='run.googleapis.com'?'RUN':'FUNCTIONS';
      const status = p.status || {};
      const code = Number.isInteger(status.code)?status.code:'unknown';
      const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(entry.timestamp||'')?entry.timestamp.slice(0,19)+'Z':'unknown';
      console.log(time+' '+service+' '+action+' '+name+' gRPC='+code+' '+category(String(status.message||'')+' '+String(entry.textPayload||'')));
    }
    if (logs.length===100) console.log('Audit limit reached; older events are not included.');
  } catch (err) {
    console.log('Audit read unavailable: '+(err.message.startsWith('Read-only')?err.message:'unexpected response'));
  }
  console.log('No deployment, IAM, secrets, rules, billing or payment changes made.');
}
try {main();} catch(e) {console.error(e.message);process.exitCode=1;}
