'use strict';
// Staging only: correct the two Go dispatch callers; keep the current rules and Hosting.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {deployFunctions,isGeneratedPackageChange,resumeRequested}=require('./deploy_staging_auth_booking_flow.cjs');
const ROOT=path.resolve(__dirname,'..'),PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
const BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const NAMES=require('./go_dispatch_staging_functions.json');
function run(name,args,{cwd=ROOT,quiet=false,env=process.env}={}){
 const p=spawnSync(name,args,{cwd,env,encoding:'utf8',stdio:quiet?'pipe':'inherit',timeout:20*60*1000,maxBuffer:8*1024*1024});
 if(p.status!==0||p.error)throw Error('Command failed: '+name+' '+args.slice(0,2).join(' ')+'. Stop here.');
 return String(p.stdout||'').trim();
}
async function main(){
 const resume=resumeRequested(process.argv.slice(2));
 if(process.cwd()!==ROOT)throw Error('Run from the Asiye review repository root.');
 if(run('gcloud',['config','get-value','project'],{quiet:true})!==PROJECT||
    run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'],{quiet:true})!==NUMBER)
  throw Error('Select the isolated Asiye staging project.');
 if(run('git',['branch','--show-current'],{quiet:true})!==BRANCH)throw Error('Wrong review branch.');
 const changed=run('git',['diff','--name-only','HEAD'],{quiet:true}).split('\n').filter(Boolean);
 if(changed.length&&!isGeneratedPackageChange(changed,JSON.parse(fs.readFileSync(path.join(ROOT,'functions/package.json'),'utf8')),
  JSON.parse(run('git',['show','HEAD:functions/package.json'],{quiet:true}))))throw Error('Tracked source has uncommitted edits.');
 const actor=run('gcloud',['config','get-value','account'],{quiet:true});
 if(!actor.includes('@')||actor.endsWith('gserviceaccount.com'))throw Error('Use the human staging administrator already signed into Cloud Shell.');
 const sha=run('git',['rev-parse','HEAD'],{quiet:true});
 console.log('STAGING GO DISPATCH: '+sha+' | '+PROJECT+' ('+NUMBER+')');
 run('node',['--test','test/go-driver-category.test.cjs','test/go-fare-negotiation.test.cjs','test/request-search-awareness.test.cjs']);
 const sdk=await fetch('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!sdk.ok)throw Error('Cannot read the existing public staging Web configuration.');
 const config=require('./rebuild_staging_auth_preview.cjs').parseConfig(await sdk.text());
 if(config.messagingSenderId!==NUMBER)throw Error('Staging project number mismatch.');
 require('./build_staging_web_preview.cjs').createStagingPreview({assetsRoot:path.join(ROOT,'assets'),
  outputDir:path.join(ROOT,'staging-preview'),firebaseConfig:config,expectedProject:PROJECT});
 const cliDir=path.join(ROOT,'.asiye-staging-cli'),cli=path.join(cliDir,'node_modules/.bin/firebase');
 if(!fs.existsSync(cli))run('npm',['--prefix',cliDir,'install','--no-audit','--no-fund','--no-save','firebase-tools@15.34.0']);
 run(cli,['projects:list','--json'],{quiet:true});
 if(!resume){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-staging-go-dispatch-'));
  try{
   const archive=path.join(temp,'source.tar');
   run('git',['archive','--format=tar','--output='+archive,sha,'functions','scripts','firebase.json','database.rules.json']);
   run('tar',['-xf',archive,'-C',temp]);fs.unlinkSync(archive);
   const exports=[...new Set([...require('./paystack_function_manifest.json'),...require('./auth_booking_staging_functions.json'),...require('./staging_driver_admin_functions.json')])];
   if(NAMES.some(name=>!exports.includes(name)))throw Error('Dispatch function outside the reviewed staging scope.');
   const pkgFile=path.join(temp,'functions/package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));
   if(pkg.main!=='index.js')throw Error('Unexpected reviewed backend entrypoint.');
   pkg.main='staging-index.generated.cjs';fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
   fs.writeFileSync(path.join(temp,'functions',pkg.main),require('./prepare_staging_function_scope.cjs').renderEntry(exports));
   run('npm',['--prefix',path.join(temp,'functions'),'install','--no-audit','--no-fund']);
   deployFunctions(cli,['deploy','--project',PROJECT,'--config',path.join(temp,'firebase.json'),'--only',NAMES.map(n=>'functions:'+n).join(','),'--non-interactive'],
    {cwd:temp,env:{...process.env,FIREBASE_CONFIG:JSON.stringify(config)}},NAMES);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
 run('python3',['scripts/audit_staging_go_dispatch_source.py']);
 run('node',['scripts/audit_347_staging_readonly.cjs']);
 console.log('Go dispatch updated and source verified. Existing open searches will retry automatically.');
 console.log('Keep the approved driver online with GPS allowed. Use a separate passenger account for the staging trip.');
}
if(require.main===module)main().catch(error=>{console.error('BLOCKED: '+error.message);process.exitCode=1;});
module.exports={NAMES};
