'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');
function payments(){
 const values=new Map(),opened=[],calls=[],message={textContent:''},retry={},check={};
 const node={dataset:{requestId:'ride'},querySelector:key=>({'[data-card-payment-message]':message,'[data-card-payment-retry]':retry,'[data-card-payment-check]':check})[key]};
 let failure=true;
 const context={console,document:{querySelector:()=>node,querySelectorAll:()=>[],addEventListener(){}},
  localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
  firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'synthetic'}})},
  fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return failure
   ?{ok:false,json:async()=>({error:'The assigned driver is not registered with Paystack.',code:'payment/driver-subaccount-required'})}
   :{ok:true,json:async()=>({method:'card',ready:false,reference:'one-immutable-reference',authorizationUrl:'https://checkout.paystack.com/synthetic'})};},
  ASIYE:{state:{userId:'passenger'},ui:{toast(){}},booking:{}},AsiyePages:{openExternalPayment:url=>opened.push(url)},addEventListener(){}};
 context.window=context;vm.createContext(context);vm.runInContext(read('assets/passenger-v2/js/wallet.js'),context);
 return {api:context.ASIYE.payments,calls,opened,message,retry,check,enable:()=>{failure=false;}};
}
test('missing driver setup stays visible without repeated charge attempts; explicit retry opens one checkout',async()=>{
 const h=payments();await assert.rejects(h.api.prepare('ride'),e=>e.code==='payment/driver-subaccount-required');
 assert.match(h.message.textContent,/driver needs to finish card payment setup/);assert.equal(h.retry.hidden,false);
 assert.equal(h.opened.length,0);
 await h.api.handleTripState({requestId:'ride',type:'ehailing',rideType:'go',status:'payment_required',paymentStatus:'payment_required',paymentMethod:'card',taxiId:'driver',negotiationEnabled:true,fareStatus:'agreed'});
 assert.equal(h.calls.length,1,'Profile or GPS events must not keep trying a failed setup');
 h.enable();await h.retry.onclick();assert.equal(h.calls.length,2);assert.equal(h.opened.length,1);
 assert.equal(h.api.pendingCard().reference,'one-immutable-reference');assert.equal(h.check.hidden,false);
 assert.equal(h.retry.textContent,'Continue to Paystack');
});
function driver(){
 const context={console,ASIYE_DRIVER:{state:{},ui:{toast(){}},map:{}},document:{getElementById:()=>null}};
 context.window=context;vm.createContext(context);vm.runInContext(read('assets/driver-v2/js/trip-controller.js'),context);
 const trip=context.ASIYE_DRIVER.trip;trip.requestId='ride';return trip;
}
const ready=()=>({requestId:'ride',type:'ehailing',paymentMethod:'card',goContinuationVersion:2,
 fareStatus:'agreed',paymentsReady:true,paymentStatus:'held',status:'accepted'});
test('confirmed Card automatically starts protected pickup and navigation once, while Cash and unpaid Card stay separate',async()=>{
 const trip=driver();let live=ready(),actions=0,navigations=0;
 trip.requestRef={once:async()=>({val:()=>live})};
 trip.goAction=async name=>{assert.equal(name,'onWay');actions++;live={...live,status:'driver_on_way'};};
 trip.startPickupNavigation=async value=>{assert.equal(value.status,'driver_on_way');navigations++;};
 for(const patch of [{paymentMethod:'cash'},{paymentStatus:'pending'},{paymentsReady:false},{status:'payment_required'},{type:'club'}])
  await trip.resumeConfirmedCardPickup({...ready(),...patch});
 assert.equal(actions,0);assert.equal(navigations,0);
 await Promise.all([trip.resumeConfirmedCardPickup(ready()),trip.resumeConfirmedCardPickup(ready())]);
 await trip.resumeConfirmedCardPickup(live);assert.equal(actions,1);assert.equal(navigations,1);
});
test('Card navigation does not start after a cancellation wins the server transition',async()=>{
 const trip=driver();trip.goAction=async()=>{};trip.requestRef={once:async()=>({val:()=>({...ready(),status:'cancelled_by_admin'})})};
 trip.startPickupNavigation=async()=>assert.fail('Cancelled trip must not navigate');await trip.resumeConfirmedCardPickup(ready());
});
test('staging test claim preserves existing roles without granting finance or enrollment roles',()=>{
 const {testerClaims}=require('../scripts/grant_staging_trip_tester.cjs');
 const user={localId:'tester',email:'tester@example.test',emailVerified:true,customAttributes:'{"existing":"kept"}'};
 const claims=testerClaims(user,user.email);assert.deepEqual(claims,{existing:'kept',stagingTripTester:true});
 for(const patch of [{disabled:true},{emailVerified:false},{email:'other@example.test'}])
  assert.throws(()=>testerClaims({...user,...patch},user.email));
});
test('partial-deployment recovery uses bounded function batches and audits both payment setup pages',()=>{
 const {NAMES,batches}=require('../scripts/deploy_staging_card_test_tools.cjs');
 assert.equal(NAMES.length,23);assert.deepEqual(batches(NAMES).flat(),NAMES);assert.ok(batches(NAMES).every(batch=>batch.length<=3));
 assert.throws(()=>batches(NAMES,17));
 const audit=require('../scripts/audit_347_staging_readonly.cjs');assert.equal(audit.manifest().length,43);
 for(const file of ['admin/testing.html','admin/testing.js','admin/testing.css','driver-v2/payout.html','driver-v2/js/payout.js'])
  assert.ok(audit.FILES.includes(file));
 assert.equal(audit.FILES.length,46);
});
