'use strict';
// GET-only inspection of this release's private diagnostics. No raw log output.
const {spawnSync}=require('node:child_process');
const {analyze}=require('./diagnose_paystack_deploy_log.cjs');
const {FUNCTIONS}=require('./production_release_scope.cjs');
const {PROJECT,NUMBER}=require('./production_card_preflight.cjs');
const BUCKET='gcf-v2-sources-531902350858-us-central1';
const RELEASE_SOURCE='7a8a81ebd4c7567e03e5afdb6cb81d082e58bf19';
function classify(raw){
 const patterns=[
  ['TRIGGER_CHANGE',/cannot.{0,80}chang.{0,80}trigger|trigger.{0,80}cannot.{0,80}chang/i],
  ['GENERATION_CHANGE',/cannot.{0,80}(?:generation|1st gen|2nd gen)|upgrad.{0,80}(?:1st gen|2nd gen)/i],
  ['ACT_AS_PERMISSION',/iam\.serviceAccounts\.actAs/],
  ['CLOUD_BUILD_PERMISSIONS',/cloudbuild\.builds\.(?:create|get)|cloud build service account.{0,100}(?:permission|denied)|build.{0,100}service account.{0,100}(?:missing|permission|denied)/i],
  ['SOURCE_PERMISSIONS',/storage\.objects\.(?:get|create)|cloudfunctions\.functions\.sourceCodeGet/],
  ['ARTIFACT_PERMISSIONS',/artifactregistry\.[A-Za-z.]+|artifact.{0,80}permission denied/i],
  ['UNSUPPORTED_RUNTIME',/(?:unsupported|not supported|not available).{0,60}nodejs22|nodejs22.{0,60}(?:unsupported|not supported)/i],
  ['SECRET_ACCESS',/(?:secretmanager|secret).{0,100}(?:permission|denied|not found)/i],
  ['TRIGGER_VALIDATION',/trigger validation|eventarc|invalid.{0,60}event trigger/i],
  ['ORG_POLICY',/org.?policy|constraint\.[A-Za-z.]+|organization policy/i],
  ['NPM_DEPENDENCY',/cannot find module|MODULE_NOT_FOUND|npm ERR!/i],
  ['BUILD_ERROR',/build failed|build status.{0,30}FAILURE|build error/i],
  ['QUOTA',/RESOURCE_EXHAUSTED|quota.{0,80}(?:exceeded|limit)|429/],
  ['FUNCTION_BUSY',/operation.{0,70}progress|409.{0,70}conflict|already exists/i]
 ];
 const permissionNames=[...new Set(raw.match(/\b(?:cloudfunctions\.functions|cloudbuild\.builds|storage\.objects|iam\.serviceAccounts|run\.services|artifactregistry\.repositories)\.[A-Za-z]+/g)||[])];
 return {summary:analyze(raw),categories:patterns.filter(([_,rx])=>rx.test(raw)).map(([key])=>key),permissionNames};
}
async function main(){
 const run=args=>{const r=spawnSync('gcloud',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(r.status!==0||r.error)throw Error('CLOUD_READ_UNAVAILABLE');return r.stdout.trim();};
 if(run(['config','get-value','project'])!==PROJECT||run(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)throw Error('PROJECT_MISMATCH');
 const get=async(url,json=true)=>{
  const r=await fetch(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+run(['auth','print-access-token'])},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('PRIVATE_READ_HTTP_'+r.status);
  const text=await r.text();if(text.length>30*1024*1024)throw Error('PRIVATE_LOG_SIZE_LIMIT');return json?JSON.parse(text):text;
 };
 const index=await get('https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o?'+new URLSearchParams({prefix:'asiye-release-backups/'+RELEASE_SOURCE+'/',maxResults:'1000'}));
 const states=(index.items||[]).filter(o=>o.name.endsWith('/state.json')).sort((a,b)=>String(b.timeCreated||'').localeCompare(String(a.timeCreated||'')));
 if(!states.length)throw Error('CURRENT_RELEASE_PRIVATE_BACKUP_NOT_FOUND');
 const PREFIX=states[0].name.replace(/state\.json$/,'private-diagnostics/');
 const objects=await get('https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o?'+new URLSearchParams({prefix:PREFIX,maxResults:'100'}));
 console.log('PRIVATE_DIAGNOSTIC_OBJECT_COUNT='+(objects.items||[]).length);
 const parent=PREFIX.replace(/private-diagnostics\/$/,'');
 const saved=await get('https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o?'+new URLSearchParams({prefix:parent,maxResults:'1000'}));
 console.log('PRIVATE_BACKUP_CHECK='+JSON.stringify({objects:(saved.items||[]).length,stateSaved:(saved.items||[]).some(o=>o.name===parent+'state.json'),sourceArchives:(saved.items||[]).filter(o=>o.name.endsWith('.archive')).length}));
 for(const object of objects.items||[]){
  if(!object.name.startsWith(PREFIX)||!object.name.endsWith('.log'))continue;
  const raw=await get('https://storage.googleapis.com/storage/v1/b/'+BUCKET+'/o/'+encodeURIComponent(object.name)+'?alt=media',false);
  console.log('PRIVATE_LOG_DIAGNOSIS='+JSON.stringify(classify(raw)));
 }
 const functions=await get('https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+'/locations/us-central1/functions?pageSize=1000');
 console.log('CURRENT_SELECTED_FUNCTION_STATES='+JSON.stringify((functions.functions||[]).filter(f=>FUNCTIONS.includes(f.name.split('/').pop())).map(f=>({
  name:f.name.split('/').pop(),state:f.state||'UNKNOWN',errorCategories:(f.stateMessages||[]).flatMap(m=>classify(String(m.message||'')).categories)}))));
 const payoutKeys=await get('https://asiye-80386-default-rtdb.firebaseio.com/driverPaystackSubaccounts.json?shallow=true');
 console.log('PRODUCTION_DRIVER_PAYOUT_PROFILE_COUNT='+Object.keys(payoutKeys||{}).length);
 console.log('GET-only. No private log lines, identities, keys or API response bodies printed.');
}
if(require.main===module)main().catch(e=>{console.error('PRODUCTION_DIAGNOSIS: '+(/^[A-Z0-9_]+$/.test(e.message)?e.message:'READ_UNAVAILABLE'));process.exitCode=2;});
module.exports={classify};
