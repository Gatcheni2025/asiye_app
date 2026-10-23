'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {callbackService,publicInvoker,PROJECT,NUMBER,FUNCTION,main}=require('../scripts/repair_staging_paystack_return.cjs');
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
