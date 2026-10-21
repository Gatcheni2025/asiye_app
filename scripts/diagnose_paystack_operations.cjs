'use strict';
// Read-only: inspect Cloud Functions V2 long-running deployment operations.
// Never print OAuth tokens, raw operation metadata, IAM identities, error messages,
// request payloads, user data, secret values, or operation resource IDs.
const {spawnSync} = require('node:child_process');
const manifest = require('./paystack_function_manifest.json');
const PROJECT = 'asiye-paystack-staging';
const NUMBER = '1000800408896';
const REGION = 'us-central1';
const SINCE = '2026-10-21T10:00:00Z';
function gcloud(args) {
  const p=spawnSync('gcloud',args,{encoding:'utf8',timeout:50000,maxBuffer:1024*1024});
  if(p.status!==0 || p.error) throw Error('gcloud read failed; verify staging access privately (details withheld)');
  return p.stdout.trim();
}
function reason(msg) {
  if(/permission|denied|iam|forbidden|not authorized|serviceusage/i.test(msg)) return 'IAM_OR_ACCESS';
  if(/quota|exhausted|resource.*limit|429|too many requests/i.test(msg)) return 'QUOTA_OR_RATE_LIMIT';
  if(/timeout|deadline|unavailable|503|connection reset|internal/i.test(msg)) return 'TIMEOUT_OR_SERVICE';
  if(/revision|container|healthcheck|port 8080|cloud run service/i.test(msg)) return 'CLOUD_RUN_STARTUP';
  if(/secretmanager|secret\b/i.test(msg)) return 'SECRET_CONFIGURATION';
  if(/service account.*not found|runtime service account/i.test(msg)) return 'MISSING_RUNTIME_IDENTITY';
  if(/invalid.*(?:config|argument|value)|bad request|400/i.test(msg)) return 'INVALID_CONFIGURATION';
  if(/build failed|cloud build/i.test(msg)) return 'BUILD_FAILED';
  if(/already exists|409|conflict/i.test(msg)) return 'CONFLICT';
  return 'UNCLASSIFIED';
}
function safeVerb(s) {
  const v=String(s||'').toUpperCase();
  return ['CREATE_FUNCTION','UPDATE_FUNCTION','DELETE_FUNCTION','CREATE','UPDATE','DELETE'].includes(v) ? v : 'OTHER';
}
function summarize(items) {
  return items.filter(item=>{
    const stamp=String(item.metadata?.createTime || item.metadata?.create_time || '');
    return stamp >= SINCE && !!item.metadata;
  }).map(item=>{
    const target=String(item.metadata?.target||'');
    const name=target.split('/').pop();
    if(!manifest.includes(name) || !target.includes('projects/'+PROJECT+'/locations/'+REGION+'/functions/')) return null;
    const err=item.error || null;
    const stages=Array.isArray(item.metadata.stages)?item.metadata.stages:[];
    const stageFailed=stages.filter(s=>/ERROR|FAILED/i.test(String(s.state||''))).map(s=>{
      const label=String(s.name || '').toUpperCase();
      return ['ARTIFACT_REGISTRY','BUILD','SERVICE','TRIGGER'].includes(label)?label:'OTHER';
    });
    const n=err?.code;
    const grpc=(typeof n==='number' && Number.isInteger(n))?String(n):
      (typeof n==='string' && /^[A-Z_]+$/.test(n)?n:'unknown');
    return {
      name,createdAt:String(item.metadata.createTime||'').slice(0,19)+'Z',
      verb:safeVerb(item.metadata.verb||item.metadata.operationType),
      state:item.done === true ? err ? 'FAILED' : 'DONE' : 'PENDING',
      grpc,reason:reason(String(err?.message||'')+' '+String(item.metadata.statusDetail||'')),
      stages:stageFailed
    };
  }).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
async function main() {
  if (!Array.isArray(manifest) || manifest.length!==37 || new Set(manifest).size!==37) {
    throw Error('Reviewed manifest mismatch');
  }
  if(gcloud(['config','get-value','project'])!==PROJECT ||
     gcloud(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER){
    throw Error('BLOCKED: only the approved isolated Asiye staging project is permitted');
  }
  let token=gcloud(['auth','print-access-token']);
  const results=[];
  let nextToken='';
  try {
    for(let i=0;i<6;i++){
      const u=new URL('https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+'/locations/'+REGION+'/operations');
      u.searchParams.set('pageSize','100');
      if(nextToken) u.searchParams.set('pageToken',nextToken);
      const response=await fetch(u.toString(),{
        method:'GET',headers:{
          Authorization:'Bearer '+token,
          'x-goog-user-project':PROJECT
        },redirect:'error',signal:AbortSignal.timeout(35000)
      });
      if (!response.ok) {
        console.log('Cloud Functions operation API unavailable: HTTP '+response.status+' (response body withheld)');
        console.log('No resources changed; use the offline log and bounded recovery if this API is unavailable.');
        return;
      }
      const data=await response.json();
      if(!Array.isArray(data.operations)) {
        if(!data.nextPageToken) break;
        throw Error('Unexpected operations response structure');
      }
      results.push(...data.operations);
      nextToken=String(data.nextPageToken||'');
      if(!nextToken)break;
    }
  }finally{token='';}
  const items=summarize(results);
  const failed=items.filter(x=>x.state==='FAILED');
  const waiting=items.filter(x=>x.state==='PENDING');
  const done=items.filter(x=>x.state==='DONE');
  console.log('Asiye Cloud Functions operations — READ ONLY');
  console.log('Project: '+PROJECT+' | region: '+REGION+' | since: '+SINCE);
  console.log('Reviewed deployment operations: '+items.length+' | FAILED: '+failed.length+' | DONE: '+done.length+' | PENDING: '+waiting.length);
  for(const item of failed.slice(0,40)){
    console.log(item.createdAt+' | '+item.name+' | '+item.verb+' | grpc='+item.grpc+' | '+item.reason+' | failed stage='+ (item.stages.join(',')||'not reported'));
  }
  for(const item of waiting.slice(0,15)){
    console.log(item.createdAt+' | '+item.name+' | '+item.verb+' | PENDING');
  }
  if(!items.length) console.log('No matching operations visible. This does not prove deployment success.');
  if(nextToken) console.log('Pagination limit reached; results may be incomplete.');
  console.log('No OAuth token, raw error message or operation ID was printed. No cloud resources were modified.');
}
if(require.main===module) main().catch(e=>{
  console.error('Operation diagnosis incomplete: '+(/fetch failed|timeout|abort/i.test(e.message)?'network read failed':e.message));
  process.exitCode=1;
});
module.exports={summarize,reason};
