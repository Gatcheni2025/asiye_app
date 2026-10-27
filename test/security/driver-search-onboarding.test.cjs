'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const load=(w,p)=>w.eval(fs.readFileSync(path.join(root,p),'utf8'));
const dom=html=>new JSDOM(html||'',{runScripts:'outside-only',url:'https://example.test/',virtualConsole:new VirtualConsole()});

test('driver startup reaches map, GPS, dashboard and offers even when optional contact lookup never finishes',async()=>{
 const d=dom(),w=d.window,calls=[];
 try {
  w.firebase={database:()=>({ref:()=>({on:()=>()=>{},off(){}})})};
  w.AsiyeEnrollment={requireApproval:async()=>true};
  w.AsiyeDriverPresence={start:()=>calls.push('presence')};
  w.AsiyeDriverBanking={isReady:()=>true,require:async()=>true};
  w.AsiyeSafetyContact={ensure:()=>{calls.push('contact');return new Promise(()=>{});}};
  load(w,'assets/driver-v2/js/state.js');load(w,'assets/driver-v2/js/app.js');
  const a=w.ASIYE_DRIVER;a.initialize=()=>{};
  a.map={init:()=>calls.push('map')};a.location={start:()=>calls.push('GPS')};
  a.metrics.refresh=async()=>{};
  a.ui={updateDriverProfileUI(){},updateTopStatus(){},showDashboard:()=>calls.push('dashboard'),renderDashboard(){},toast(){},showDriverLoginRequired:()=>assert.fail('Driver must stay signed in')};
  a.requests={restoreActiveRequest:async()=>false,start:()=>calls.push('offers')};
  await a.loadDriver('driver',{isOnline:false});
  assert.ok(calls.includes('map'));assert.ok(calls.includes('GPS'));assert.ok(calls.includes('dashboard'));
  assert.ok(calls.indexOf('map')<calls.indexOf('contact'));
  calls.length=0;await a.loadDriver('driver',{isOnline:true});
  assert.ok(calls.includes('offers'));assert.equal(calls.includes('contact'),false,'An online driver must not have offers covered by setup');
 } finally {d.window.close();}
});

for(const action of ['later','save'])test(`trusted-contact setup can ${action} and return to the existing dashboard`,async()=>{
 const d=dom(),w=d.window,saved=[];
 try {
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.ASIYE_DRIVER={state:{driverId:'driver',driver:{}},ui:{toast(){}}};
  w.firebase={auth:()=>({currentUser:null})};
  w.AsiyeSafetyContact={getMembers:async()=>[],saveMember:async member=>saved.push(member)};
  load(w,'assets/member-pages.js');
  await w.AsiyePages.open('safety',{setup:true});const dialog=w.AsiyePages.dialog;
  if(action==='later'){
   dialog.querySelector('[data-family-later]').click();assert.equal(w.sessionStorage.getItem('asiye-contact-later:driver:driver'),'true');
   let opened=false;w.AsiyePages.open=async()=>{opened=true;};
   assert.equal(await w.AsiyeSafetyContact.ensure({role:'driver'}),true);assert.equal(opened,false);
  }else{
   const form=dialog.querySelector('form');form.elements.name.value='Family Member';form.elements.relationship.value='Sibling';form.elements.phone.value='0821234567';
   await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(saved.length,1);assert.equal(saved[0].phone,'0821234567');
  }
  assert.equal(dialog.isConnected,false);assert.ok(w.ASIYE_DRIVER.state.driverId);
 } finally {d.window.close();}
});

test('Go search continues after six checks, retries after network errors, and stops for cancellation, counter or assignment',async()=>{
 const d=dom('<div id="sheetContent"></div>'),w=d.window;
 try {
  const timers=new Map();let serial=0,calls=0;
  w.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;};w.clearTimeout=id=>timers.delete(id);
  let request={requestId:'ride',type:'ehailing',status:'searching',fareStatus:'passenger_offer'};
  w.ASIYE={state:{booking:{request}},booking:{notifyGoDrivers:async()=>{calls++;if(calls===7)throw Error('Temporary network outage');}}};
  load(w,'assets/passenger-v2/js/ride-controller.js');const ride=w.ASIYE.ride;ride.requestId='ride';
  ride.scheduleGoDriverSearchRetry(request);
  for(let i=0;i<9;i++){
   assert.equal(timers.size,1);const [id,timer]=[...timers][0];timers.delete(id);
   assert.equal(timer.delay,i<6?8000:20000);await timer.fn();
  }
  assert.equal(calls,9);assert.equal(timers.size,1,'Search must stay open for a late driver');
  request.driverFoundCount=1;
  const [id,timer]=[...timers][0];timers.delete(id);await timer.fn();
  assert.equal([...timers.values()][0].delay,20000);
  for(const patch of [{fareStatus:'driver_counter'},{status:'cancelled_by_commuter'},{taxiId:'driver',status:'accepted'}]){
   Object.assign(request,patch);ride.scheduleGoDriverSearchRetry(request);assert.equal(timers.size,0);
   request={requestId:'ride',type:'ehailing',status:'searching',fareStatus:'passenger_offer'};w.ASIYE.state.booking.request=request;
  }
  ride.scheduleGoDriverSearchRetry(request);ride.stop();assert.equal(timers.size,0);
 } finally {d.window.close();}
});

test('search UI changes only with real dispatch data and has one route, offer and cancellation control',()=>{
 const d=dom('<div id="sheetContent"></div>'),w=d.window;
 try {
  const request={requestId:'ride',type:'ehailing',status:'searching',negotiationEnabled:true,fareStatus:'passenger_offer',passengerOffer:86,pickupAddress:'Pickup',destination:'Destination'};
  w.ASIYE={state:{booking:{fare:86,paymentMethod:'cash'}},ui:{escape:s=>String(s)},booking:{}};
  load(w,'assets/passenger-v2/js/ride-controller.js');w.ASIYE.ride.scheduleGoDriverSearchRetry=()=>{};
  const render=()=>{w.ASIYE.ride.renderGoSearching(request);w.ASIYE.ride.renderTripSummary(request,'searching');};render();
  assert.match(w.document.querySelector('h2').textContent,/Searching/);assert.equal(w.document.querySelector('.go-driver-search--found'),null);
  Object.assign(request,{driverFoundCount:1,driverSearchStatus:'driver_found_waiting_acceptance'});render();
  assert.equal(w.document.querySelector('h2').textContent,'Driver found');assert.match(w.document.querySelector('[role=status]').textContent,/Waiting for a driver to accept/);
  assert.equal(w.document.querySelectorAll('[data-trip-cancel]').length,1);assert.equal(w.document.querySelectorAll('.ride-match-route').length,1);
  assert.match(w.document.querySelector('.ride-match-fare').textContent,/Your offer/);assert.doesNotMatch(w.document.body.textContent,/Agreed fare/);
 } finally {d.window.close();}
});

test('driver map initializes without GPS and exposes load failures instead of a blank surface',()=>{
 const d=dom('<main id="driverApp"><div id="map"></div></main>'),w=d.window;
 try {
  w.ASIYE_DRIVER={state:{location:{}}};w.ASIYE_DRIVER_CONFIG={mapboxToken:'pk.synthetic-public-token-for-test'};
  load(w,'assets/driver-v2/js/map.js');const map=w.ASIYE_DRIVER.map;map.init();
  assert.match(w.document.getElementById('driverMapStatus').textContent,/could not load/);
  let settings;const listeners={};
  w.mapboxgl={Map:class{constructor(options){settings=options;}addControl(){}on(event,fn){listeners[event]=fn;}resize(){}},NavigationControl:class{}};
  map.init();assert.deepEqual(Array.from(settings.center),[31.0218,-29.8587]);
  assert.equal(map.initialized,false);listeners.load();assert.equal(map.initialized,true);
  assert.equal(w.document.getElementById('driverMapStatus').hidden,true);
 } finally {d.window.close();}
});

test('Add later still closes setup when browser storage is unavailable',async()=>{
 const d=dom(),w=d.window;
 try {
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.ASIYE_DRIVER={state:{driverId:'driver',driver:{}},ui:{toast(){}}};w.firebase={auth:()=>({currentUser:null})};
  w.AsiyeSafetyContact={getMembers:async()=>[]};load(w,'assets/member-pages.js');
  Object.defineProperty(w,'sessionStorage',{get(){throw Error('Storage unavailable');}});
  assert.equal(await w.AsiyeSafetyContact.ensure({role:'driver'}),true);
  const dialog=w.AsiyePages.dialog;assert.equal(dialog.isConnected,true);
  assert.doesNotThrow(()=>dialog.querySelector('[data-family-later]').onclick());
  assert.equal(dialog.isConnected,false);
 }finally{d.window.close();}
});
