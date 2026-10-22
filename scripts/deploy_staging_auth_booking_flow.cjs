'use strict';
// Owner-requested staging patch: seven existing endpoints, DB rules and Web assets.
// Never selects production, changes IAM, writes Auth users or starts a payment.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
const BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const FUNCTIONS=Object.freeze(require('./auth_booking_staging_functions.json'));
function run(name,args,{cwd=ROOT,env=process.env,quiet=false}={}){
 const result=spawnSync(name,args,{cwd,env,encoding:'utf8',stdio:quiet?'pipe':'inherit',timeout:20*60*1000,maxBuffer:8*1024*1024});
 if(result.status!==0||result.error)throw Error('Command failed: '+name+' '+args.slice(0,2).join(' ')+'. Stop here; do not continue other deploy commands.');
 return String(result.stdout||'').trim();
}
async function main(){
 if(process.cwd()!==ROOT)throw Error('Run from the Asiye repository root.');
 if(run('gcloud',['config','get-value','project'],{quiet:true})!==PROJECT ||
    run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'],{quiet:true})!==NUMBER)
  throw Error('Choose the isolated staging project first: gcloud config set project '+PROJECT);
 if(run('git',['branch','--show-current'],{quiet:true})!==BRANCH)throw Error('Wrong review branch.');
 if(run('git',['status','--porcelain','--untracked-files=no'],{quiet:true}))throw Error('Commit or discard tracked edits before deployment.');
 const account=run('gcloud',['config','get-value','account'],{quiet:true});
 if(!account||account.endsWith('gserviceaccount.com'))throw Error('Use the human staging administrator already signed into Cloud Shell.');
 const secret=run('gcloud',['secrets','versions','access','latest','--secret=PAYSTACK_SECRET_KEY','--project='+PROJECT],{quiet:true});
 if(!/^sk_test_[A-Za-z0-9]+$/.test(secret))throw Error('Staging Paystack key is not TEST. No deployment attempted.');
 const sha=run('git',['rev-parse','HEAD'],{quiet:true});
 console.log('STAGING AUTH/BOOKING PATCH '+sha+' | '+PROJECT+' ('+NUMBER+')');
 run('node',['--test','test/staging-passenger-social-phone-link.test.cjs','test/native-social-phone-link.test.cjs',
   'test/passenger-booking-face.test.cjs','test/registration-submission.test.cjs']);
 const sdk=await fetch('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js',
  {redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!sdk.ok)throw Error('Cannot read existing staging Web configuration.');
 const config=require('./rebuild_staging_auth_preview.cjs').parseConfig(await sdk.text());
 if(config.messagingSenderId!==NUMBER)throw Error('Staging SDK project number mismatch.');
 const result=require('./build_staging_web_preview.cjs').createStagingPreview({assetsRoot:path.join(ROOT,'assets'),
  outputDir:path.join(ROOT,'staging-preview'),firebaseConfig:config,expectedProject:PROJECT});
 const cliDir=path.join(ROOT,'.asiye-staging-cli');
 const cli=path.join(cliDir,'node_modules','.bin','firebase');
 if(!fs.existsSync(cli))run('npm',['--prefix',cliDir,'install','--no-audit','--no-fund','--no-save','firebase-tools@15.34.0']);
 run(cli,['projects:list','--json'],{quiet:true});
 // Archive reviewed source to an isolated temporary directory; leave tracked files untouched.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-staging-auth-'));
 try{
  const archive=path.join(temp,'source.tar');
  run('git',['archive','--format=tar','--output='+archive,sha,'functions','scripts','firebase.json','database.rules.json']);
  run('tar',['-xf',archive,'-C',temp]);fs.unlinkSync(archive);
  const manifest=[...new Set([...require('./paystack_function_manifest.json'),...FUNCTIONS])];
  if(FUNCTIONS.some(name=>!manifest.includes(name)))throw Error('Patch function outside the reviewed staging manifest.');
  const pkgPath=path.join(temp,'functions/package.json'),pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
  if(pkg.main!=='index.js')throw Error('Unexpected Functions entrypoint.');
  fs.writeFileSync(path.join(temp,'functions/staging-index.generated.cjs'),require('./prepare_staging_function_scope.cjs').renderEntry(manifest));
  pkg.main='staging-index.generated.cjs';fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n');
  run('npm',['--prefix',path.join(temp,'functions'),'install','--no-audit','--no-fund']);
  const env={...process.env,FIREBASE_CONFIG:JSON.stringify(config),STAGING_PROJECT:PROJECT};
  run(cli,['deploy','--project',PROJECT,'--config',path.join(temp,'firebase.json'),'--only',FUNCTIONS.map(n=>'functions:'+n).join(','),'--non-interactive'],{cwd:temp,env});
  run(cli,['deploy','--project',PROJECT,'--config',path.join(ROOT,'firebase.json'),'--only','database','--non-interactive']);
  run(cli,['deploy','--project',PROJECT,'--config',result.generatedConfig,'--only','hosting','--non-interactive']);
  run('node',['scripts/audit_347_staging_readonly.cjs']);
  console.log('Staging patch deployed. Test passenger first booking and driver OTP in a fresh browser session. Native binaries still require a new build.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)main().catch(error=>{console.error('BLOCKED: '+error.message);process.exitCode=1;});
module.exports={FUNCTIONS};
