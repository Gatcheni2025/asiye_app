'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..'),flush=()=>new Promise(resolve=>setImmediate(resolve));
const id='completed-trip-rating-001';
const completed={requestId:id,key:id,type:'ehailing',status:'completed',commuterId:'p',taxiId:'d',paymentMethod:'cash',finalAmount:85};
function setup(post){
 const dom=new JSDOM('<div id="driverCompletedOverlay"><div id="driverCompletedFare"></div><div id="driverCompletedDetails"></div></div>',
  {runScripts:'outside-only',url:'https://asiye.test',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[],toasts=[];
 const add=w.document.addEventListener.bind(w.document);
 w.document.addEventListener=(name,fn,options)=>{if(name!=='DOMContentLoaded')add(name,fn,options);};
 let stops=0;
 w.ASIYE_DRIVER={state:{driverId:'d',driver:{}},navigator:{stop:()=>stops++},requests:{postNegotiation:async(endpoint,body)=>{
  calls.push([endpoint,body]);return post(body);
 }}};
 for(const file of ['assets/driver-v2/js/app.js','assets/driver-v2/js/trip-controller.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 w.ASIYE_DRIVER.ui.toast=(...args)=>toasts.push(args);
 w.ASIYE_DRIVER.trip.requestId='new-active-trip';
 return {dom,w,calls,toasts,stops:()=>stops};
}
const saved=body=>({ok:true,ratings:{version:1,driverToPassenger:{[body.passengerId]:{score:body.score,driverUid:'d-auth',submittedAt:1}}}});
test('rating waits for server confirmation, uses the completed trip after cleanup and survives reopening',async()=>{
 let resolve;const f=setup(body=>new Promise(r=>{resolve=()=>r(saved(body));}));
 const {w,dom,calls,toasts}=f;
 try{
  const request={...completed};w.ASIYE_DRIVER.ui.showTripCompleted(request);
  w.document.querySelector('[data-passenger-rating="5"]').click();
  const button=w.document.getElementById('submitPassengerRating');button.click();await flush();
  assert.equal(button.textContent,'Saving…');assert.equal(button.disabled,true);assert.equal(toasts.length,0);
  button.dispatchEvent(new w.Event('click'));await flush();assert.equal(calls.length,1);
  assert.equal(calls[0][0],'goTripActionSecure');assert.equal(calls[0][1].requestId,id);assert.equal(calls[0][1].score,5);
  resolve();await flush();
  assert.match(w.document.getElementById('driverCompletedDetails').textContent,/Passenger rating submitted/);
  assert.equal(w.document.getElementById('submitPassengerRating'),null);assert.equal(toasts[0][0],'Passenger rating saved.');
  w.ASIYE_DRIVER.ui.showTripCompleted({...completed,tripRatings:request.tripRatings},{history:true});
  assert.equal(w.document.querySelector('[data-passenger-rating]'),null);assert.equal(calls.length,1);
  assert.equal(w.ASIYE_DRIVER.trip.requestId,'new-active-trip');
 }finally{dom.window.close();}
});
test('failed saves keep the selected stars and enable retry, without a false success',async()=>{
 let fail=true;const {w,dom,toasts,calls}=setup(async body=>{if(fail)throw Error('Synthetic connection interrupted.');return saved(body);});
 try{
  w.ASIYE_DRIVER.ui.showTripCompleted({...completed});
  w.document.querySelector('[data-passenger-rating="4"]').click();w.document.getElementById('submitPassengerRating').click();await flush();
  const button=w.document.getElementById('submitPassengerRating');assert.equal(button.disabled,false);assert.equal(button.textContent,'Submit rating');
  assert.equal(toasts[0][0],'Synthetic connection interrupted.');assert.equal(toasts.some(([text])=>text==='Passenger rating saved.'),false);
  fail=false;button.click();await flush();assert.equal(calls[1][1].score,4);
  assert.match(w.document.getElementById('driverCompletedDetails').textContent,/Passenger rating submitted/);
 }finally{dom.window.close();}
});
test('Club requires an explicit passenger choice and excludes members who did not complete',async()=>{
 const {w,dom,calls}=setup(async body=>saved(body));
 try{
  w.ASIYE_DRIVER.ui.showTripCompleted({...completed,type:'club',passengers:{p:{name:'First',status:'completed'},p2:{name:'Second',status:'completed'},left:{name:'Left',status:'cancelled_by_commuter'}}});
  w.document.querySelector('[data-passenger-rating="5"]').click();
  const button=w.document.getElementById('submitPassengerRating');assert.equal(button.disabled,true);
  const select=w.document.getElementById('ratingPassengerId');assert.equal(select.querySelector('option[value="left"]'),null);
  select.value='p2';select.dispatchEvent(new w.Event('change'));assert.equal(button.disabled,false);button.click();await flush();
  assert.equal(calls[0][1].passengerId,'p2');assert.ok(w.document.getElementById('submitPassengerRating'),'Other completed member can still be rated');
 }finally{dom.window.close();}
});
test('history rating does not stop navigation or release a newer booking when closed',()=>{
 const {w,dom,stops}=setup(async body=>saved(body));
 try{
  let rendered=0;w.ASIYE_DRIVER.trip.request={status:'in_transit'};
  w.ASIYE_DRIVER.trip.handleState=()=>rendered++;
  w.ASIYE_DRIVER.trip.releaseDriver=()=>assert.fail('Historical rating cannot release an active booking');
  w.ASIYE_DRIVER.ui.showTripCompleted({...completed},{history:true});w.ASIYE_DRIVER.ui.closeTripCompleted();
  assert.equal(stops(),0);assert.equal(rendered,1);assert.equal(w.ASIYE_DRIVER.trip.requestId,'new-active-trip');
 }finally{dom.window.close();}
});
test('Trip history reloads the saved trip and reopens its rating after refresh',async()=>{
 const {w,dom}=setup(async body=>saved(body));
 try{
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const current={...completed,tripRatings:JSON.stringify(saved({passengerId:'p',score:5}).ratings)};
  w.firebase={auth:()=>({currentUser:{uid:'d-auth'}}),database:()=>({ref:key=>({
   orderByChild(){return this;},equalTo(){return this;},limitToLast(){return this;},
   once:async()=>key==='requests'?{forEach:fn=>fn({key:id,val:()=>current})}:{val:()=>current}
  })})};
  w.eval(fs.readFileSync(path.join(root,'assets/member-pages.js'),'utf8'));
  await w.AsiyePages.open('trips');
  const button=w.document.querySelector('[data-rate-completed-trip]');assert.ok(button);button.click();await flush();
  assert.match(w.document.getElementById('driverCompletedDetails').textContent,/Passenger rating submitted/);
  assert.equal(w.document.getElementById('submitPassengerRating'),null);
 }finally{dom.window.close();}
});
