'use strict';
// Only the public, navigation-only callback and staging Hosting may change.
// No checkout, charge, refund, ledger/rules change or project IAM grant.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {renderPaymentReturn}=require('../functions/paystack-return');
const ROOT=path.resolve(__dirname,'..'),PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
const REGION='us-central1',FUNCTION='paystackPaymentReturn',BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const PROBE='ASIYE-RETURN-PROBE';
function run(command,args,{cwd=ROOT,timeout=60000,quiet=true,env=process.env}={}){
 const result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:12*1024*1024,stdio:quiet?'pipe':'inherit'});
 if(result.status!==0||result.error)throw Error('Command failed: '+command+' '+args.slice(0,2).join(' ')+'. Inspect Cloud Shell privately; no raw error was published.');
 return String(result.stdout||'').trim();
}
function callbackService(info){
 const expected=[PROJECT,NUMBER].map(id=>`projects/${id}/locations/${REGION}/functions/${FUNCTION}`);
 if(!expected.includes(info.name)||info.environment!=='GEN_2'||info.state!=='ACTIVE')throw Error('Expected the ACTIVE Gen2 staging return callback.');
 if(info.serviceConfig?.ingressSettings!=='ALLOW_ALL')throw Error('Callback ingress is restricted. Review that setting separately; no change was made.');
 const service=String(info.serviceConfig?.service||'');
 const prefix=[PROJECT,NUMBER].map(id=>`projects/${id}/locations/${REGION}/services/`).find(value=>service.startsWith(value));
 const name=prefix?service.slice(prefix.length):'';
 if(name!=='paystackpaymentreturn')throw Error('Callback Cloud Run service identity does not match staging.');
 return name;
}
function publicInvoker(policy){
 return (policy.bindings||[]).some(binding=>binding.role==='roles/run.invoker'&&!binding.condition&&binding.members?.includes('allUsers'));
}
async function probe(){
 const results={};
 for(const name of [FUNCTION,'paystackWebhook','verifyTripCardPayment']){
  try{
   const response=await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`+(name===FUNCTION?'?reference='+PROBE:''),
    {redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
   const body=await response.text();
   results[name]={status:response.status};
   if(name===FUNCTION)results[name].reviewedPageMatches=response.status===200&&body===renderPaymentReturn(PROJECT,PROBE);
  }catch(_){results[name]={status:'READ_FAILED'};}
 }
 return results;
}
function show(results){
 for(const [name,result] of Object.entries(results))console.log(name+': HTTP '+result.status+
  (name===FUNCTION?' | REVIEWED_RETURN_PAGE='+result.reviewedPageMatches:''));
}
async function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--apply'].includes(mode)||process.argv.length>3)throw Error('Use --check or --apply.');
 console.log('ASIYE STAGING PAYMENT RETURN | '+PROJECT+' ('+NUMBER+') | '+mode);
 const before=await probe();show(before);
 if(mode==='--check'){
  console.log('Public GET requests only. No cloud resources or payments changed.');
  if(!before[FUNCTION].reviewedPageMatches)process.exitCode=2;
  return;
 }
 if(process.cwd()!==ROOT)throw Error('Run in the review repository root.');
 if(run('gcloud',['config','get-value','project'])!==PROJECT||run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
  throw Error('Select only the isolated Asiye staging project.');
 const actor=run('gcloud',['config','get-value','account']);
 if(!actor.includes('@')||actor.endsWith('gserviceaccount.com'))throw Error('Use the existing human staging owner in Cloud Shell.');
 if(run('git',['branch','--show-current'])!==BRANCH)throw Error('Wrong review branch.');
 const {isGeneratedPackageChange}=require('./deploy_staging_auth_booking_flow.cjs');
 const changed=run('git',['diff','--name-only','HEAD']).split('\n').filter(Boolean);
 if(changed.length&&!isGeneratedPackageChange(changed,JSON.parse(fs.readFileSync(path.join(ROOT,'functions/package.json'),'utf8')),
  JSON.parse(run('git',['show','HEAD:functions/package.json']))))throw Error('Tracked files have uncommitted edits.');
 const secret=run('gcloud',['secrets','versions','access','latest','--secret=PAYSTACK_SECRET_KEY','--project='+PROJECT]);
 if(!/^sk_test_[A-Za-z0-9]+$/.test(secret))throw Error('Staging Paystack configuration is not TEST.');
 const describe=()=>JSON.parse(run('gcloud',['functions','describe',FUNCTION,'--gen2','--region='+REGION,'--project='+PROJECT,'--format=json']));
 const service=callbackService(describe());
 run('node',['--test','test/paystack-return.test.cjs','test/member-pages.test.cjs','test/staging-payment-return-repair.test.cjs'],{quiet:false});
 const sdk=await fetch('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!sdk.ok)throw Error('Existing staging web configuration could not be read.');
 const config=require('./rebuild_staging_auth_preview.cjs').parseConfig(await sdk.text());
 if(config.messagingSenderId!==NUMBER)throw Error('Staging web project number differs.');
 const cli=path.join(ROOT,'.asiye-staging-cli/node_modules/.bin/firebase');
 if(!fs.existsSync(cli))throw Error('Use the existing pinned staging Firebase CLI.');
 run(cli,['projects:list','--json']);
 const sha=run('git',['rev-parse','HEAD']);
 if(!before[FUNCTION].reviewedPageMatches){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-return-repair-'));
  try{
   const archive=path.join(temp,'source.tar');
   run('git',['archive','--format=tar','--output='+archive,sha,'functions','firebase.json','database.rules.json']);
   run('tar',['-xf',archive,'-C',temp]);fs.unlinkSync(archive);
   const names=require('./audit_347_staging_readonly.cjs').manifest();
   const pkgFile=path.join(temp,'functions/package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));
   if(pkg.main!=='index.js'||names.length!==43)throw Error('Unexpected reviewed staging entrypoint.');
   pkg.main='staging-index.generated.cjs';fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
   fs.writeFileSync(path.join(temp,'functions',pkg.main),require('./prepare_staging_function_scope.cjs').renderEntry(names));
   run('npm',['--prefix',path.join(temp,'functions'),'install','--no-audit','--no-fund'],{timeout:180000});
   console.log('Deploying only '+FUNCTION+' from '+sha+'.');
   run(cli,['deploy','--project',PROJECT,'--config',path.join(temp,'firebase.json'),'--only','functions:'+FUNCTION,'--non-interactive'],
    {cwd:temp,timeout:600000,env:{...process.env,FIREBASE_CONFIG:JSON.stringify(config),FUNCTIONS_DISCOVERY_TIMEOUT:'60'}});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
 callbackService(describe());
 let policy=JSON.parse(run('gcloud',['run','services','get-iam-policy',service,'--region='+REGION,'--project='+PROJECT,'--format=json']));
 if(!publicInvoker(policy)){
  // This endpoint returns navigation HTML only. No project-level role, other
  // endpoint or authenticated payment handler is made public by this repair.
  run('gcloud',['run','services','add-iam-policy-binding',service,'--region='+REGION,'--project='+PROJECT,
   '--member=allUsers','--role=roles/run.invoker','--condition=None','--format=json']);
  policy=JSON.parse(run('gcloud',['run','services','get-iam-policy',service,'--region='+REGION,'--project='+PROJECT,'--format=json']));
  if(!publicInvoker(policy))throw Error('Callback public invocation was not confirmed.');
 }
 const callback=await probe();show(callback);
 if(!callback[FUNCTION].reviewedPageMatches)throw Error('Callback HTML does not match the reviewed repair.');
 const preview=require('./build_staging_web_preview.cjs').createStagingPreview({assetsRoot:path.join(ROOT,'assets'),
  outputDir:path.join(ROOT,'staging-preview'),firebaseConfig:config,expectedProject:PROJECT});
 const {auditHosted}=require('./audit_347_staging_readonly.cjs');
 const hosting=await auditHosted(preview.preview);
 if(hosting.fail.length)run(cli,['deploy','--project',PROJECT,'--config',preview.generatedConfig,'--only','hosting','--non-interactive'],
  {timeout:600000,env:{...process.env,FIREBASE_HOSTING_UPLOAD_CONCURRENCY:'5'}});
 run('node',['scripts/audit_347_staging_readonly.cjs'],{quiet:false,timeout:180000});
 if(callback.paystackWebhook.status!==405||callback.verifyTripCardPayment.status!==405)
  throw Error('An unchanged payment endpoint needs separate access diagnosis.');
 console.log('RETURN_REPAIR: VERIFIED. Reopen the original passenger tab and Check payment for its saved reference.');
 console.log('No new checkout, charge, refund, production deployment or project IAM grant was made.');
}
if(require.main===module)main().catch(error=>{console.error('RETURN_REPAIR: BLOCKED '+error.message);process.exitCode=1;});
module.exports={callbackService,publicInvoker,PROJECT,NUMBER,FUNCTION,main};
