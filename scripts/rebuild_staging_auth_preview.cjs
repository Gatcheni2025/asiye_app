'use strict';
// Local-only staging preview refresh for reviewed Passenger/Driver login fix.
// Extracts the existing validated public staging SDK configuration from the
// current preview. NEVER prints keys, modifies original assets or deploys.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createStagingPreview,requireStagingConfig}=require('./build_staging_web_preview.cjs');
const ROOT=path.resolve(__dirname,'..');
const PROJECT='asiye-paystack-staging';
const NUMBER='1000800408896';
const BRANCH='fix/paystack-subaccounts-cash-card-no-wallet';
const REVIEW='8cbd56d';
const ALLOWED=new Set(['assets/passenger-v2/login.html','assets/passenger-v2/css/login.css','assets/passenger-v2/js/login.js','assets/driver-v2/js/login.js']);
function run(args,name='git'){
 const p=spawnSync(name,args,{cwd:ROOT,encoding:'utf8',maxBuffer:1024*1024,timeout:60000});
 if(p.error||p.status!==0)throw Error('Read-only prerequisite failed: '+name);
 return p.stdout.trim();
}
function parseConfig(text) {
 const obj={};
 for(const key of ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId']){
   const pattern=new RegExp('\\b'+key+'\\s*:\\s*["\\x27]([^"\\x27]+)["\\x27]');
   const match=text.match(pattern);
   if(!match)throw Error('Staging preview is missing a required public SDK config value.');
   obj[key]=match[1];
 }
 return requireStagingConfig(obj,PROJECT);
}
function main(){
 if(process.cwd()!==ROOT)throw Error('Run from the Asiye staging review repository root.');
 if(run(['config','get-value','project'],'gcloud')!==PROJECT ||
   run(['projects','describe',PROJECT,'--format=value(projectNumber)'],'gcloud')!==NUMBER)
   throw Error('BLOCKED: isolated staging project mismatch.');
 if(run(['branch','--show-current'])!==BRANCH)throw Error('BLOCKED: wrong Git review branch.');
 run(['merge-base','--is-ancestor',REVIEW,'HEAD']);
 const modified=run(['diff','--name-only',REVIEW,'HEAD','--','assets']).split('\n').filter(Boolean);
 if(modified.some(x=>!ALLOWED.has(x)) || modified.length===0)
   throw Error('Only the reviewed passenger login page and two login scripts can differ from the baseline.');
 if(run(['diff','--name-only','HEAD','--','assets']))throw Error('Uncommitted asset edits.');
 const preview=path.join(ROOT,'staging-preview');
 const configPath=path.join(preview,'passenger-v2/js/firebase.js');
 if(!fs.existsSync(configPath))throw Error('Existing validated staging preview is missing.');
 const cfg=parseConfig(fs.readFileSync(configPath,'utf8'));
 if(cfg.messagingSenderId!==NUMBER)throw Error('Web SDK sender ID does not match staging project number.');
 const out=createStagingPreview({
   assetsRoot:path.join(ROOT,'assets'),
   outputDir:preview,
   firebaseConfig:cfg,
   expectedProject:PROJECT
 });
 console.log('Asiye staging authentication preview regenerated locally.');
 console.log('Staging project='+out.projectId+' | examined='+out.examined+' | rewritten='+out.rewrittenFiles);
 console.log('Only ignored staging-preview/ and firebase.staging.generated.json changed. No cloud deployment.');
}
if(require.main===module){try{main()}catch(e){console.error('BLOCKED: '+e.message);process.exitCode=1;}}
module.exports={parseConfig};
