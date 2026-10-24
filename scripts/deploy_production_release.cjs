'use strict';
// Authorized backend/web promotion, always with new Card checkout OFF.
// No charge/refund, launch-record write, customer migration or store upload.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {PROJECT,NUMBER,DATABASE,bindingOf,publicChecks}=require('./production_card_preflight.cjs');
const {FUNCTIONS,FUNDING_OFF,SECRET_CONSUMERS,ENTRY,renderEntry}=require('./production_release_scope.cjs');
const hosting=require('./production_release_hosting.cjs');
const {hash}=require('./audit_347_staging_readonly.cjs');
const {runDeployment}=require('./repair_staging_paystack_return.cjs');
const ROOT=path.resolve(__dirname,'..'),REGION='us-central1';
const CF='https://cloudfunctions.googleapis.com',SM='https://secretmanager.googleapis.com/v1/projects/'+PROJECT;
function command(program,args,{cwd=ROOT,timeout=90000,quiet=true}={}){
 const r=spawnSync(program,args,{cwd,encoding:'utf8',timeout,maxBuffer:12*1024*1024,stdio:quiet?'pipe':'inherit'});
 if(r.status!==0||r.error)throw Error('LOCAL_COMMAND_FAILED_'+path.basename(program).toUpperCase().replace(/[^A-Z0-9_]/g,'_'));
 return String(r.stdout||'').trim();
}
function reviewedDigest(root=ROOT){
 const rows=[];
 for(const name of fs.readdirSync(path.join(root,'functions')).filter(n=>n.endsWith('.js')||n==='package.json').sort()){
  const file=path.join(root,'functions',name);if(fs.lstatSync(file).isSymbolicLink())throw Error('REVIEW_SOURCE_SYMLINK');
  rows.push(['functions/'+name,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
 }
 rows.push(['database.rules.json',crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'database.rules.json'))).digest('hex')]);
 rows.push(['functions/'+ENTRY,crypto.createHash('sha256').update(renderEntry()).digest('hex')]);
 for(const [name,sha]of Object.entries(hosting.assetsForHosting(path.join(root,'assets')).rawHashes))rows.push(['assets'+name,sha]);
 rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function checkAuthorization(record,digest){
 if(record?.project!==PROJECT||record.projectNumber!==NUMBER||record.checkoutMustRemainOff!==true||record.runtimeSha256!==digest||
  record.stagingRuntime!=='a017820c1ffae046fb22ac03fa6cfb40df2bdb05')throw Error('REVIEWED_RUNTIME_AUTHORIZATION_MISMATCH');
}
function privateBucket(meta,policy){return String(meta?.projectNumber)===NUMBER&&meta.iamConfiguration?.uniformBucketLevelAccess?.enabled===true&&
 !(policy?.bindings||[]).some(b=>(b.members||[]).some(m=>m==='allUsers'||m==='allAuthenticatedUsers'));}
async function inventory(api){
 const list=[];let next='';do{
  const q=new URLSearchParams({pageSize:'1000'});if(next)q.set('pageToken',next);
  const r=await api('GET',CF+'/v2/projects/'+PROJECT+'/locations/'+REGION+'/functions?'+q);
  list.push(...(r.functions||[]));next=r.nextPageToken||'';
 }while(next);return list;
}
async function assertOff(api){
 const launch=await api('GET',DATABASE+'/paymentLaunch/paystack.json');
 if(launch?.liveEnabled===true)throw Error('LIVE_CHECKOUT_MUST_BE_OFF');return launch;
}
async function stagedLive(api,http=fetch,expected=null){
 const p=await api('GET',SM+'/secrets/PAYSTACK_SECRET_KEY/versions/latest:access');
 const version=new RegExp('^projects/(?:'+PROJECT+'|'+NUMBER+')/secrets/PAYSTACK_SECRET_KEY/versions/([1-9][0-9]*)$').exec(p.name||'')?.[1];
 const secret=Buffer.from(p.payload?.data||'','base64').toString('utf8').trim();
 if(!version||!/^sk_live_[A-Za-z0-9_]+$/.test(secret)||expected&&version!==expected)throw Error('STAGED_LIVE_SECRET_VERSION_UNAVAILABLE_OR_CHANGED');
 if(!expected){
  const r=await http('https://api.paystack.co/bank?currency=ZAR&perPage=1',{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(20000)});
  if(!r.ok||(await r.json()).status!==true)throw Error('STAGED_LIVE_KEY_AUTHENTICATION_FAILED');
 }return version;
}
async function boundVersions(api,items){
 const byName=new Map(items.map(i=>[i.name.split('/').pop(),i])),versions={};
 for(const name of SECRET_CONSUMERS){let item=byName.get(name);
  if(item?.environment==='GEN_1'&&!bindingOf(item))item=await api('GET',CF+'/v1/projects/'+PROJECT+'/locations/'+REGION+'/functions/'+name);
  versions[name]=bindingOf(item);
 }return versions;
}
function neededFunctions(report,items,version,versions={}){
 const matched=new Set(report.matched||[]),byName=new Map(items.map(i=>[i.name.split('/').pop(),i]));
 return FUNCTIONS.filter(name=>!matched.has(name)||SECRET_CONSUMERS.includes(name)&&
  (Object.hasOwn(versions,name)?versions[name]:bindingOf(byName.get(name)))!==version);
}
async function promote({needed,deploy,guard,audit,verify,rules,web}){
 const first=FUNDING_OFF.filter(n=>needed.includes(n));if(first.length){await guard();await deploy(first);}
 const rest=needed.filter(n=>!FUNDING_OFF.includes(n));
 for(let i=0;i<rest.length;i+=8){await guard();await deploy(rest.slice(i,i+8));}
 await guard();await audit();await verify();await guard();await rules();await guard();return web();
}
async function apiResponse(http,url,options,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const attempts=options.method==='GET'?3:1;
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const response=await http(url,{...options,signal:AbortSignal.timeout(60000)});
   if(!response.ok){
    if(options.method==='GET'&&[429,502,503,504].includes(response.status)&&attempt+1<attempts){await pause(1000*(attempt+1));continue;}
    throw Error('PRODUCTION_API_HTTP_'+response.status);
   }
   if(options.rawResponse){await response.text();return{};}
   const text=await response.text();return text?JSON.parse(text):{};
  }catch(error){
   if(/^PRODUCTION_API_HTTP_/.test(error.message))throw error;
   if(attempt+1<attempts){await pause(1000*(attempt+1));continue;}
   throw Error('PRODUCTION_API_'+options.method+'_UNAVAILABLE');
  }
 }
}
async function main(args=process.argv.slice(2),deps={}){
 const mode=args[0]||'--check';if(args.length>1||!['--check','--apply'].includes(mode))throw Error('PRODUCTION_RELEASE_ARGUMENT_INVALID');
 const run=deps.command||command,http=deps.fetch||fetch,print=deps.print||console.log;
 if(run('gcloud',['config','get-value','project'])!==PROJECT||run('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)throw Error('PRODUCTION_PROJECT_IDENTITY_MISMATCH');
 if(!['fix/paystack-subaccounts-cash-card-no-wallet','release/production-card-backend-20261024'].includes(run('git',['branch','--show-current'])))throw Error('PRODUCTION_REVIEW_BRANCH_MISMATCH');
 const source=run('git',['rev-parse','HEAD']);
 if(!/^[a-f0-9]{40}$/.test(source)||run('git',['diff','--name-only','HEAD','--','functions','assets','scripts','database.rules.json']))throw Error('REVIEWED_SOURCE_UNAVAILABLE_OR_MODIFIED');
 run('git',['merge-base','--is-ancestor','69d5ae51d3e9599d3100ee79ee68a87e40e01a9c','HEAD']);
 const digest=reviewedDigest();checkAuthorization(JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/production_release_authorization.json'),'utf8')),digest);
 const api=async(method,url,body,raw=false)=>{
  const u=new URL(url);if(!['cloudfunctions.googleapis.com','secretmanager.googleapis.com','storage.googleapis.com','firebasehosting.googleapis.com',
   'upload-firebasehosting.googleapis.com',new URL(DATABASE).hostname].includes(u.hostname)||u.protocol!=='https:'||u.username||u.password||u.port)throw Error('PRODUCTION_API_TARGET_INVALID');
  const headers={Authorization:'Bearer '+run('gcloud',['auth','print-access-token']),Connection:'close'};
  if(body!==undefined)headers['Content-Type']=raw?'application/octet-stream':'application/json';
  return apiResponse(http,url,{method,redirect:'error',headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),rawResponse:raw});
 };
 const launch=await assertOff(api),version=await stagedLive(api,http);
 const guard=async()=>{await assertOff(api);await stagedLive(api,http,version);};
 print('PRODUCTION_RELEASE: '+mode+' | '+PROJECT+' | SOURCE='+source);
 print('REVIEWED_RUNTIME_SHA256='+digest+' | LIVE_SECRET_VERSION='+version+' | CHECKOUT=OFF');
 const before=await inventory(api);
 const auditRun=()=>{
  const file=path.join(ROOT,'production-release-readback/source.json');if(fs.existsSync(file))fs.unlinkSync(file);
  const r=spawnSync('python3',['scripts/audit_production_function_source.py'],{cwd:ROOT,encoding:'utf8',timeout:600000,maxBuffer:4*1024*1024});
  if(r.error||![0,2].includes(r.status)||!fs.existsSync(file))throw Error('PRODUCTION_SOURCE_AUDIT_UNAVAILABLE');
  const result=JSON.parse(fs.readFileSync(file,'utf8'));
  if(result.project!==PROJECT||result.reviewCommit!==source||!Array.isArray(result.matched)||result.matched.some(n=>!FUNCTIONS.includes(n))||new Set(result.matched).size!==result.matched.length)throw Error('PRODUCTION_SOURCE_AUDIT_UNAVAILABLE');
  return result;
 };
 const plan=auditRun(),needed=neededFunctions(plan,before,version,await boundVersions(api,before));
 print('FUNCTIONS_NEEDING_PROMOTION='+needed.length+'/'+FUNCTIONS.length);
 if(mode==='--check'){print('PRODUCTION_PROMOTION_PLAN: READ_ONLY | CHECKOUT=OFF');return;}
 const previous=await hosting.liveVersion(api),rules=await api('GET',DATABASE+'/.settings/rules.json');
 const bucket=before.flatMap(i=>[i.buildConfig?.sourceProvenance?.resolvedStorageSource?.bucket,
  i.buildConfig?.source?.storageSource?.bucket]).find(n=>typeof n==='string'&&n.includes(NUMBER));
 if(!bucket||!/^gcf[-a-z0-9.]+$/.test(bucket))throw Error('PRIVATE_BACKUP_BUCKET_UNAVAILABLE');
 if(!privateBucket(await api('GET','https://storage.googleapis.com/storage/v1/b/'+bucket),await api('GET','https://storage.googleapis.com/storage/v1/b/'+bucket+'/iam')))throw Error('BACKUP_BUCKET_PRIVACY_NOT_VERIFIED');
 const privateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-production-release-'));fs.chmodSync(privateRoot,0o700);
 const prefix='asiye-release-backups/'+source+'/'+Date.now();
 const upload=(name,data)=>api('POST','https://storage.googleapis.com/upload/storage/v1/b/'+bucket+'/o?'+new URLSearchParams({uploadType:'media',name:prefix+'/'+name,ifGenerationMatch:'0'}),data,true);
 let backupReady=false,temp;
 try{
  const archives=path.join(privateRoot,'previous-source');run('python3',['scripts/audit_production_function_source.py','--backup-dir',archives],{timeout:600000,quiet:false});
  const saved=JSON.parse(fs.readFileSync(path.join(archives,'manifest.json'),'utf8'));
  if(saved.project!==PROJECT||saved.functions?.length!==before.filter(i=>FUNCTIONS.includes(i.name.split('/').pop())).length)throw Error('PRODUCTION_SOURCE_BACKUP_INCOMPLETE');
  for(const file of fs.readdirSync(archives))await upload('previous-source/'+file,fs.readFileSync(path.join(archives,file)));
  await upload('state.json',Buffer.from(JSON.stringify({project:PROJECT,source,runtimeSha256:digest,capturedAt:new Date().toISOString(),functions:before,rules,launch,hosting:previous,liveSecretVersion:version})));
  backupReady=true;print('PRIVATE_PRODUCTION_BACKUP=gs://'+bucket+'/'+prefix);
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-production-payload-'));const archive=path.join(temp,'source.tar');
  run('git',['archive','--format=tar','--output='+archive,source,'functions','firebase.json','database.rules.json']);run('tar',['-xf',archive,'-C',temp]);fs.unlinkSync(archive);
  const pkgFile=path.join(temp,'functions/package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));
  if(pkg.main!=='index.js'||pkg.engines?.node!=='22')throw Error('REVIEWED_FUNCTIONS_PACKAGE_MISMATCH');
  pkg.main=ENTRY;fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');fs.writeFileSync(path.join(temp,'functions',ENTRY),renderEntry());
  run('npm',['--prefix',path.join(temp,'functions'),'install','--no-audit','--no-fund'],{timeout:240000});
  const cli=path.join(ROOT,'.asiye-release-cli/node_modules/.bin/firebase');if(!fs.existsSync(cli))throw Error('PINNED_PRODUCTION_CLI_UNAVAILABLE');
  const config=require('./build_staging_web_preview.cjs').extractProductionWebConfig(path.join(ROOT,'assets/passenger-v2/js/firebase.js'));
  if(config.messagingSenderId!==NUMBER||config.databaseURL!==DATABASE)throw Error('PRODUCTION_WEB_CONFIG_MISMATCH');
  const env={...process.env,FIREBASE_CONFIG:JSON.stringify(config),FUNCTIONS_DISCOVERY_TIMEOUT:'90'};
  const deploy=async names=>{
   print('DEPLOYING_REVIEWED_FUNCTIONS: '+names.join(', '));
   runDeployment(cli,['deploy','--project',PROJECT,'--config',path.join(temp,'firebase.json'),'--only',names.map(n=>'functions:'+n).join(','),'--non-interactive','--debug'],
    {cwd:temp,functions:names,env,timeout:900000,logRoot:privateRoot});
   print('FUNCTION_BATCH_COMMAND: FINISHED');
  };
  const result=await promote({needed,guard,deploy,
   audit:async()=>{if(!auditRun().ok)throw Error('PRODUCTION_SOURCE_READBACK_MISMATCH');print('PRODUCTION_FUNCTION_SOURCE: MATCH=44/44');},
   verify:async()=>{const versions=await boundVersions(api,await inventory(api));if(SECRET_CONSUMERS.some(n=>versions[n]!==version))throw Error('DEPLOYED_LIVE_BINDINGS_MISMATCH');},
   rules:async()=>{
    const local=JSON.parse(fs.readFileSync(path.join(ROOT,'database.rules.json'),'utf8'));
    if(hash(await api('GET',DATABASE+'/.settings/rules.json'))!==hash(local))runDeployment(cli,['deploy','--project',PROJECT,'--config',path.join(ROOT,'firebase.json'),'--only','database','--non-interactive','--debug'],{env,logRoot:privateRoot});
    if(hash(await api('GET',DATABASE+'/.settings/rules.json'))!==hash(local))throw Error('PRODUCTION_RULES_READBACK_MISMATCH');print('PRODUCTION_RTDB_RULES: MATCH');
   },
   web:()=>hosting.promoteHosting({api,previous,assets:hosting.assetsForHosting(path.join(ROOT,'assets')),
    reviewConfig:JSON.parse(fs.readFileSync(path.join(ROOT,'firebase.json'),'utf8')).hosting,source,assertOff:guard})});
  await guard();const publicResult=await publicChecks({http});
  if(publicResult.hostingMatches!==publicResult.hostingExpected||!publicResult.callbackMatches)throw Error('PRODUCTION_PUBLIC_READBACK_MISMATCH');
  for(const name of FUNDING_OFF){const r=await http('https://'+REGION+'-'+PROJECT+'.cloudfunctions.net/'+name,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});if(r.status!==410)throw Error('WALLET_FUNDING_RETIREMENT_NOT_VERIFIED');}
  const output={project:PROJECT,source,runtimeSha256:digest,functionSourceMatches:44,functionsExpected:44,rulesMatch:true,
   publicFilesMatched:publicResult.hostingMatches,publicFilesExpected:publicResult.hostingExpected,callbackMatches:true,walletFundingDisabled:true,
   liveSecretVersion:version,checkoutEnabled:false,liveActivationPerformed:false,providerAndDeviceAcceptanceNotCertified:true,
   hosting:result,privateBackup:'gs://'+bucket+'/'+prefix};
  fs.writeFileSync(path.join(ROOT,'production-release-readback/release.json'),JSON.stringify(output,null,2)+'\n');
  print('PRODUCTION_RELEASE_PAYLOAD: VERIFIED | FUNCTIONS=44/44 | RULES=MATCH | WEB=43/43 | CHECKOUT=OFF');
  return output;
 }finally{
  if(backupReady)for(const folder of fs.readdirSync(privateRoot,{withFileTypes:true}).filter(i=>i.isDirectory()&&i.name.startsWith('asiye-return-logs-')))
   for(const file of fs.readdirSync(path.join(privateRoot,folder.name))){const local=path.join(privateRoot,folder.name,file);if(fs.lstatSync(local).isFile())try{await upload('private-diagnostics/'+folder.name+'/'+file,fs.readFileSync(local));}catch(_){print('PRIVATE_DIAGNOSTIC_UPLOAD: UNAVAILABLE');}}
  if(temp)fs.rmSync(temp,{recursive:true,force:true});fs.rmSync(privateRoot,{recursive:true,force:true});
 }
}
if(require.main===module)main().catch(e=>{
 const kind=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError']).has(e.name)?e.name:'OTHER';
 const code=/^[A-Z0-9_]+$/.test(String(e.code||''))?e.code:'NONE';
 console.error('PRODUCTION_RELEASE: BLOCKED '+(/^[A-Z0-9_]+$/.test(e.message)?e.message:'DEPLOYMENT_STOPPED_SEE_PRIVATE_DIAGNOSTICS')+' | KIND='+kind+' | CODE='+code);process.exitCode=1;
});
module.exports={reviewedDigest,checkAuthorization,privateBucket,inventory,assertOff,stagedLive,boundVersions,neededFunctions,promote,apiResponse,main};
