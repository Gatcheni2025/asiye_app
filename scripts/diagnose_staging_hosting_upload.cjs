'use strict';
// READ ONLY. Identify the Firebase Hosting publish failure without exposing
// raw Firebase CLI logs, OAuth tokens, account emails, URLs, or file hashes.
// No resource writes. Target project is intentionally hard-coded.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const SITE='asiye-paystack-staging';
const LOG='asiye-staging-hosting.1792606731290.log';
function gcloud(args){
 const p=spawnSync('gcloud',args,{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
 if(p.status!==0||p.error)throw Error('Staging gcloud project validation or token read failed (details withheld).');
 return p.stdout.trim();
}
function pathToLog(input){
 const b=input||LOG;
 if(!/^asiye-staging-hosting\.[0-9]+\.log$/.test(b))throw Error('Expected a private staging Hosting log basename.');
 const p=fs.realpathSync(path.join(os.homedir(),b));
 if(path.dirname(p)!==os.homedir()||!fs.statSync(p).isFile()||fs.statSync(p).size>30000000)
  throw Error('Unexpected private staging log path or size.');
 return p;
}
function inspectLog(raw){
 const lines=String(raw).split(/\r?\n/);
 const categories=[
  ['PERMISSION_DENIED',/(?:PERMISSION_DENIED|permission denied|access denied|not authorized|does not have permission|insufficient permissions)/i],
  ['AUTH_EXPIRED_OR_INVALID',/(?:UNAUTHENTICATED|invalid credentials|login required|expired.*(?:token|credential)|unauthorized)/i],
  ['FIREBASE_API_DISABLED',/(?:SERVICE_DISABLED|firebasehosting.googleapis.com.*(?:not enabled|disabled))/i],
  ['QUOTA_OR_THROTTLE',/(?:RESOURCE_EXHAUSTED|quota exceeded|rate limit|too many requests)/i],
  ['FILE_SIZE_OR_TYPE',/(?:payload too large|file.*too large|unsupported file|cannot (?:upload|store) executable)/i],
  ['NETWORK_OR_TIMEOUT',/(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error|deadline exceeded)/i],
  ['UPLOAD_FAILED',/(?:upload(?:ing)?\s+(?:new\s+)?files?.*(?:fail|error)|failed to upload|upload.*failed)/i],
  ['MISSING_SITE',/(?:no default (?:hosting )?site|site does not exist|site not found)/i],
  ['CLI_ERROR_MARKER',/(?:^\s*(?:\[[^\]]+\]\s*)?Error:|FirebaseError:)/i]
 ];
 const stages=[
  ['VERSION_CREATE',/(?:versions(?:\/|:|\.create)|creating new version|created version|version created)/i],
  ['POPULATE_FILES',/(?:populateFiles|populating files|populat(?:e|ing).*file)/i],
  ['FILE_UPLOAD',/(?:upload-firebasehosting.googleapis.com|uploading files|uploading new files|failed to upload|upload.*(?:error|fail))/i],
  ['FINALIZE_VERSION',/(?:finaliz(?:e|ing|ed).*version|versions\.patch|status.*FINALIZED)/i],
  ['RELEASE_CREATE',/(?:releases(?:\/|:|\.create)|creating release|release to hosting|release.*fail)/i]
 ];
 const codes=new Set();
 const counts=new Map();
 const stageSet=new Set();
 let requests=0;
 for(const line of lines){
  for(const [name,rx] of categories)if(rx.test(line))counts.set(name,(counts.get(name)||0)+1);
  for(const [name,rx] of stages)if(rx.test(line))stageSet.add(name);
  if(/HTTP Error|response\s+status|statusCode|<<<.*(?:POST|GET|PATCH)|(?:HTTP\/[12](?:\.[01])?)\s+[1-5]\d\d/i.test(line)){
    for(const m of line.matchAll(/\b(400|401|403|404|409|413|429|500|502|503|504)\b/g))codes.add(m[1]);
  }
  if(/>>>|<<<|firebasehosting.googleapis.com|upload-firebasehosting.googleapis.com/.test(line))requests++;
 }
 return {
  lineCount:lines.length,
  errorCategories:[...counts].sort((a,b)=>a[0].localeCompare(b[0])),
  stagesObserved:[...stageSet],
  httpCodes:[...codes].sort(),
  protocolMarkers:requests
 };
}
async function getJson(url,token){
 try{
  const r=await fetch(url,{method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+token,'x-goog-user-project':PROJECT},
    signal:AbortSignal.timeout(30000)});
  if(!r.ok)return {ok:false,status:r.status};
  return {ok:true,data:await r.json()};
 }catch(_){return {ok:false,status:'NETWORK'};}
}
function versionSummary(response){
 const versions=Array.isArray(response?.versions)?response.versions:[];
 const statuses=['CREATED','FINALIZED','DELETED','EXPIRED','CLONING','VERSION_STATUS_UNSPECIFIED'];
 const filtered=versions.filter(v=>String(v.name||'').startsWith('sites/'+SITE+'/versions/'));
 return {
  count:filtered.length,
  states:filtered.slice(0,10).map(v=>statuses.includes(v.status)?v.status:'OTHER'),
  latestTime:filtered.length?filtered.map(v=>String(v.createTime||'')).sort().at(-1).slice(0,19)+'Z':'NONE',
  paginated:!!response?.nextPageToken
 };
}
async function main(){
 if(process.argv.length>3)throw Error('Usage: node scripts/diagnose_staging_hosting_upload.cjs [log-basename]');
 if(gcloud(['config','get-value','project'])!==PROJECT||
    gcloud(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
  throw Error('BLOCKED: wrong project.');
 const report=inspectLog(fs.readFileSync(pathToLog(process.argv[2]),'utf8'));
 console.log('Asiye Hosting upload diagnostic — READ ONLY');
 console.log('Project: '+PROJECT+' | site: '+SITE);
 console.log('Private CLI log lines: '+report.lineCount);
 console.log('HTTP codes: '+(report.httpCodes.join(', ')||'NOT_DETECTED'));
 console.log('Log error categories: '+(report.errorCategories.map(([k,v])=>k+'='+v).join(', ')||'NONE_DETECTED'));
 console.log('Deployment stages mentioned: '+(report.stagesObserved.join(', ')||'NONE_DETECTED'));
 console.log('HTTP/API markers seen: '+report.protocolMarkers);
 let token=gcloud(['auth','print-access-token']);
 try{
  const result=await getJson('https://firebasehosting.googleapis.com/v1beta1/sites/'+SITE+'/versions?pageSize=10',token);
  if(!result.ok){console.log('Hosting versions list: HTTP_'+result.status+' (response withheld)');return;}
  const s=versionSummary(result.data);
  console.log('Visible Hosting versions: '+s.count+(s.paginated?' (more pages exist)':''));
  console.log('Version states (newest request page): '+(s.states.join(', ')||'NONE'));
  console.log('Latest version creation time: '+s.latestTime);
  console.log('No Hosting resources, IAM permissions, Functions, secrets or payments were changed.');
 }finally{token='';}
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={inspectLog,versionSummary};
