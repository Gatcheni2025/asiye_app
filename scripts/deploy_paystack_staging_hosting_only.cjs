'use strict';
// Staging Hosting ONLY — --plan is read-only. --deploy requires human approval.
// Never modifies Cloud Functions, RTDB rules, secrets, IAM or the production project.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const root=path.resolve(__dirname,'..');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const REVIEW='8cbd56d';
const REGION='us-central1';
const PROD='asiye-80386';
const FILES=['passenger-v2/index.html','passenger-v2/js/firebase.js',
  'passenger-v2/js/wallet.js','driver-v2/index.html','driver-v2/js/firebase.js'];
const manifest=require('./paystack_function_manifest.json');
function run(name,args) {
  const p=spawnSync(name,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:6*1024*1024});
  if(p.status!==0 || p.error)throw Error('Prerequisite command failed ('+name+'); inspect locally. No deployment attempted.');
  return String(p.stdout||'').trim();
}
function verifyHostingConfig(data) {
  if(!data || !data.hosting || Array.isArray(data.hosting))throw Error('Expected one staging Hosting configuration.');
  const h=data.hosting;
  if(h.public!=='staging-preview')throw Error('BLOCKED: Hosting public directory is not staging-preview.');
  if(h.site || h.target || (Array.isArray(h.rewrites)&&h.rewrites.length)){
    throw Error('BLOCKED: Unexpected Hosting site, target or rewrite.');
  }
  const headers=(h.headers||[]).flatMap(rule=>rule.headers||[]);
  if(!headers.some(x=>String(x.key).toLowerCase()==='x-robots-tag' &&
    /noindex/i.test(String(x.value))))throw Error('Missing staging no-index header.');
  return true;
}
function activeFunctions(entries) {
  if(!Array.isArray(entries))throw Error('Unrecognized Cloud Functions inventory.');
  const map=new Map();
  for(const f of entries){
    const name=String(f.name||'').split('/').pop();
    const location=String(f.name||'').match(/\/locations\/([^/]+)\//);
    if(location && location[1]!==REGION)continue;
    if(manifest.includes(name))map.set(name,String(f.state||'').toUpperCase());
  }
  return manifest.filter(n=>map.get(n)==='ACTIVE');
}
function digest(value) {return createHash('sha256').update(value).digest('hex');}
async function hostedMatches(preview){
  const base='https://'+PROJECT+'.web.app/';
  for(const rel of FILES) {
    let response;
    try{response=await fetch(base+rel,{
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)
    });}catch(_){return {match:false,reason:'NOT_REACHABLE'};}
    if(!response.ok)return {match:false,reason:'HTTP_'+response.status};
    if(!/noindex/i.test(String(response.headers.get('x-robots-tag')||''))){
      return {match:false,reason:'NOINDEX_MISSING'};
    }
    const remote=Buffer.from(await response.arrayBuffer());
    const local=fs.readFileSync(path.join(preview,rel));
    if(digest(remote)!==digest(local))return {match:false,reason:'CONTENT_DIFFERENT'};
  }
  return {match:true,reason:'HOSTING_MATCHES_LOCAL_PREVIEW'};
}
function localChecks(){
  if(process.cwd()!==root)throw Error('Run from Asiye review repository root.');
  if(run('gcloud',['config','get-value','project'])!==PROJECT ||
     run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER){
    throw Error('BLOCKED: not the approved isolated staging project.');
  }
  if(run('git',['branch','--show-current'])!==BRANCH)throw Error('BLOCKED: wrong review branch.');
  run('git',['merge-base','--is-ancestor',REVIEW,'HEAD']);
  if(run('git',['diff','--name-only',REVIEW,'HEAD','--','assets']))throw Error('Reviewed assets changed; rebuild preview before Hosting deployment.');
  if(run('git',['diff','--name-only','HEAD','--','assets']))throw Error('Uncommitted asset edits; refuse stale preview.');
  const file=path.join(root,'firebase.staging.generated.json');
  if(!fs.existsSync(file))throw Error('Staging Hosting config was not generated.');
  verifyHostingConfig(JSON.parse(fs.readFileSync(file,'utf8')));
  const preview=path.join(root,'staging-preview');
  for(const rel of FILES){
    const full=path.join(preview,rel);
    if(!fs.existsSync(full)||!fs.statSync(full).isFile())throw Error('Missing reviewed preview asset: '+rel);
    const text=fs.readFileSync(full,'utf8');
    if(text.includes(PROD))throw Error('Production identifier found in staging asset: '+rel);
    if(rel.endsWith('js/firebase.js')&&!text.includes(PROJECT)){
      throw Error('Staging Firebase config mismatch: '+rel);
    }
  }
  const inventory=JSON.parse(run('gcloud',['functions','list','--v2','--regions='+REGION,'--project='+PROJECT,'--format=json']));
  const active=activeFunctions(inventory);
  if(!Array.isArray(manifest)||manifest.length!==37||active.length!==37)throw Error('All 37 functions must be ACTIVE before Hosting.');
  const cli=path.join(root,'.asiye-staging-cli/node_modules/.bin/firebase');
  if(!fs.existsSync(cli))throw Error('Pinned Firebase CLI is not installed.');
  return {preview,cli};
}
async function main(){
  const mode=process.argv[2]||'--plan';
  if(!['--plan','--deploy'].includes(mode)||process.argv.length!==3){
    throw Error('Usage: node scripts/deploy_paystack_staging_hosting_only.cjs --plan|--deploy');
  }
  const {preview,cli}=localChecks();
  console.log('Asiye TEST staging Hosting only | '+(mode==='--plan'?'READ ONLY PLAN':'CONTROLLED DEPLOY'));
  console.log('Project '+PROJECT+' ('+NUMBER+') | Reviewed functions ACTIVE: 37/37');
  console.log('Hosting public: staging-preview | noindex configured | production identifiers absent');
  const before=await hostedMatches(preview);
  console.log('Current public Hosting state: '+before.reason);
  if(mode==='--plan'){console.log('No resources changed.');return;}
  if(before.match){console.log('Hosting already matches reviewed preview. Skipping deployment.');return;}
  if(!stdin.isTTY)throw Error('Human interactive confirmation required.');
  const rl=readline.createInterface({input:stdin,output:stdout});
  let response;
  try{response=await rl.question('Type DEPLOY-STAGING-HOSTING to publish ONLY staging Hosting: ');}
  finally{rl.close();}
  if(response.trim()!=='DEPLOY-STAGING-HOSTING')throw Error('Cancelled. No deployment.');
  localChecks();
  const log=path.join(os.homedir(),'asiye-staging-hosting.'+Date.now()+'.log');
  const fd=fs.openSync(log,'wx',0o600);
  let result;
  // Reduce Hosting upload fan-out for Cloud Shell. Firebase CLI documents
  // FIREBASE_HOSTING_UPLOAD_CONCURRENCY; default concurrency can overwhelm
  // individual network paths. Keep the value pinned, rather than inherited.
  const HOSTING_UPLOAD_CONCURRENCY='5';
  console.log('Staging Hosting upload concurrency: '+HOSTING_UPLOAD_CONCURRENCY);
  try{
    result=spawnSync(cli,['deploy','--project',PROJECT,'--config','firebase.staging.generated.json',
      '--only','hosting','--non-interactive'],{
        cwd:root,
        stdio:['ignore',fd,fd],
        timeout:600000,
        env:{...process.env,FIREBASE_HOSTING_UPLOAD_CONCURRENCY:HOSTING_UPLOAD_CONCURRENCY}
      });
  }finally{fs.closeSync(fd);}
  console.log('Firebase CLI result: '+(result.status===0&&!result.error?'EXIT_0':'CLI_WARNING'));
  const after=await hostedMatches(preview);
  console.log('Hosting verification: '+after.reason);
  console.log('Private CLI log: '+log+' (do not share raw log)');
  if(!after.match) {
    console.error('Hosting NOT verified. Do not proceed to payment testing with the web preview.');
    process.exitCode=1;
  }else if(result.status!==0||result.error){
    console.error('Hosting content verified, but Firebase CLI exited nonzero; review warning privately.');
    process.exitCode=2;
  }else console.log('Staging Hosting successfully deployed and verified. Production untouched.');
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={verifyHostingConfig,activeFunctions};
