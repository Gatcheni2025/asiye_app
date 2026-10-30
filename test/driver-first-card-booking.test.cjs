'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');

async function simulateParcel(paymentMethod) {
  const events=[];
  const ASIYE={
    state:{
      userId:'passenger01',user:{name:'Rider',phone:'0710000000'},
      location:{latitude:-29.8,longitude:30.9,address:'Pickup'},
      destination:{latitude:-29.7,longitude:30.8,address:'Drop off',name:'Drop off'},
      route:{distanceKm:17,durationMinutes:25},booking:{paymentMethod}
    },
    profile:{ensureRequired:async()=> 'photo'},
    booking:{
      requirePassengerPin:()=>{throw Error('Never generate PIN in the passenger WebView');},
      notifyGoDrivers:async(id,data)=>{
        events.push(['dispatch',id]);
        assert.equal(data.taxiId,null);
        assert.equal(data.parcelSecurityVersion,2);
        assert.equal(data.status,'pending');
      }
    },
    payments:{prepare:async()=>{throw Error('Paystack before driver acceptance');}},
    ride:{_parcelPins:{},start:async id=>events.push(['ride',id])}
  };
  const fetch=async(_url,options)=>{
    events.push(['serverCreate',JSON.parse(options.body)]);
    const data=JSON.parse(options.body);
    const request={
      requestId:'-parcelServerAssigned123',type:'delivery',
      parcelSecurityVersion:2,status:'pending',taxiId:null,
      finalAmount:100,paymentMethod:data.paymentMethod,
      paymentStatus:data.paymentMethod==='card'?'awaiting_driver':'cash_due'
    };
    return {ok:true,json:async()=>({requestId:request.requestId,request,pickupPin:'5678'})};
  };
  const context={
    window:{ASIYE},ASIYE,fetch,localStorage:{setItem(){}},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'firebase-token'}})}
  };
  vm.runInNewContext(read('assets/passenger-v2/js/parcels.js'),context);
  let result,error;
  try{result=await ASIYE.parcels.create({
    recipientName:'Recipient',recipientPhone:'0790000000',parcelDescription:'Small parcel'
  });}catch(e){error=e;}
  return {events,result,error,ASIYE};
}
test('card parcel server-created before dispatch; PIN not stored in public request',async()=>{
  const {events,result,error,ASIYE}=await simulateParcel('card');
  assert.equal(error,undefined);
  assert.equal(result,'-parcelServerAssigned123');
  assert.equal(events[0][0],'serverCreate');
  assert.equal(events[0][1].paymentMethod,'card');
  assert.equal(events[0][1].pickupPin,undefined);
  assert.equal(ASIYE.state.booking.request.paymentStatus,'awaiting_driver');
  assert.equal(ASIYE.ride._parcelPins[result],'5678');
  assert.deepEqual(events.slice(-2).map(e=>e[0]),['dispatch','ride']);
});
test('cash parcel remains dispatchable without card checkout',async()=>{
  const {events,error,ASIYE}=await simulateParcel('cash');
  assert.equal(error,undefined);
  assert.equal(ASIYE.state.booking.request.paymentStatus,'cash_due');
  assert.deepEqual(events.slice(-2).map(e=>e[0]),['dispatch','ride']);
});
test('retired Wallet rejected before any Parcel server request',async()=>{
  const {events,error}=await simulateParcel('wallet');
  assert.match(String(error?.message),/Wallet is discontinued/);
  assert.equal(events.length,0);
});
test('passenger card processor is loaded but wallet UI is not shown',()=>{
  const html=read('assets/passenger-v2/index.html');
  assert.match(html,/<script src="\.\/js\/wallet\.js"><\/script>/);
  assert.doesNotMatch(html,/data-page="wallet"/);
  const script=read('assets/passenger-v2/js/wallet.js');
  assert.match(script,/ASIYE\.payments\s*=/);
  assert.match(script,/!request\.taxiId/);
  assert.match(script,/request\.driverAcceptedAt/);
  const ride=read('assets/passenger-v2/js/ride-controller.js');
  assert.match(ride,/method === 'card' && request\.taxiId/);
});
test('driver-first parcel acceptance and verified payment preserve driver',()=>{
  const driver=read('assets/driver-v2/js/requests.js');
  assert.match(driver,/needsDriverCardCheckout/);
  assert.match(driver,/needsDriverCardCheckout \? 'payment_required' : 'accepted'/);
  const backend=read('functions/index.js');
  assert.match(backend,/trip\.type === "delivery"[\s\S]*?trip\.status === "payment_required" \? \{status:"accepted"\}/);
  assert.match(backend,/String\(trip\.taxiId\) !== String\(payment\.splitDriverId\)/);
  assert.match(backend,/verifyDriverPaystackSplit\(payment, transaction\)/);
  const handler=read('assets/passenger-v2/js/wallet.js');
  const from=handler.indexOf('Parcel card charges follow driver acceptance');
  assert.ok(from>0);
  const returnBlock=handler.slice(from,from+850);
  assert.match(returnBlock,/!request\.taxiId/);
  assert.doesNotMatch(returnBlock,/notifyGoDrivers/);
});
test('driver cannot begin parcel card pickup until payment clears and checkout never loops',()=>{
  const controller=read('assets/driver-v2/js/trip-controller.js');
  assert.match(controller,/request\.type === 'delivery'[\s\S]*?request\.paymentMethod === 'card'/);
  assert.match(controller,/Confirm Paystack payment before collecting this parcel/);
  const ride=read('assets/passenger-v2/js/ride-controller.js');
  assert.match(ride,/pendingCard\?\.\(\)\?\.requestId !== request\.requestId/);
  const pay=read('assets/passenger-v2/js/wallet.js');
  assert.match(pay,/Card payment confirmed\. Your assigned driver can proceed to collection/);
});
test('Work card payment waits for full pool AND accepting driver',()=>{
  const backend=read('functions/index.js');
  assert.match(backend,/trip\.poolReady !== true \|\| !trip\.taxiId \|\| !trip\.driverAcceptedAt/);
  const club=read('functions/club-lifecycle.js');
  assert.match(club,/\["acceptFare", "acceptWaiting"\]\.includes\(body\.action\)/);
  const {driverAction}=require('../functions/club-lifecycle');
  const pool={
    type:'club',clubSecurityVersion:2,status:'pool_ready',
    driverAuthUid:'driver_auth',poolReady:true,driverAcceptedAt:null,passengers:{}
  };
  const accepted=driverAction(pool,'driver_auth',{action:'acceptWaiting'},{},5000);
  assert.equal(accepted.driverAcceptedAt,5000);
});
