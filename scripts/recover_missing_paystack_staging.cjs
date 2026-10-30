'use strict';
// Controlled staging-only recovery. Default: READ-ONLY plan.
// --deploy-first-batch changes only up to THREE currently missing functions,
// with an explicit terminal confirmation; no production or live Paystack access.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');
const ROOT=path.resolve(__dirname,'..');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const REVIEW='8cbd56d';
const RUNTIME='staging-index.generated.cjs';
const REGION='us-central1';
const MAX_BATCH=3;
const PRIORITY=[
  'goTripActionSecure','submitGoFareOffer','counterGoFare',
  'acceptGoFareOffer','acceptGoFareCounter','declineGoFareOffer',
  'declineGoFareCounter','dispatchGoRideRequest','finalizeNegotiatedGoBooking',
  'continueGoAfterPayment','createClubBookingSecure','joinClubPoolSecure',
  'getClubPickupPin','clubDriverActionSecure','synchronizeClubBooking',
  'expireClubWaiting','submitWorkEarlyDepartureOffer',
  'refreshClubPaymentReadinessAfterSafetyShare','createTripShareToken',
  'getTripShare','disburseCompletedCardTrips'
];
const BASE_ACTIVE=[
  'exchangeNativeAuthSession','uploadProfileImageProxy',
  'configureDriverCardPayout','prepareTripPayment','verifyTripCardPayment',
  'paystackWebhook','paystackPaymentReturn','settleTripPayment',
  'releaseTripPayment','releaseCancelledGoTripPayment',
  'releaseCancelledClubPassengerPayment','createParcelRequestSecure',
  'acceptParcelRequestSecure','cancelParcelBookingSecure',
  'getParcelPickupPinSecure','parcelTripActionSecure'
];
const manifest=require('./paystack_function_manifest.json');
function cmd(name,args,opts={}){
  const x=spawnSync(name,args,{cwd:ROOT,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,...opts});
  if(x.status!==0||x.error){
    const reason=/denied|permission|403/i.test(x.stderr||'')?'ACCESS_DENIED':
      /not found|404/i.test(x.stderr||'')?'NOT_FOUND':'COMMAND_FAILED';
    throw Error('Readiness command '+name+' failed ('+reason+'). Inspect privately.');
  }
  return (x.stdout||'').trim();
}
function verifyLocal(){
  if(process.cwd()!==ROOT)throw Error('Run from the Asiye repository root.');
  if(cmd('git',['branch','--show-current'])!==BRANCH)throw Error('Review branch mismatch.');
  cmd('git',['merge-base','--is-ancestor',REVIEW,'HEAD']);
  if(cmd('git',['diff','--name-only',REVIEW,'HEAD','--','functions']))throw Error('Functions code changed since reviewed deployment.');
  if(!Array.isArray(manifest)||manifest.length!==37||new Set(manifest).size!==37){
    throw Error('37-function reviewed allowlist mismatch.');
  }
  const reviewed=JSON.parse(cmd('git',['show',REVIEW+':scripts/paystack_function_manifest.json']));
  if(JSON.stringify(reviewed)!==JSON.stringify(manifest))throw Error('Reviewed manifest changed.');
  if(PRIORITY.length!==21||new Set(PRIORITY).size!==21||PRIORITY.some(n=>!manifest.includes(n)))throw Error('Priority list mismatch.');
  const changed=cmd('git',['diff','--name-only','HEAD','--','functions']).split('\n').filter(Boolean);
  if(changed.some(n=>n!=='functions/package.json'))throw Error('Unexpected local edits in Functions.');
  const currentPkg=JSON.parse(fs.readFileSync(path.join(ROOT,'functions/package.json'),'utf8'));
  const reviewedPkg=JSON.parse(cmd('git',['show','HEAD:functions/package.json']));
  if(reviewedPkg.main!=='index.js')throw Error('Unexpected reviewed Functions entrypoint.');
  reviewedPkg.main=RUNTIME;
  if(JSON.stringify(currentPkg)!==JSON.stringify(reviewedPkg))throw Error('Staging package differs from generated scope.');
  const file=path.join(ROOT,'functions',RUNTIME);
  const {renderEntry}=require('./prepare_staging_function_scope.cjs');
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==renderEntry(manifest)){
    throw Error('Staging-only function entrypoint was not generated correctly.');
  }
  const cli=path.join(ROOT,'.asiye-staging-cli/node_modules/.bin/firebase');
  if(!fs.existsSync(cli))throw Error('Pinned Firebase CLI missing; do not redeploy the complete bootstrap.');
  if(cmd('gcloud',['config','get-value','project'])!==PROJECT ||
     cmd('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER){
    throw Error('BLOCKED: project is not the authorized isolated staging project.');
  }
  const account=cmd('gcloud',['config','get-value','account']);
  if(!account || account.endsWith('.gserviceaccount.com'))throw Error('Use the authorized Cloud Shell human account.');
  if(process.env.FIREBASE_CONFIG){
    let config;
    try{config=JSON.parse(process.env.FIREBASE_CONFIG);}catch{throw Error('Invalid FIREBASE_CONFIG');}
    if(config.projectId!==PROJECT || String(config.databaseURL||'').includes('asiye-80386')){
      throw Error('FIREBASE_CONFIG does not identify staging.');
    }
  }
  return cli;
}
function inventory(entries){
  if(!Array.isArray(entries))throw Error('Unexpected Cloud Functions inventory.');
  const found=new Map();
  for(const f of entries){
    const full=String(f.name||'');
    if(full.includes('/locations/')&&!full.includes('/locations/'+REGION+'/'))continue;
    const name=full.split('/').pop();
    if(manifest.includes(name))found.set(name,String(f.state||'UNKNOWN').toUpperCase());
  }
  const active=manifest.filter(n=>found.get(n)==='ACTIVE');
  const missing=manifest.filter(n=>!found.has(n));
  const nonactive=manifest.filter(n=>found.has(n)&&found.get(n)!=='ACTIVE');
  return {active,missing,nonactive};
}
function getInventory(){
  const entries=JSON.parse(cmd('gcloud',['functions','list','--v2','--regions='+REGION,
    '--project='+PROJECT,'--format=json']));
  return inventory(entries);
}
function plan(state){
  const expectedMissing=PRIORITY.filter(n=>state.missing.includes(n));
  const extra=state.missing.filter(n=>!PRIORITY.includes(n));
  if(extra.length)throw Error('Previously active functions are missing; refusing recovery.');
  if(BASE_ACTIVE.some(n=>!state.active.includes(n)))throw Error('Baseline 16 ACTIVE functions are not all active; refusing recovery.');
  if(state.nonactive.length)throw Error('Non-ACTIVE resources exist. Investigate before deploying.');
  return expectedMissing.slice(0,MAX_BATCH);
}
function confirmFunctionServiceAgentBinding(){
  const policy=JSON.parse(cmd('gcloud',['projects','get-iam-policy',PROJECT,'--format=json']));
  const member='serviceAccount:service-'+NUMBER+'@gcf-admin-robot.iam.gserviceaccount.com';
  const binding=Array.isArray(policy.bindings) && policy.bindings.some(b=>
    b.role==='roles/cloudfunctions.serviceAgent' &&
    !b.condition && Array.isArray(b.members) && b.members.includes(member));
  if(!binding)throw Error('Cloud Functions Service Agent binding not confirmed; no deployment.');
  console.log('Cloud Functions Service Agent: DIRECT ROLE PRESENT');
}
function selectBatch(state,mode){
  const candidates=plan(state);
  return mode==='--deploy-one' ? candidates.slice(0,1) : candidates;
}
function reconcileBatch(batch,before,after,cliOk){
  const verified=batch.filter(n=>after.active.includes(n));
  const remaining=batch.filter(n=>!after.active.includes(n));
  const lost=before.active.filter(n=>!after.active.includes(n));
  const unexpected=after.nonactive.filter(n=>before.missing.includes(n));
  const safelyActive=remaining.length===0 && lost.length===0 && unexpected.length===0;
  return {
    verified,remaining,lost,unexpected,
    status:safelyActive ? (cliOk?'COMPLETE':'ACTIVE_WITH_CLI_WARNING') :
      (lost.length||unexpected.length?'INVESTIGATE_STATE_CHANGE':'INCOMPLETE')
  };
}
async function main(){
  const flag=process.argv[2]||'--plan';
  if(!['--plan','--deploy-first-batch','--deploy-one'].includes(flag)||process.argv.length>3)
    throw Error('Usage: node scripts/recover_missing_paystack_staging.cjs [--plan|--deploy-first-batch|--deploy-one]');
  const cli=verifyLocal();
  const before=getInventory();
  const batch=selectBatch(before,flag);
  console.log('Asiye Paystack TEST staging | '+(flag==='--plan'?'READ-ONLY PLAN':'BOUNDED DEPLOY'));
  console.log('Expected='+manifest.length+' | ACTIVE='+before.active.length+
    ' | MISSING='+before.missing.length+' | NONACTIVE='+before.nonactive.length);
  console.log('Next batch (max '+MAX_BATCH+'): '+(batch.join(', ')||'none'));
  console.log('Excluded from deployment: '+before.active.length+' currently ACTIVE functions.');
  if(flag==='--plan'||!batch.length){
    console.log('No resources changed.');
    return;
  }
  if(batch.includes('continueGoAfterPayment'))confirmFunctionServiceAgentBinding();
  const secret=cmd('gcloud',['secrets','versions','access','latest',
    '--secret=PAYSTACK_SECRET_KEY','--project='+PROJECT]);
  if(!/^sk_test_[A-Za-z0-9]+$/.test(secret))throw Error('Staging secret is not a Paystack TEST key.');
  if(!stdin.isTTY)throw Error('Interactive Cloud Shell approval is required.');
  const rl=readline.createInterface({input:stdin,output:stdout});
  let response;
  try{response=await rl.question('Type DEPLOY-MISSING-STAGING to deploy ONLY this batch: ');}
  finally{rl.close();}
  if(response.trim()!=='DEPLOY-MISSING-STAGING')throw Error('Cancelled without changes.');
  // Query again after approval to guard against concurrent deployment changes.
  const now=getInventory();
  const check=selectBatch(now,flag);
  if(JSON.stringify(check)!==JSON.stringify(batch))throw Error('Inventory changed; rerun --plan.');
  const logfile=path.join(os.homedir(),'asiye-staging-functions.'+Date.now()+'.log');
  const handle=fs.openSync(logfile,'wx',0o600);
  let proc;
  try{
    const only=batch.map(n=>'functions:'+n).join(',');
    proc=spawnSync(cli,['deploy','--project',PROJECT,'--only',only,'--non-interactive'],
      {cwd:ROOT,stdio:['ignore',handle,handle],timeout:1200000,env:{
        ...process.env,GCLOUD_PROJECT:PROJECT,GCP_PROJECT:PROJECT
      }});
  }finally{fs.closeSync(handle);}
  const cliOk=!proc.error&&proc.status===0;
  console.log('Firebase CLI process: '+(cliOk?'exit 0':
    'nonzero exit or interrupted (status='+ (Number.isInteger(proc.status)?proc.status:'unknown') +
    ', signal=' + (/^SIG[A-Z0-9]+$/.test(String(proc.signal||''))?proc.signal:'none')+')'));
  // Always reconcile real resources, even when Firebase CLI exits nonzero.
  // An errored CLI can still have provisioned all requested functions.
  let after;
  try {after=getInventory();}
  catch(err) {
    console.error('Cannot verify post-deployment inventory. STOP; do not redeploy this batch blindly.');
    console.error('Private Firebase log: '+logfile+' (never post raw log).');
    process.exitCode=1;return;
  }
  const outcome=reconcileBatch(batch,before,after,cliOk);
  console.log('Active after batch: '+after.active.length+' / '+manifest.length);
  console.log('Batch verified ACTIVE: '+(outcome.verified.join(', ')||'none'));
  console.log('Recovery status: '+outcome.status);
  if(outcome.remaining.length)console.error('Not ACTIVE: '+outcome.remaining.join(', '));
  if(outcome.lost.length)console.error('Previously ACTIVE functions changed state: '+outcome.lost.join(', '));
  if(outcome.unexpected.length)console.error('New non-ACTIVE resources: '+outcome.unexpected.join(', '));
  if(outcome.status==='ACTIVE_WITH_CLI_WARNING'){
    console.error('All requested functions are ACTIVE, but Firebase CLI did not exit successfully.');
    console.error('This is not proof of successful end-to-end payment/booking or clean CLI completion.');
    console.error('Review only sanitized diagnostics before the next batch.');
    process.exitCode=2;
  } else if(outcome.status!=='COMPLETE'){
    console.error('Batch not complete. Run the read-only --plan again; do not rerun this selection blindly.');
    process.exitCode=1;
  }else{
    console.log('Batch completed. Rerun --plan before considering another batch.');
  }
  console.log('Private Firebase log: '+logfile+' (never post the raw log).');
}
if(require.main===module)main().catch(e=>{console.error('BLOCKED: '+e.message);process.exitCode=1;});
module.exports={inventory,plan,selectBatch,reconcileBatch,PRIORITY,BASE_ACTIVE};
