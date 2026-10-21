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
async function request(url,token){
  const response=await fetch(url,{
    headers:{Authorization:'Bearer '+token,'x-goog-user-project':PROJECT},
    redirect:'error',signal:AbortSignal.timeout(30000)
  });
  if(!response.ok)throw Error('Read-only Google API call returned HTTP '+response.status+'; response body withheld.');
  return response.json();
}
async function main(){
  if(cmd(['config','get-value','project'])!==PROJECT||
     cmd(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)throw Error('BLOCKED: wrong project.');
  let token=cmd(['auth','print-access-token']);
  try{
    const url='https://firebasedatabase.googleapis.com/v1beta/projects/-/locations/-/instances/'+INSTANCE;
    const instance=await request(url,token);
    const full=String(instance.name||'');
    const m=full.match(/^projects\/(\d+)\/locations\/([a-z0-9-]+)\/instances\/([a-z0-9-]+)$/);
    if(!m||m[1]!==NUMBER||m[3]!==INSTANCE)throw Error('Instance metadata does not match reviewed staging project (raw response withheld).');
    const dbRegion=m[2];
    console.log('Asiye staging RTDB trigger prerequisite — READ ONLY');
    console.log('Staging database location: '+dbRegion+' | function region: '+REGION);
    console.log('Region compatibility: '+(dbRegion===REGION?'MATCH':'MISMATCH — do not retry until reviewed'));
    console.log('Database state: '+(['ACTIVE','DISABLED','DELETED'].includes(instance.state)?instance.state:'OTHER'));
    const operations=[];
    let next='';
    for(let i=0;i<5;i++){
      const u=new URL('https://cloudfunctions.googleapis.com/v2/projects/'+PROJECT+'/locations/'+REGION+'/operations');
      u.searchParams.set('pageSize','100');
      if(next)u.searchParams.set('pageToken',next);
      const result=await request(u.toString(),token);
      operations.push(...(Array.isArray(result.operations)?result.operations:[]));
      next=String(result.nextPageToken||'');
      if(!next)break;
    }
    const matches=operations.filter(x=>{
      const target=String(x.metadata?.target||'');
      return target==='projects/'+PROJECT+'/locations/'+REGION+'/functions/'+FUNCTION;
    }).sort((a,b)=>String(b.metadata?.createTime||'').localeCompare(String(a.metadata?.createTime||'')));
    console.log('Matching function operations: '+matches.length);
    for(const op of matches.slice(0,5)){
      const s=summarizeOperation(op);
      const t=String(op.metadata?.createTime||'');
      console.log('Time: '+(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(t)?t.slice(0,19)+'Z':'unknown')+
        ' | completed: '+s.completed+' | gRPC: '+s.code+' | categories: '+s.category.join(', '));
    }
    if(!matches.length)console.log('No matching operation visible. Absence of evidence does not prove success.');
    console.log('Read-only: no database writes, roles, secrets or functions were modified.');
  }finally{token='';}
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={reasons,summarizeOperation};
