'use strict';
// Hosting only: use the existing staging configuration, API inventory and rules.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
function run(name,args,quiet=false){
 const p=spawnSync(name,args,{cwd:ROOT,encoding:'utf8',stdio:quiet?'pipe':'inherit',timeout:20*60*1000,maxBuffer:4*1024*1024});
 if(p.status!==0||p.error)throw Error('Command failed: '+name+'. Stop here.');
 return String(p.stdout||'').trim();
}
async function main(){
 if(process.cwd()!==ROOT)throw Error('Run from the Asiye review repository root.');
 if(run('gcloud',['config','get-value','project'],true)!==PROJECT||run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'],true)!==NUMBER)
  throw Error('Select the isolated Asiye staging project.');
 if(run('git',['branch','--show-current'],true)!=='fix/paystack-subaccounts-cash-card-no-wallet')throw Error('Wrong review branch.');
 if(run('git',['diff','--name-only','HEAD','--','assets','scripts'],true))throw Error('Uncommitted website or script edits.');
 const actor=run('gcloud',['config','get-value','account'],true);
 if(!actor.includes('@')||actor.endsWith('gserviceaccount.com'))throw Error('Use the existing human staging Cloud Shell account.');
 run('node',['--test','test/request-search-awareness.test.cjs','test/member-pages.test.cjs','test/audit-347-staging-readonly.test.cjs']);
 const response=await fetch('https://'+PROJECT+'.web.app/passenger-v2/js/firebase.js',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Cannot read the existing public staging configuration.');
 const config=require('./rebuild_staging_auth_preview.cjs').parseConfig(await response.text());
 if(config.messagingSenderId!==NUMBER)throw Error('Staging project number mismatch.');
 const preview=require('./build_staging_web_preview.cjs').createStagingPreview({assetsRoot:path.join(ROOT,'assets'),outputDir:path.join(ROOT,'staging-preview'),firebaseConfig:config,expectedProject:PROJECT});
 const cliDir=path.join(ROOT,'.asiye-staging-cli'),cli=path.join(cliDir,'node_modules/.bin/firebase');
 if(!fs.existsSync(cli))run('npm',['--prefix',cliDir,'install','--no-audit','--no-fund','--no-save','firebase-tools@15.34.0']);
 console.log('STAGING DRIVER SEARCH UI: '+run('git',['rev-parse','HEAD'],true));
 run(cli,['deploy','--project',PROJECT,'--config',preview.generatedConfig,'--only','hosting','--non-interactive']);
 run('node',['scripts/audit_347_staging_readonly.cjs']);
 console.log('Refresh both staging tabs. Driver: allow location, Add later or Save and continue, then Go Online.');
 console.log('Use a different passenger account in another browser profile or private window for the booking test.');
}
if(require.main===module)main().catch(error=>{console.error('BLOCKED: '+error.message);process.exitCode=1;});
