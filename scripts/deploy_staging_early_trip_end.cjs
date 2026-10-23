'use strict';
// Three existing staging endpoints, their rules and the reviewed web assets.
// No charge/refund, customer record edit, production or project IAM change.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
const FUNCTIONS=Object.freeze(require('./early_trip_end_functions.json'));
const {runDeployment}=require('./repair_staging_paystack_return.cjs');
function run(command,args,{cwd=ROOT,quiet=true,timeout=90000}={}){
 const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout,maxBuffer:12*1024*1024,stdio:quiet?'pipe':'inherit'});
 if(r.status!==0||r.error)throw Error('Prerequisite/readback failed: '+path.basename(command)+' '+args[0]+'. No further step was attempted.');
 return String(r.stdout||'').trim();
}
async function main(){
 const mode=process.argv[2]||'--check';
 if(process.argv.length>3||!['--check','--apply','--resume-after-functions'].includes(mode))throw Error('Use --check, --apply or --resume-after-functions.');
 if(process.cwd()!==ROOT)throw Error('Run in the review checkout root.');
 if(run('gcloud',['config','get-value','project'])!==PROJECT||run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
  throw Error('Select the isolated Asiye staging project.');
 if(run('git',['branch','--show-current'])!=='fix/paystack-subaccounts-cash-card-no-wallet')throw Error('Wrong review branch.');
 console.log('ASIYE EARLY TRIP END | '+PROJECT+' ('+NUMBER+') | '+mode);
 if(mode==='--check'){
  run('python3',['scripts/audit_staging_early_trip_end_source.py'],{quiet:false,timeout:180000});return;
 }
 const actor=run('gcloud',['config','get-value','account']);
 if(!actor.includes('@')||actor.endsWith('gserviceaccount.com'))throw Error('Use the existing human staging administrator.');
 const changed=run('git',['diff','--name-only','HEAD']).split('\n').filter(Boolean);
 if(changed.length&&!require('./deploy_staging_auth_booking_flow.cjs').isGeneratedPackageChange(changed,
  JSON.parse(fs.readFileSync(path.join(ROOT,'functions/package.json'),'utf8')),JSON.parse(run('git',['show','HEAD:functions/package.json']))))
  throw Error('Uncommitted tracked changes.');
 const key=run('gcloud',['secrets','versions','access','latest','--secret=PAYSTACK_SECRET_KEY','--project='+PROJECT]);
 if(!/^sk_test_[A-Za-z0-9]+$/.test(key))throw Error('Staging Paystack must remain TEST.');
 run('node',['--test','test/trip-end-safety.test.cjs','test/go-continuation.test.cjs','test/club-lifecycle.test.cjs','test/paystack-return.test.cjs'],{quiet:false});
 const sdk=await fetch('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!sdk.ok)throw Error('Existing staging configuration could not be read.');
 const config=require('./rebuild_staging_auth_preview.cjs').parseConfig(await sdk.text());
 if(config.messagingSenderId!==NUMBER)throw Error('Wrong staging project number.');
 const preview=require('./build_staging_web_preview.cjs').createStagingPreview({assetsRoot:path.join(ROOT,'assets'),
  outputDir:path.join(ROOT,'staging-preview'),firebaseConfig:config,expectedProject:PROJECT});
 const cli=path.join(ROOT,'.asiye-staging-cli/node_modules/.bin/firebase');
 if(!fs.existsSync(cli))throw Error('Use the existing pinned staging Firebase CLI.');
 run(cli,['projects:list','--json']);
 const sha=run('git',['rev-parse','HEAD']);console.log('REVIEWED_SOURCE='+sha);
 if(mode==='--apply'){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-early-end-'));
  try{
   const archive=path.join(temp,'source.tar');
   run('git',['archive','--format=tar','--output='+archive,sha,'functions','firebase.json','database.rules.json']);
   run('tar',['-xf',archive,'-C',temp]);fs.unlinkSync(archive);
   const manifest=require('./audit_347_staging_readonly.cjs').manifest();
   if(FUNCTIONS.length!==3||FUNCTIONS.some(name=>!manifest.includes(name)))throw Error('Unexpected endpoint scope.');
   const file=path.join(temp,'functions/package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
   if(pkg.main!=='index.js')throw Error('Unexpected reviewed entrypoint.');
   pkg.main='staging-index.generated.cjs';fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
   fs.writeFileSync(path.join(temp,'functions',pkg.main),require('./prepare_staging_function_scope.cjs').renderEntry(manifest));
   run('npm',['--prefix',path.join(temp,'functions'),'install','--no-audit','--no-fund'],{timeout:180000});
   console.log('Deploying only: '+FUNCTIONS.join(', '));
   runDeployment(cli,['deploy','--project',PROJECT,'--config',path.join(temp,'firebase.json'),'--only',
    FUNCTIONS.map(name=>'functions:'+name).join(','),'--non-interactive','--debug'],
    {cwd:temp,functions:FUNCTIONS,env:{...process.env,FIREBASE_CONFIG:JSON.stringify(config),FUNCTIONS_DISCOVERY_TIMEOUT:'60'}});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
 // Exact immutable source comparison is mandatory after a deploy and on resume.
 run('python3',['scripts/audit_staging_early_trip_end_source.py'],{quiet:false,timeout:180000});
 runDeployment(cli,['deploy','--project',PROJECT,'--config',path.join(ROOT,'firebase.json'),'--only','database','--non-interactive','--debug']);
 runDeployment(cli,['deploy','--project',PROJECT,'--config',preview.generatedConfig,'--only','hosting','--non-interactive','--debug'],
  {env:{...process.env,FIREBASE_HOSTING_UPLOAD_CONCURRENCY:'5'}});
 run('node',['scripts/audit_347_staging_readonly.cjs'],{quiet:false,timeout:180000});
 console.log('EARLY_TRIP_END_DEPLOYMENT: VERIFIED. Test driver warning, passenger approval/decline and restart recovery on two staging devices.');
}
if(require.main===module)main().catch(error=>{console.error('EARLY_TRIP_END: BLOCKED '+error.message);process.exitCode=1;});
module.exports={FUNCTIONS,main};
