'use strict';
// Read-only staging Firebase Hosting diagnosis, including the October 2026
// default Hosting site provisioning change. No log bodies or credentials output.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const EXPECTED_SITE='asiye-paystack-staging';
const DEFAULT_LOG='asiye-staging-hosting.1792606731290.log';
function gc(args) {
  const r=spawnSync('gcloud',args,{encoding:'utf8',timeout:40000,maxBuffer:1024*1024});
  if(r.error||r.status!==0)throw Error('Staging project verification failed (private details withheld).');
  return r.stdout.trim();
}
function safeLogPath(arg) {
  const requested=String(arg||DEFAULT_LOG);
  if(!/^asiye-staging-hosting\.[A-Za-z0-9]+\.log$/.test(requested))
    throw Error('Specify the basename of a private staging Hosting log only.');
  const real=fs.realpathSync(path.join(os.homedir(),requested));
  if(path.dirname(real)!==os.homedir() || !fs.statSync(real).isFile() ||
    fs.statSync(real).size>30*1024*1024)throw Error('Private Hosting log location or size is not allowed.');
  return real;
}
function logCategories(raw) {
  const patterns=[
    ['DEFAULT_SITE_ABSENT',/(?:no default (?:hosting )?site|default (?:hosting )?site.*(?:does not exist|not found|missing)|cannot find.*(?:hosting )?site)/i],
    ['HOSTING_SITE_NOT_FOUND',/(?:site|hosting).*?(?:not found|does not exist|404|not initialized)|\bHTTP Error:\s*404\b/i],
    ['HOSTING_API_DENIED',/firebasehosting.googleapis.com.{0,90}(?:403|permission)|permission denied|insufficient permission|\bHTTP Error:\s*403\b/i],
    ['HOSTING_API_DISABLED',/firebasehosting.googleapis.com.{0,60}disabled|service_disabled|firebase hosting api.*(?:not enabled|disabled)/i],
    ['HOSTING_QUOTA',/\b429\b|RESOURCE_EXHAUSTED|quota exceeded/i],
    ['HOSTING_NETWORK',/ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network error|fetch failed/i],
    ['HOSTING_UPLOAD_ERROR',/upload.*(?:failed|error)|failed.*upload|files.*missing/i],
    ['HOSTING_RELEASE_ERROR',/release.*(?:failed|error)|failed.*release|version.*(?:failed|error)/i],
    ['CLI_ERROR_MARKER',/(?:^|\s)FirebaseError:|^\s*Error:/i]
  ];
  const counts=Object.fromEntries(patterns.map(([s])=>[s,0]));
  const lines=String(raw).split(/\r?\n/);
  for(const line of lines.slice(-350))
    for(const [name,rx] of patterns)if(rx.test(line))counts[name]++;
  return {lines:lines.length,classes:Object.entries(counts).filter(([,n])=>n>0)};
}
function classifySites(sites) {
  if(!Array.isArray(sites))throw Error('Unexpected Hosting site listing.');
  const found=[];
  for(const s of sites) {
    const id=String(s.name||'').split('/').pop();
    const type=String(s.type||'');
    if(!/^[a-z0-9-]{4,63}$/.test(id))continue;
    if(!['DEFAULT_SITE','USER_SITE'].includes(type))continue;
    found.push({id,type});
  }
  const defaultSite=found.find(x=>x.type==='DEFAULT_SITE')||null;
  return {sites:found,defaultSite};
}
async function api(url,token) {
  try{
    const res=await fetch(url,{
      method:'GET',
      headers:{Authorization:'Bearer '+token,'x-goog-user-project':PROJECT},
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!res.ok)return {ok:false,status:res.status};
    return {ok:true,status:200,data:await res.json()};
  }catch(_){return {ok:false,status:'NETWORK'};}
}
async function main(){
  if(process.argv.length>3)throw Error('Usage: node scripts/diagnose_paystack_hosting.cjs [private-log-basename]');
  if(gc(['config','get-value','project'])!==PROJECT ||
     gc(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
    throw Error('BLOCKED: wrong project; no queries performed.');
  console.log('Asiye TEST staging Hosting diagnosis — READ ONLY');
  console.log('Project='+PROJECT+' | projectNumber='+NUMBER);
  try{
    const classified=logCategories(fs.readFileSync(safeLogPath(process.argv[2]),'utf8'));
    console.log('Private CLI log lines='+classified.lines);
    console.log('CLI categories: '+(classified.classes.map(([n,c])=>n+'='+c).join(', ')||'none detected'));
  }catch(_){console.log('Private CLI log unavailable; diagnosis continues.');}
  let token=gc(['auth','print-access-token']);
  try{
    const response=await api('https://firebasehosting.googleapis.com/v1beta1/projects/'+PROJECT+'/sites?pageSize=100',token);
    if(!response.ok) {
      console.log('Hosting sites API: HTTP_'+response.status+' (body withheld)');
      console.log('Check firebasehosting.googleapis.com API enablement/access privately. No assumptions about existing sites.');
      return;
    }
    const data=response.data;
    if(data.nextPageToken){
      console.log('Hosting site list is paginated; cannot conclusively identify default site. Stop.');
      return;
    }
    const sites=classifySites(data.sites||[]);
    console.log('Visible Hosting sites='+sites.sites.length);
    console.log('Default Hosting site='+ (sites.defaultSite?.id||'MISSING'));
    console.log('Default site matches expected web.app domain='+
      (sites.defaultSite?String(sites.defaultSite.id===EXPECTED_SITE):'N/A'));
    if(!sites.defaultSite){
      console.log('NEXT: create the default Hosting site in STAGING only, after explicit approval; no site creation attempted here.');
      return;
    }
    const id=sites.defaultSite.id;
    const releases=await api('https://firebasehosting.googleapis.com/v1beta1/sites/'+encodeURIComponent(id)+'/releases?pageSize=10',token);
    if(!releases.ok){
      console.log('Hosting release list: HTTP_'+releases.status+' (body withheld)');
      return;
    }
    const records=Array.isArray(releases.data.releases)?releases.data.releases:[];
    const latest=records.filter(x=>String(x.name||'').startsWith('sites/'+id+'/releases/'))
      .sort((a,b)=>String(b.releaseTime||'').localeCompare(String(a.releaseTime||'')));
    console.log('Hosting releases visible='+records.length);
    console.log('Latest release timestamp='+
      (latest.length&&/^\d{4}-\d\d-\d\dT/.test(String(latest[0].releaseTime))?
        String(latest[0].releaseTime).slice(0,19)+'Z':'NONE'));
    console.log('Expected staging hostname=https://'+id+'.web.app');
    console.log('No hosting, IAM, functions, secrets or payment settings were changed.');
  }finally{token='';}
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={classifySites,logCategories};
