'use strict';
// READ ONLY — confirm exact RTDB instance location and classify the existing
// continueGoAfterPayment creation failure. Never print raw error messages,
// OAuth credentials, service account emails, request bodies or operation IDs.
const {spawnSync} = require('node:child_process');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const REGION='us-central1';
const INSTANCE='asiye-paystack-staging-default-rtdb';
const FUNCTION='continueGoAfterPayment';
function cmd(args){
  const x=spawnSync('gcloud',args,{encoding:'utf8',timeout:50000,maxBuffer:1024*1024});
  if(x.status!==0||x.error)throw Error('Staging project or identity read unavailable (details withheld)');
  return (x.stdout||'').trim();
}
function reasons(message){
  const s=String(message||'');
  const matches=[
    ['ACT_AS_PERMISSION',/iam\.serviceAccounts\.actAs|permission\s+["']?iam\.serviceAccounts\.actAs/i],
    ['EVENTARC_EVENT_RECEIVER',/roles\/eventarc\.eventReceiver|eventarc\.events\.receiveEvent/i],
    ['EVENTARC_SERVICE_AGENT',/roles\/eventarc\.serviceAgent|eventarc service agent/i],
    ['GCF_SERVICE_AGENT',/roles\/cloudfunctions\.serviceAgent|cloud functions service agent|gcf-admin-robot/i],
    ['RTDB_SOURCE_LOCATION',/(?:database|instance|firebase).{0,90}(?:region|location).{0,90}(?:not found|does not exist|mismatch|different|invalid)|(?:database|instance|firebase).{0,90}(?:not found|does not exist|mismatch).{0,90}(?:region|location)|(?:region|location).{0,90}(?:database|instance).{0,90}(?:not found|does not exist|mismatch|different|invalid)/i],
    ['RTDB_SOURCE_MISSING',/(?:database instance|realtime database|rtdb).{0,90}(?:not found|does not exist|missing)/i],
    ['EVENTARC_TRIGGER',/eventarc|event trigger|trigger validation/i],
    ['PUBSUB_PREREQUISITE',/pubsub|pub\/sub/i],
    ['API_DISABLED',/service_disabled|api.{0,55}(?:disabled|not enabled)/i],
    ['PERMISSION_DENIED',/permission.denied|permission denied|not authorized|insufficient permission|iam/i],
    ['QUOTA',/resource_exhausted|quota|429/i]
  ].filter(([_,rx])=>rx.test(s)).map(([name])=>name);
  return matches.length?matches:['UNCLASSIFIED'];
}
function summarizeOperation(entry){
  const detail=entry?.error||{};
  const text=String(detail.message||'')+' '+String(entry?.metadata?.statusDetail||'');
  const code=Number.isInteger(detail.code)?detail.code:'unknown';
  return {code,category:reasons(text),completed:entry.done===true};
}
// Never expose an API response body. A failing RTDB metadata endpoint must
// not prevent inspection of the already-recorded Cloud Functions operation.
async function readOnlyGet(url,token) {
  try {
    const response=await fetch(url,{
      method:'GET',
      headers:{Authorization:'Bearer '+token,'x-goog-user-project':PROJECT},
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!response.ok)return {ok:false,status:response.status};
    return {ok:true,status:200,data:await response.json()};
  }catch(_){
    return {ok:false,status:'NETWORK_ERROR'};
  }
}
function validInstance(input) {
  const n=String(input?.name||'');
  const m=n.match(/^projects\/(\d+)\/locations\/([a-z0-9-]+)\/instances\/([a-z0-9-]+)$/);
  if(!m||m[1]!==NUMBER||m[3]!==INSTANCE)return null;
  return {location:m[2],state:['ACTIVE','DISABLED','DELETED'].includes(input.state)?input.state:'OTHER'};
}
async function databaseMetadata(token) {
  const get='https://firebasedatabase.googleapis.com/v1beta/projects/-/locations/-/instances/'+INSTANCE;
  const result=await readOnlyGet(get,token);
  if(result.ok){
    const item=validInstance(result.data);
    if(item)return {found:true,...item,source:'GET'};
    return {found:false,reason:'UNEXPECTED_RESPONSE'};
  }
  // Documented list-across-all-regions method. It sometimes works when the
  // single-instance wildcard GET encounters a transient backend error.
  const list='https://firebasedatabase.googleapis.com/v1beta/projects/'+NUMBER+'/locations/-/instances';
  const fallback=await readOnlyGet(list,token);
  if(fallback.ok){
    const items=Array.isArray(fallback.data.instances)?fallback.data.instances:[];
    const match=items.map(validInstance).filter(Boolean);
    if(match.length===1 && !fallback.data.nextPageToken){
      return {found:true,...match[0],source:'LIST_FALLBACK'};
    }
    return {found:false,reason:match.length===0?'INSTANCE_NOT_RETURNED':'AMBIGUOUS_OR_PAGINATED'};
  }
  return {found:false,reason:'GET_HTTP_'+result.status+'; LIST_HTTP_'+fallback.status};
}
async function operationMetadata(token) {
  const operations=[];
  let next='';
  for(let i=0;i<5;i++){
    const u=new URL('https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+'/locations/'+REGION+'/operations');
    u.searchParams.set('pageSize','100');
    if(next)u.searchParams.set('pageToken',next);
    const response=await readOnlyGet(u.toString(),token);
    if(!response.ok)return {ok:false,status:response.status};
    const result=response.data;
    if(!Array.isArray(result.operations))return {ok:false,status:'UNEXPECTED_RESPONSE'};
    operations.push(...result.operations);
    next=String(result.nextPageToken||'');
    if(!next)break;
  }
  const target='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+FUNCTION;
  const matches=operations.filter(x=>String(x.metadata?.target||'')===target)
    .sort((a,b)=>String(b.metadata?.createTime||'').localeCompare(String(a.metadata?.createTime||'')));
  return {ok:true,matches,paginated:!!next};
}
async function main(){
  if(cmd(['config','get-value','project'])!==PROJECT||
     cmd(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)throw Error('BLOCKED: wrong project.');
  let token=cmd(['auth','print-access-token']);
  try{
    console.log('Asiye staging RTDB event-trigger diagnosis — READ ONLY');
    console.log('Project: '+PROJECT+' | function: '+FUNCTION+' | region: '+REGION);
    // Operations are queried FIRST, independently from RTDB metadata availability.
    const operations=await operationMetadata(token);
    if(operations.ok){
      console.log('Matching Cloud Functions operations: '+operations.matches.length);
      for(const op of operations.matches.slice(0,5)){
        const summary=summarizeOperation(op);
        const t=String(op.metadata?.createTime||'');
        const stamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t)?t.slice(0,19)+'Z':'unknown';
        console.log('Operation '+stamp+' | completed: '+summary.completed+
          ' | gRPC: '+summary.code+' | categories: '+summary.category.join(', '));
        if(summary.code===9)console.log('gRPC 9 = FAILED_PRECONDITION; permission details are not yet confirmed.');
      }
      if(operations.paginated)console.log('Operation listing pagination limit reached; older operations may be missing.');
    }else{
      console.log('Cloud Functions operations unavailable: '+operations.status+' (no raw response exposed)');
    }
    const database=await databaseMetadata(token);
    if(database.found){
      console.log('RTDB instance: '+INSTANCE+' | state: '+database.state);
      console.log('Database region: '+database.location+' | region compatibility: '+
        (database.location===REGION?'MATCH':'MISMATCH — review trigger location'));
      console.log('Metadata source: '+database.source);
    }else{
      console.log('Database metadata unavailable: '+database.reason);
      console.log('RTDB location is UNVERIFIED; do not infer a mismatch.');
    }
    console.log('No database writes, IAM changes, or function deployments were attempted.');
  }finally{token='';}
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={reasons,summarizeOperation};
