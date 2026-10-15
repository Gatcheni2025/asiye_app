'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');

async function simulateParcel(paymentMethod) {
  const events = [];
  const request = {key:'parcel001', async set(data){events.push(['request',data]);}};
  const refs = p => p === 'requests'
    ? {push:()=>request}
    : {async set(data){events.push([p,data]);},async update(data){events.push([p,data]);}};
  const database = () => ({ref:refs});
  database.ServerValue = {TIMESTAMP:12345};
  const ASIYE = {
    state:{
      userId:'passenger01', user:{name:'Rider',phone:'0710000000'},
      location:{latitude:-29.8,longitude:30.9,address:'Pickup'},
      destination:{latitude:-29.7,longitude:30.8,address:'Drop off',name:'Drop off'},
      route:{distanceKm:4,durationMinutes:8},
      booking:{paymentMethod}
    },
    pricing:{calculate:()=>({go:100})},
    profile:{ensureRequired:async()=> 'photo'},
    booking:{
      requirePassengerPin:async()=> '1234',
      requireTripShare:async()=>{throw Error('Unexpected forced sharing');},
      notifyGoDrivers:async(id,data)=>{
        events.push(['dispatch',id]);
        assert.equal(data.taxiId,null);
        assert.equal(data.status,'pending');
      }
    },
    payments:{prepare:async()=>{throw Error('Paystack before driver acceptance');}},
    ride:{start:async id=>events.push(['ride',id])}
  };
  const context={window:{ASIYE},ASIYE,firebase:{database},localStorage:{setItem(){}}};
  vm.runInNewContext(read('assets/passenger-v2/js/parcels.js'),context);
  let result, error;
  try {
    result=await ASIYE.parcels.create({
      recipientName:'Recipient',recipientPhone:'0790000000',parcelDescription:'Small parcel'
    });
  } catch(e){error=e;}
  return {events,result,error};
}
test('card parcel dispatches before Paystack and waits for verified assigned driver',async()=>{
  const {events,result,error}=await simulateParcel('card');
  assert.equal(error,undefined);
  assert.equal(result,'parcel001');
  const saved=events.find(e=>e[0]==='request')[1];
  assert.equal(saved.paymentMethod,'card');
  assert.equal(saved.paymentStatus,'awaiting_driver');
  assert.equal(saved.safetyShareCompleted,false);
  assert.deepEqual(events.slice(-2).map(e=>e[0]),['dispatch','ride']);
});
test('cash parcel remains dispatchable without Paystack checkout',async()=>{
  const {events,error}=await simulateParcel('cash');
  assert.equal(error,undefined);
  assert.equal(events.find(e=>e[0]==='request')[1].paymentStatus,'cash_due');
  assert.deepEqual(events.slice(-2).map(e=>e[0]),['dispatch','ride']);
});
test('retired wallet method fails before saving any parcel request',async()=>{
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
  const from=handler.indexOf('Parcel card payments follow driver acceptance');
  assert.ok(from>0);
  const returnBlock=handler.slice(from,from+850);
  assert.match(returnBlock,/!request\.taxiId/);
  assert.doesNotMatch(returnBlock,/notifyGoDrivers/);
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
