'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {callbackService,publicInvoker,repairMode,deploymentSummary,preserveDeploymentLog,runDeployment,PROJECT,NUMBER,FUNCTION,main}=require('../scripts/repair_staging_paystack_return.cjs');
const metadata=(project=PROJECT)=>({name:`projects/${project}/locations/us-central1/functions/${FUNCTION}`,
 environment:'GEN_2',state:'ACTIVE',serviceConfig:{ingressSettings:'ALLOW_ALL',
 service:`projects/${project}/locations/us-central1/services/paystackpaymentreturn`}});
test('repair cannot grant invocation to production, a different service, or another endpoint',()=>{
 assert.equal(callbackService(metadata()),'paystackpaymentreturn');
 assert.equal(callbackService(metadata(NUMBER)),'paystackpaymentreturn');
 for(const value of [metadata('asiye-80386'),{...metadata(),state:'FAILED'},
  {...metadata(),environment:'GEN_1'},{...metadata(),name:metadata().name.replace(FUNCTION,'prepareTripPayment')},
  {...metadata(),serviceConfig:{...metadata().serviceConfig,service:metadata().serviceConfig.service.replace('paystackpaymentreturn','paystackwebhook')}},
  {...metadata(),serviceConfig:{...metadata().serviceConfig,ingressSettings:'ALLOW_INTERNAL_ONLY'}}])
  assert.throws(()=>callbackService(value));
});
test('conditional or unrelated IAM bindings are not mistaken for public callback invocation',()=>{
 assert.equal(publicInvoker({bindings:[{role:'roles/run.invoker',members:['allUsers']}]}),true);
 for(const binding of [{role:'roles/owner',members:['allUsers']},{role:'roles/run.invoker',members:['allAuthenticatedUsers']},
  {role:'roles/run.invoker',members:['allUsers'],condition:{expression:'false'}}])
  assert.equal(publicInvoker({bindings:[binding]}),false);
});
test('public diagnosis uses only anonymous GETs and reports a forbidden callback as blocked',async()=>{
 const original={fetch:global.fetch,argv:process.argv,exitCode:process.exitCode,log:console.log};
 const calls=[],messages=[];
 global.fetch=async(url,options)=>{
  calls.push({url,options});
  return {status:url.includes('/paystackPaymentReturn?')?403:405,text:async()=> 'Synthetic response'};
 };
 process.argv=[process.execPath,'repair_staging_paystack_return.cjs','--check'];
 console.log=value=>messages.push(value);
 try{
  await main();
  assert.equal(process.exitCode,2);
  assert.equal(calls.length,3);
  for(const {url,options} of calls){
   assert.equal(new URL(url).origin,'https://us-central1-'+PROJECT+'.cloudfunctions.net');
   assert.equal(options.method,undefined);
   assert.equal(options.headers,undefined);
  }
  assert.ok(messages.some(message=>message.includes('HTTP 403')));
  assert.ok(messages.some(message=>message.includes('No cloud resources or payments changed')));
 }finally{
  global.fetch=original.fetch;process.argv=original.argv;process.exitCode=original.exitCode;console.log=original.log;
 }
});
test('resume stops at a blocked callback before any command, deployment or IAM mutation',async()=>{
 const original={fetch:global.fetch,argv:process.argv,log:console.log};
 const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return {status:403,text:async()=> 'Forbidden'};};
 process.argv=[process.execPath,'repair_staging_paystack_return.cjs','--resume-after-function'];
 console.log=()=>{};
 try{
  await assert.rejects(main(),/Resume requires HTTP 200 with the exact reviewed callback page/);
  assert.equal(calls.length,3);
  for(const {options} of calls){assert.equal(options.method,undefined);assert.equal(options.headers,undefined);}
 }finally{global.fetch=original.fetch;process.argv=original.argv;console.log=original.log;}
 assert.equal(repairMode([]),'--check');
 assert.equal(repairMode(['--resume-after-function']),'--resume-after-function');
 assert.throws(()=>repairMode(['--resume-after-function','--apply']));
});
test('successful resume publishes Hosting and audits it without a function build, secret read or IAM command',()=>{
 // Isolate the real command orchestrator in a child; only external boundaries
 // are simulated. Any cloud command outside the expected read/Hosting scope fails.
 const program=async function(){
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const PROJECT='asiye-paystack-staging',NUMBER='1000800408896',calls=[];
  let published=false,audited=false;
  const {renderPaymentReturn}=require('./functions/paystack-return');
  require('node:child_process').spawnSync=(command,args)=>{
   calls.push([command,...args]);let stdout='';
   if(command==='git'&&args[0]==='branch')stdout='fix/paystack-subaccounts-cash-card-no-wallet';
   else if(command==='git'&&args[0]==='diff')stdout='';
   else if(command==='git'&&args[0]==='rev-parse')stdout='a'.repeat(40);
   else if(command==='gcloud'&&args.join(' ')==='config get-value project')stdout=PROJECT;
   else if(command==='gcloud'&&args.join(' ')==='config get-value account')stdout='operator@example.test';
   else if(command==='gcloud'&&args[0]==='projects'&&args[1]==='describe')stdout=NUMBER;
   else if(command==='gcloud'&&args[0]==='functions'&&args[1]==='describe')stdout=JSON.stringify({
    name:`projects/${PROJECT}/locations/us-central1/functions/paystackPaymentReturn`,state:'ACTIVE',environment:'GEN_2',
    serviceConfig:{ingressSettings:'ALLOW_ALL',service:`projects/${NUMBER}/locations/us-central1/services/paystackpaymentreturn`}});
   else if(command.endsWith('/.asiye-staging-cli/node_modules/.bin/firebase')&&args[0]==='projects:list')stdout='{}';
   else if(command.endsWith('/.asiye-staging-cli/node_modules/.bin/firebase')&&args[0]==='deploy'){
    assert.equal(args[args.indexOf('--only')+1],'hosting');
    assert.equal(args[args.indexOf('--project')+1],PROJECT);published=true;
   }else if(command==='node'&&args[0]==='--test'){}
   else if(command==='node'&&args[0]==='scripts/audit_347_staging_readonly.cjs'){
    assert.ok(published);audited=true;
   }else throw Error('Unexpected external command during resume: '+command+' '+args.join(' '));
   return {status:0,stdout,stderr:''};
  };
  const exists=fs.existsSync;
  fs.existsSync=file=>String(file).endsWith('/.asiye-staging-cli/node_modules/.bin/firebase')||exists(file);
  const config={apiKey:'AIza'+'a'.repeat(25),authDomain:PROJECT+'.firebaseapp.com',
   databaseURL:'https://'+PROJECT+'-default-rtdb.firebaseio.com',projectId:PROJECT,
   storageBucket:PROJECT+'.appspot.com',messagingSenderId:NUMBER,appId:'1:'+NUMBER+':web:abc123'};
  global.fetch=async url=>({ok:true,status:url.includes('/paystackWebhook')||url.includes('/verifyTripCardPayment')?405:200,
   text:async()=>url.includes('/paystackPaymentReturn?')?renderPaymentReturn(PROJECT,'ASIYE-RETURN-PROBE'):
    Object.entries(config).map(([key,value])=>key+':'+JSON.stringify(value)).join(',')});
  require('./scripts/build_staging_web_preview.cjs').createStagingPreview=options=>{
   assert.equal(options.expectedProject,PROJECT);return {preview:'synthetic-preview',generatedConfig:'synthetic-staging-config'};
  };
  require('./scripts/audit_347_staging_readonly.cjs').auditHosted=async()=>({matched:43,fail:['synthetic=CONTENT_MISMATCH']});
  const messages=[];console.log=value=>messages.push(value);
  process.argv=[process.execPath,'repair_staging_paystack_return.cjs','--resume-after-function'];
  await require('./scripts/repair_staging_paystack_return.cjs').main();
  assert.ok(published&&audited);
  assert.equal(calls.filter(call=>call.includes('deploy')).length,1);
  assert.ok(messages.some(message=>message.startsWith('RETURN_REPAIR: VERIFIED')));
  assert.ok(messages.some(message=>message.startsWith('CALLBACK_IAM: UNCHANGED')));
 };
 const child=require('node:child_process').spawnSync(process.execPath,['-e','('+program.toString()+')().catch(e=>{console.error(e);process.exitCode=1;});'],
  {cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);
});
test('a real failed child process retains private logs after disposable deployment source is removed',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-return-diagnostics-test-'));
 const source=path.join(temp,'source');fs.mkdirSync(source);
 const privateText='SYNTHETIC_SECRET_NEVER_PRINT';
 const program="require('node:fs').writeFileSync('firebase-debug.log','Authorization: Bearer "+privateText+"');console.error('Error: HTTP Error: 403, PERMISSION_DENIED "+privateText+"');process.exitCode=1;";
 try{
  let failure;
  try{runDeployment(process.execPath,['-e',program],{cwd:source,logRoot:temp});}catch(error){failure=error;}
  assert.ok(failure);
  assert.match(failure.message,/failure signals=PERMISSION_DENIED/);
  assert.doesNotMatch(failure.message,/SYNTHETIC_SECRET|Authorization|Bearer/);
  const folder=path.join(temp,fs.readdirSync(temp).find(name=>name.startsWith('asiye-return-logs-')));
  fs.rmSync(source,{recursive:true});
  assert.equal(fs.statSync(folder).mode&0o777,0o700);
  for(const file of ['firebase-output.log','firebase-debug.log']){
   assert.equal(fs.statSync(path.join(folder,file)).mode&0o777,0o600);
   assert.ok(fs.readFileSync(path.join(folder,file),'utf8').includes(privateText));
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('only a successful callback update plus the sole cleanup-policy error can continue to live readback',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-return-cleanup-test-'));
 const log=console.log,messages=[];console.log=value=>messages.push(value);
 const success='functions[paystackPaymentReturn(us-central1)] Successful update operation.';
 const cleanup='Error: Functions successfully deployed but could not set up cleanup policy in location us-central1.';
 const invoke=(output,functions=[FUNCTION])=>runDeployment(process.execPath,['-e',
  'process.stdout.write('+JSON.stringify(output)+');process.exitCode=1;'],{cwd:temp,logRoot:temp,functions});
 try{
  assert.doesNotThrow(()=>invoke(success+'\n'+cleanup));
  assert.ok(messages.some(message=>message.includes('Live readback is still required')));
  assert.throws(()=>invoke(cleanup));
  assert.throws(()=>invoke(success+'\n'+cleanup+'\nError: Build failed.'));
  assert.throws(()=>invoke(success+'\n'+cleanup,[]),'Hosting cannot swallow a functions warning');
 }finally{console.log=log;fs.rmSync(temp,{recursive:true,force:true});}
});
test('deployment summaries expose only fixed error categories and do not follow a debug-log symlink',()=>{
 assert.equal(deploymentSummary({stderr:'Error: build failed PRIVATE_RAW_TEXT'}),'BUILD_FAILED');
 assert.equal(deploymentSummary({stderr:'PRIVATE_RAW_TEXT',error:{code:'ETIMEDOUT'}}),'COMMAND_TIMEOUT');
 assert.equal(deploymentSummary({stderr:'PRIVATE_RAW_TEXT'}),'UNCLASSIFIED');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'asiye-return-log-link-test-'));
 try{
  const privateFile=path.join(temp,'private');fs.writeFileSync(privateFile,'DO_NOT_FOLLOW');
  fs.symlinkSync(privateFile,path.join(temp,'firebase-debug.log'));
  const folder=preserveDeploymentLog({stdout:'Synthetic failure'},{cwd:temp,logRoot:temp});
  assert.equal(fs.existsSync(path.join(folder,'firebase-debug.log')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
