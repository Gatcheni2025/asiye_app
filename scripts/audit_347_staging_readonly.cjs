'use strict';
// Asiye isolated staging release audit — READ ONLY.
// Never writes Firebase/Paystack resources, touches production or displays tokens.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const PROJECT='asiye-paystack-staging',NUMBER='1000800408896',REGION='us-central1';
const FILES=[
  'admin/index.html', 'admin/auth.js', 'admin/console.js', 'admin/console.css', 'admin/redirect.js', 'admin-login.html', 'admin.html', 'create-admin.html',
  'passenger-v2/index.html', 'passenger-v2/js/app.js', 'passenger-v2/js/profile.js', 'passenger-v2/js/onboarding.js', 'passenger-v2/css/booking-face.css',
  'passenger-v2/login.html',
  'passenger-v2/js/login.js',
  'passenger-v2/js/firebase.js',
  'driver-v2/login.html', 'driver-v2/enrollment.html',
  'driver-v2/js/login.js', 'driver-v2/js/enrollment.js', 'driver-v2/js/enrollment-gate.js',
  'driver-v2/js/firebase.js',
  'passenger-v2/css/login.css',
  'native-auth-session.js',
  'passenger-v2/js/booking.js',
  'passenger-v2/js/ride-controller.js',
  'passenger-v2/js/wallet.js',
  'passenger-v2/js/club.js',
  'passenger-v2/js/parcels.js',
  'driver-v2/js/requests.js',
  'driver-v2/index.html', 'driver-v2/js/app.js', 'driver-v2/js/map.js',
  'driver-v2/js/location.js', 'driver-v2/css/app.css',
  'passenger-v2/css/app.css', 'member-pages.js', 'member-pages.css',
  'driver-v2/js/trip-controller.js',
  'club-live.js',
  'payment-status.html'
];
function canonical(data){
  if(Array.isArray(data))return data.map(canonical);
  if(data && typeof data==='object')
    return Object.fromEntries(Object.keys(data).sort().map(k=>[k,canonical(data[k])]));
  return data;
}
function hash(data){
  return crypto.createHash('sha256').update(typeof data==='string'?data:JSON.stringify(canonical(data))).digest('hex');
}
function gcloud(args, timeout=90000){
  const p=spawnSync('gcloud',args,{encoding:'utf8',timeout,maxBuffer:12*1024*1024});
  if(p.status!==0||p.error)throw Error('GCLOUD_READ_FAILED');
  return p.stdout.trim();
}
function ensureProject(){
  if(gcloud(['config','get-value','project'])!==PROJECT ||
     gcloud(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
    throw Error('STAGING_PROJECT_IDENTITY_MISMATCH');
  const branch=spawnSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'});
  if(branch.status!==0 || branch.stdout.trim()!=='fix/paystack-subaccounts-cash-card-no-wallet')
    throw Error('REVIEW_BRANCH_MISMATCH');
}
function manifest(){
  const names=JSON.parse(fs.readFileSync(path.join(root,'scripts/paystack_function_manifest.json'),'utf8'));
  if(!Array.isArray(names)||names.length!==37||new Set(names).size!==37||
      names.some(n=>typeof n!=='string'||!/^[A-Za-z][A-Za-z0-9]*$/.test(n)))
    throw Error('FUNCTION_MANIFEST_INVALID');
  return [...new Set([...names, ...require('./auth_booking_staging_functions.json'), ...require('./staging_driver_admin_functions.json'), ...require('./staging_vehicle_eligibility_functions.json')])];
}
function functionInventory(names){
  const items=JSON.parse(gcloud(['functions','list','--v2','--regions='+REGION,'--project='+PROJECT,'--format=json']));
  if(!Array.isArray(items))throw Error('FUNCTION_INVENTORY_INVALID');
  const byName=new Map();
  for(const f of items){
    const full=String(f.name||'');
    if(full.includes('/locations/')&&!full.includes('/locations/'+REGION+'/'))continue;
    const short=full.split('/').pop();
    if(names.includes(short))byName.set(short,String(f.state||'UNKNOWN').toUpperCase());
  }
  const active=names.filter(n=>byName.get(n)==='ACTIVE');
  const missing=names.filter(n=>!byName.has(n));
  const nonactive=names.filter(n=>byName.has(n)&&byName.get(n)!=='ACTIVE');
  return {active:active.length,missing,nonactive};
}
function previewConfig(){
  const preview=path.join(root,'staging-preview');
  const js=fs.readFileSync(path.join(preview,'passenger-v2/js/firebase.js'),'utf8');
  const {parseConfig}=require('./rebuild_staging_auth_preview.cjs');
  const cfg=parseConfig(js);
  if(cfg.messagingSenderId!==NUMBER)throw Error('STAGING_WEB_CONFIG_NUMBER_MISMATCH');
  const database=new URL(cfg.databaseURL);
  if(database.protocol!=='https:')throw Error('STAGING_DB_URL_NOT_HTTPS');
  return {preview,database:database.origin};
}
async function get(url,headers={}){
  const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(18000),cache:'no-store'});
  // No raw API response printed. HTTP codes are safe diagnostics.
  if(!r.ok)throw Error('HTTP_'+r.status);
  return r;
}
async function auditRules(database){
  // Google OAuth bearer token stays only in process memory, never console/log.
  let token;
  try{token=gcloud(['auth','print-access-token'],20000);}
  catch(_){return {status:'BLOCKED_TOKEN_UNAVAILABLE'};}
  if(!token)return {status:'BLOCKED_TOKEN_UNAVAILABLE'};
  try{
    const url=database+'/.settings/rules.json';
    const r=await get(url,{Authorization:'Bearer '+token});
    const deployed=await r.json();
    const local=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8'));
    return {status:hash(deployed)===hash(local)?'MATCH':'MISMATCH'};
  }catch(e){return {status:e.message.startsWith('HTTP_')?'BLOCKED_'+e.message:'BLOCKED_READ_FAILED'};}
}
async function auditHosted(preview,config=null){
  const {rewrite,extractProductionWebConfig}=require('./build_staging_web_preview.cjs');
  const prod=config?extractProductionWebConfig(path.join(root,'assets/passenger-v2/js/firebase.js')):null;
  let matched=0,fail=[];
  for(const relative of FILES){
    try{
      const source=fs.readFileSync(path.join(preview,relative),'utf8');
      const local=config?rewrite(source,prod,config):source;
      const r=await get('https://'+PROJECT+'.web.app/'+relative);
      const remote=await r.text();
      if(hash(local)!==hash(remote))throw Error('CONTENT_MISMATCH');
      if(remote.includes('asiye-80386'))throw Error('PRODUCTION_IDENTIFIER_PRESENT');
      if(!(r.headers.get('x-robots-tag')||'').toLowerCase().includes('noindex'))
        throw Error('NOINDEX_MISSING');
      matched++;
    }catch(e){
      const code=/^(?:HTTP_\d{3}|CONTENT_MISMATCH|PRODUCTION_IDENTIFIER_PRESENT|NOINDEX_MISSING)$/.test(e.message)?
        e.message:'NETWORK_OR_READ_FAILURE';
      fail.push(relative+'='+code);
    }
  }
  return {matched,fail};
}
async function auditPublicHosting(){
  // Firebase SDK config is public; validate its pinned project before using
  // it to rewrite reviewed source in memory. No local preview or cloud login.
  const {parseConfig}=require('./rebuild_staging_auth_preview.cjs');
  const response=await get('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js');
  const config=parseConfig(await response.text());
  if(config.messagingSenderId!==NUMBER)throw Error('STAGING_WEB_CONFIG_NUMBER_MISMATCH');
  const hosting=await auditHosted(path.join(root,'assets'),config);
  console.log('PROJECT='+PROJECT+' NUMBER='+NUMBER);
  console.log('STAGING_HOSTED_FILES: MATCH='+hosting.matched+'/'+FILES.length);
  for(const item of hosting.fail)console.log('FILE_CHECK: '+item);
  console.log('STAGING_RTDB_RULES: NOT_CHECKED (authenticated Cloud Shell audit required)');
  console.log('DEPLOYED_FUNCTION_SOURCE_SHA: NOT_ATTESTED');
  console.log('PUBLIC_HOSTING_READBACK: '+(hosting.fail.length?'MISMATCH':'PASS'));
  console.log('No deployments, database writes, customer data reads, IAM changes or payments made.');
  if(hosting.fail.length)process.exitCode=2;
}
async function main(){
  console.log('Asiye 347 isolated staging release audit — READ ONLY');
  if(process.argv[2]==='--hosting-only' && process.argv.length===3)return auditPublicHosting();
  if(process.argv.length!==2)throw Error('AUDIT_ARGUMENT_INVALID');
  ensureProject();
  console.log('PROJECT='+PROJECT+' NUMBER='+NUMBER+' REGION='+REGION);
  const names=manifest();
  const inventory=functionInventory(names);
  console.log('FUNCTIONS: '+inventory.active+'/'+names.length+' ACTIVE | MISSING='+inventory.missing.length+
    ' | NONACTIVE='+inventory.nonactive.length);
  if(inventory.missing.length)console.log('MISSING: '+inventory.missing.join(', '));
  if(inventory.nonactive.length)console.log('NONACTIVE: '+inventory.nonactive.join(', '));
  let preview;
  try{preview=previewConfig();console.log('LOCAL_PREVIEW: STAGING_PROJECT_MATCH');}
  catch(_){console.log('LOCAL_PREVIEW: INVALID_OR_MISSING');process.exitCode=2;return;}
  const [rules,hosting]=await Promise.all([
    auditRules(preview.database),auditHosted(preview.preview)
  ]);
  console.log('STAGING_RTDB_RULES: '+rules.status);
  console.log('STAGING_HOSTED_FILES: MATCH='+hosting.matched+'/'+FILES.length);
  for(const item of hosting.fail)console.log('FILE_CHECK: '+item);
  console.log('DEPLOYED_FUNCTION_SOURCE_SHA: NOT_ATTESTED');
  console.log('PAYSTACK_TEST_CHARGE_WEBHOOK_REFUND: NOT_TESTED');
  console.log('ANDROID_IOS_NATIVE_ACCEPTANCE: NOT_TESTED');
  console.log('PAYSTACK_LIVE: NOT_AUTHORIZED');
  console.log('No deployments, database writes, customer data reads, IAM changes or payments made.');
  if(inventory.missing.length||inventory.nonactive.length||rules.status!=='MATCH'||hosting.fail.length){
    console.log('STAGING_READINESS_AUDIT: BLOCKED (check sanitized findings)');
    process.exitCode=2;
  }else{
    console.log('STAGING_INFRASTRUCTURE_READBACK: PASS (not full application release approval)');
  }
}
if(require.main===module)main().catch(e=>{
  const categories=['STAGING_PROJECT_IDENTITY_MISMATCH','REVIEW_BRANCH_MISMATCH','FUNCTION_MANIFEST_INVALID','FUNCTION_INVENTORY_INVALID','GCLOUD_READ_FAILED','AUDIT_ARGUMENT_INVALID','STAGING_WEB_CONFIG_NUMBER_MISMATCH'];
  console.error('STAGING_READINESS_AUDIT: BLOCKED '+(categories.includes(e.message)?e.message:'CHECK_FAILED'));
  process.exitCode=2;
});
module.exports={canonical,hash,manifest,FILES,PROJECT,NUMBER,REGION,auditHosted,auditPublicHosting};
