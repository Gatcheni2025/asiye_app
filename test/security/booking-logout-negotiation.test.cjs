'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const load=(w,file)=>w.eval(fs.readFileSync(path.join(root,file),'utf8'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('passenger recovery never treats cancelled, ended or foreign bookings as active',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});
 try {
  const w=dom.window;w.ASIYE={state:{userId:'passenger'}};
  load(w,'assets/passenger-v2/js/ride-controller.js');
  const active=status=>w.ASIYE.ride.isActiveBooking({commuterId:'passenger',status});
  for(const status of ['cancelled','cancelled_by_commuter','cancelled_by_admin','cancelled_by_driver','canceled','expired','completed','rejected',' CANCELLED ']) assert.equal(active(status),false,status);
  assert.equal(active('searching'),true);
  assert.equal(w.ASIYE.ride.isActiveBooking({commuterId:'other',status:'searching'}),false);
  assert.equal(w.ASIYE.ride.isActiveBooking({type:'club',status:'pooling',passengers:{passenger:{status:'cancelled'}}}),false);
 } finally {dom.window.close();}
});

test('restoring a cancelled server reference clears only that booking and returns home',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://example.test'});
 try {
  const w=dom.window;let pointer='ended',started=0;
  w.ASIYE={state:{userId:'passenger',booking:{requestId:'ended'}}};
  w.localStorage.setItem('currentRequestId','ended');
  w.firebase={database:()=>({ref:p=>({
   once:async()=>({val:()=>p.startsWith('commuters/')?pointer:{commuterId:'passenger',status:'cancelled'}}),
   transaction:async fn=>{assert.equal(fn(null),null,'Cold cache must not abort cleanup');pointer=fn(pointer);}
  })})};
  load(w,'assets/passenger-v2/js/ride-controller.js');
  w.ASIYE.ride.start=async()=>{started++;};
  assert.equal(await w.ASIYE.ride.restore(),false);
  assert.equal(pointer,null);assert.equal(started,0);
  assert.equal(w.localStorage.getItem('currentRequestId'),null);
 } finally {dom.window.close();}
});

function presenceWindow(fail=false){
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://example.test/driver-v2/',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[];
 w.ASIYE_DRIVER={state:{driverId:'stale-local-id',driver:{isOnline:true},availability:{isOnline:true}},
  requests:{stop:()=>calls.push('requests stopped')},location:{stop:()=>calls.push('GPS stopped')}};
 w.AsiyeEnrollment={resolveDriverProfile:async()=>({id:'owned-driver'})};
 w.AsiyeNativeBridge={notify:message=>calls.push(message)};
 const disconnect={update:async patch=>calls.push(['disconnect',patch]),cancel:async()=>{}};
 const auth={currentUser:{uid:'verified-auth'},signOut:async()=>calls.push('signed out')};
 const database=()=>({ref:p=>({onDisconnect:()=>disconnect,update:async patch=>{
  calls.push(['write',p,patch]);if(fail)throw Error('offline write failed');
 }})});
 database.ServerValue={TIMESTAMP:123};
 w.firebase={auth:()=>auth,database};
 load(w,'assets/driver-v2/js/presence.js');load(w,'assets/session.js');
 return {dom,w,calls};
}

test('driver logout persists offline flags for the authenticated profile before signing out',async()=>{
 const {dom,w,calls}=presenceWindow();
 try {
  await w.AsiyeSession.logout();
  const write=calls.find(c=>Array.isArray(c)&&c[0]==='write');
  assert.equal(write[1],'taxis/owned-driver');
  assert.equal(write[2].isOnline,false);assert.equal(write[2].isBroadcasting,false);
  assert.equal(write[2].currentRequest,undefined,'Logout must preserve an active trip');
  assert.ok(calls.indexOf(write)<calls.indexOf('signed out'));
  assert.ok(calls.includes('requests stopped'));assert.ok(calls.includes('GPS stopped'));
  assert.ok(calls.includes('stopLocationWatch'));
  assert.equal(w.ASIYE_DRIVER.state.availability.isOnline,false);
 } finally {dom.window.close();}
});

test('failed offline persistence does not sign the driver out or claim success',async()=>{
 const {dom,w,calls}=presenceWindow(true);
 try {
  await assert.rejects(w.AsiyeSession.logout(),/offline write failed/);
  assert.equal(calls.includes('signed out'),false);
  assert.equal(w.ASIYE_DRIVER.state.loggingOut,false);
 } finally {dom.window.close();}
});

test('going online first registers an offline update for unexpected disconnects',async()=>{
 const {dom,w,calls}=presenceWindow();
 try {
  await w.AsiyeDriverPresence.prepare('owned-driver');
  assert.equal(calls[0][0],'disconnect');
  assert.equal(calls[0][1].isOnline,false);assert.equal(calls[0][1].isBroadcasting,false);
 } finally {dom.window.close();}
});

test('passenger cancellation releases older server pointers before the second and third bookings',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://example.test'});
 try {
  const w=dom.window,records={},homes=[];let pointer;
  w.ASIYE={state:{userId:'passenger',booking:{},ui:{}},ui:{renderHome:()=>homes.push(true)},map:{clearTrip(){}},
   goNegotiation:{post:async(endpoint,{requestId})=>{assert.equal(endpoint,'goTripActionSecure');records[requestId].status='cancelled_by_commuter';}}};
  w.firebase={auth:()=>({currentUser:{uid:'passenger'}}),database:()=>({ref:p=>({
   once:async()=>({val:()=>p.startsWith('commuters/')?pointer:records[p.slice(9)]}),
   transaction:async fn=>{assert.equal(fn(null),null);const next=fn(pointer);if(next!==undefined)pointer=next;}
  })})};
  load(w,'assets/passenger-v2/js/ride-controller.js');load(w,'assets/passenger-v2/js/booking.js');
  w.ASIYE.ride.stop=()=>{};
  for(const id of ['first','second','third']){
   await w.ASIYE.booking.pruneEndedBooking('passenger');assert.equal(pointer,undefined);
   records[id]={commuterId:'passenger',status:'searching',type:'ehailing'};
   pointer=id;w.ASIYE.state.booking.requestId=id;w.localStorage.setItem('currentRequestId',id);
   await w.ASIYE.booking.cancelCurrentRide();assert.equal(pointer,null);
   assert.equal(w.localStorage.getItem('currentRequestId'),null);pointer=undefined;
  }
  assert.equal(homes.length,3);
  pointer='newer';await w.ASIYE.booking.releaseCancelledBookingPointer('first');assert.equal(pointer,'newer');
  records.legacy={commuterId:'passenger',status:'cancelled'};pointer='legacy';
  await w.ASIYE.booking.pruneEndedBooking('passenger');assert.equal(pointer,null);
 } finally {dom.window.close();}
});

function driverWindow(){
 const dom=new JSDOM('<div id="incomingRequestOverlay"><div id="incomingRequestType"></div><div id="incomingRequestContent"></div><button id="acceptRequestButton"></button><span id="incomingRequestTimer"></span></div>',{runScripts:'outside-only'});
 const w=dom.window,listeners=new Map(),started=[],counters=[];
 w.document.addEventListener=()=>{};
 w.ASIYE_DRIVER={state:{driverId:'driver',ui:{},driver:{},availability:{}}};
 w.firebase={database:()=>({ref:p=>({on:(event,fn)=>{listeners.set(p,fn);return fn;},off:()=>listeners.delete(p),remove:async()=>{}})})};
 load(w,'assets/driver-v2/js/requests.js');load(w,'assets/driver-v2/js/go-negotiation.js');load(w,'assets/driver-v2/js/app.js');
 w.ASIYE_DRIVER.trip={start:id=>started.push(id)};
 w.ASIYE_DRIVER.requests.counterFare=async(amount,id)=>{counters.push([amount,id]);return {counterFare:amount};};
 const offer={requestId:'ride',key:'ride',type:'ehailing',rideType:'go',status:'searching',negotiationEnabled:true,
  fareStatus:'passenger_offer',commuterName:'Passenger',pickupAddress:'Pickup',destination:'Destination',
  passengerOffer:65,finalAmount:90,marketReferenceFare:100,suggestedFare:90,minimumFareOffer:65,maximumFareOffer:95,
  routeDistanceKm:10,routeDurationMinutes:20,paymentMethod:'cash'};
 return {dom,w,offer,listeners,started,counters,emit:request=>listeners.get('requests/ride')?.({val:()=>request})};
}

test('driver sees the live passenger amount, recommendation and counter earnings',async()=>{
 const {dom,w,offer,listeners,emit,counters}=driverWindow();
 try {
  const app=w.ASIYE_DRIVER;app.ui.showIncomingRequest(offer);app.requests.watchIncomingRequest('ride',offer);
  assert.match(w.document.querySelector('.driver-request-price strong').textContent,/65\.00/);
  assert.match(w.document.querySelector('.driver-go-recommendation').textContent,/R90/);
  assert.match(w.document.querySelector('.driver-go-recommendation').textContent,/R72\.00/);
  emit({...offer,passengerOffer:75,negotiationRound:2});
  assert.match(w.document.getElementById('acceptRequestButton').textContent,/Accept R75/);
  assert.match(w.document.querySelector('.driver-request-price strong').textContent,/75\.00/);
  const input=w.document.getElementById('driverCounterFareInput');input.value='80';input.dispatchEvent(new w.Event('input'));
  assert.equal(w.document.getElementById('driverCounterNet').textContent,'R64.00');
  w.document.getElementById('counterFareButton').click();await flush();
  assert.deepEqual(counters,[[80,'ride']]);
  assert.equal(w.document.getElementById('incomingRequestOverlay').classList.contains('open'),true);
  assert.match(w.document.querySelector('[role="status"]').textContent,/waiting for the passenger/);
  assert.equal(w.document.getElementById('acceptRequestButton').disabled,true);
  emit({...offer,passengerOffer:85,negotiationRound:3});
  assert.match(w.document.getElementById('acceptRequestButton').textContent,/Accept R85/);
  assert.equal(w.document.getElementById('acceptRequestButton').disabled,false);
  app.requests.stop();assert.equal(listeners.size,0);
 } finally {dom.window.close();}
});

test('a waiting Go counter does not disable acceptance of the next Work or Parcel request',()=>{
 for(const type of ['club','delivery']){
  const {dom,w,offer}=driverWindow();
  try {
   const app=w.ASIYE_DRIVER;
   app.ui.showIncomingRequest({...offer,fareStatus:'driver_counter',driverCounterFare:80});
   assert.equal(w.document.getElementById('acceptRequestButton').disabled,true);
   app.ui.showIncomingRequest({...offer,type,rideType:type==='club'?'club4':'delivery',negotiationEnabled:false,
    status:type==='club'?'pool_ready':'pending',fareStatus:undefined,minimumPassengers:3,passengerCount:3,pricePerPassenger:40});
   assert.equal(w.document.getElementById('acceptRequestButton').disabled,false,type);
   assert.equal(w.document.getElementById('acceptRequestButton').textContent,'Accept');
  } finally {dom.window.close();}
 }
});

test('driver live watch closes cancelled rides and moves agreed fares into the assigned trip',()=>{
 for(const cancelled of [true,false]){
  const {dom,w,offer,emit,started}=driverWindow();
  try {
   const app=w.ASIYE_DRIVER;app.ui.showIncomingRequest(offer);app.requests.watchIncomingRequest('ride',offer);
   emit({...offer,status:cancelled?'cancelled_by_commuter':'payment_required',fareStatus:cancelled?'passenger_offer':'agreed',taxiId:cancelled?null:'driver',agreedFare:80});
   assert.equal(w.document.getElementById('incomingRequestOverlay').classList.contains('open'),false);
   assert.deepEqual(started,cancelled?[]:['ride']);
  } finally {dom.window.close();}
 }
});
