'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..'),flush=()=>new Promise(resolve=>setImmediate(resolve));
const end={id:'end-1',status:'pending',locationAvailable:true,expiresAt:Date.now()+300000,responses:{}};
const request={requestId:'ride',status:'in_transit',type:'ehailing',commuterId:'p',paymentMethod:'card',destination:'Durban',tripEndSafety:end};
function passenger(){
 const dom=new JSDOM('<div id="sheetContent"></div>',{runScripts:'outside-only',url:'https://example.test',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[];
 w.firebase={auth:()=>({currentUser:{uid:'p-auth'}})};
 w.ASIYE={state:{userId:'p'},ui:{escape:s=>String(s||''),toast:()=>{}},goNegotiation:{post:async(...args)=>{calls.push(args);return {ok:true};}}};
 w.eval(fs.readFileSync(path.join(root,'assets/passenger-v2/js/ride-controller.js'),'utf8'));
 w.ASIYE.ride.requestId='ride';return {dom,w,calls};
}
for(const accepted of [true,false])test(`passenger must explicitly ${accepted?'approve':'decline'} the current request; restoration never auto-approves`,async()=>{
 const {dom,w,calls}=passenger();try{
  w.ASIYE.ride.renderInTransit({...request,tripEndSafety:JSON.stringify(end)});
  assert.equal(calls.length,0);assert.match(w.document.querySelector('[role="alertdialog"]').textContent,/before your destination/);
  w.document.querySelector(`[data-end-answer="${accepted?'yes':'no'}"]`).click();await flush();
  assert.equal(calls.length,1);assert.equal(calls[0][0],'goTripActionSecure');assert.equal(calls[0][1].accepted,accepted);
  assert.equal(calls[0][1].endRequestId,'end-1');assert.equal(calls[0][1].requestId,'ride');
 }finally{dom.window.close();}
});
test('expired and already-answered passenger requests keep the ride active without another confirmation',()=>{
 const {dom,w,calls}=passenger();try{
  for(const patch of [{expiresAt:Date.now()-1},{status:'declined'}, {responses:{p:{accepted:true}}}]){
   w.ASIYE.ride.renderInTransit({...request,tripEndSafety:{...end,...patch}});
   assert.equal(w.document.querySelector('[data-end-answer]'),null);assert.equal(calls.length,0);
  }
 }finally{dom.window.close();}
});
test('driver warning requests passenger confirmation without settling, then an approved update finishes once',async()=>{
 const dom=new JSDOM('<div id="activeTripContent"><button id="driverCompleteTrip"></button></div>',{runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[];let confirm;
 w.ASIYE_DRIVER={state:{},ui:{escape:s=>String(s||''),toast(){},confirm:(title,message,callback)=>{confirm={title,message,callback};}}};
 w.eval(fs.readFileSync(path.join(root,'assets/driver-v2/js/trip-controller.js'),'utf8'));
 const trip=w.ASIYE_DRIVER.trip;trip.requestId='ride';trip.request=request;
 trip.goAction=async(action,body)=>{calls.push([action,body]);return {requiresPassengerConfirmation:true,locationAvailable:true};};
 trip.finishConfirmedTrip=async body=>calls.push(['finish',body]);
 try{
  await trip.confirmCompletion();assert.match(confirm.message,/not at your destination/);assert.equal(calls.length,1);
  await confirm.callback();assert.equal(calls[1][0],'requestEarlyEnd');assert.equal(calls.some(x=>x[0]==='finish'),false);
  const approved={...request,tripEndSafety:{...end,status:'approved'}};trip.request=approved;
  trip.renderEarlyEnd(approved);trip.renderEarlyEnd(approved);await flush();
  assert.equal(calls.filter(x=>x[0]==='finish').length,1);assert.equal(calls.find(x=>x[0]==='finish')[1].endRequestId,'end-1');
 }finally{dom.window.close();}
});
test('early completion screen says the trip ended here instead of claiming destination arrival',()=>{
 const {dom,w}=passenger();try{
  w.ASIYE.ride.getPassengerData=()=>({});w.ASIYE.ride.stop=()=>{};
  w.ASIYE.ride.renderCompleted({...request,tripCompletion:{mode:'agreed_early_end'}});
  assert.match(w.document.getElementById('sheetContent').textContent,/Trip ended here/);
  assert.doesNotMatch(w.document.getElementById('sheetContent').textContent,/You've arrived/);
 }finally{dom.window.close();}
});
