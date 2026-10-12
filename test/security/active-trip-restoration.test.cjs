'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
function setup(trip, opts = {}) {
  const dom = new JSDOM('<main id="sheetContent">Home</main><main id="activeTripContent"></main><div id="activeTripSheet"></div>', {url:'https://asiye.test', runScripts:'outside-only'});
  const w = dom.window;
  const listeners = {};
  const values = {'commuters/passenger/currentRequest':'booking-reference-123', 'requests/booking-reference-123':trip,
    'taxis/driver':{authUid:'driver', currentRequest:'booking-reference-123'}};
  w.firebase = {auth:() => ({currentUser:{uid:'passenger'}}), database:() => ({ref:key => ({
    once: async () => {if (opts.failRead) throw new Error('Offline'); return {val:() => values[key] ?? null};},
    on: (name, listener) => {listeners[key] = listener; return listener;},
    off: () => {}, transaction: async fn => {values[key] = fn(values[key]); return {committed:true};}
  })})};
  w.eval(read('assets/passenger-v2/js/state.js'));
  w.ASIYE.state.userId = 'passenger';
  w.ASIYE.map = {resize(){}, fitActiveTrip(){}, removeDriverMarker(){}, clearTrip(){}};
  w.ASIYE.payments = {handleTripState: async () => {}};
  w.ASIYE.booking = {clearLocalRide:() => {w.ASIYE.state.booking.request = null; w.ASIYE.state.booking.requestId = null;}};
  w.ASIYE.ui = {escape: value => String(value || ''), renderClubWaiting:r => {w.document.getElementById('sheetContent').textContent = `Waiting ${r.passengerCount}/${r.requiredPassengers} until ${r.workWaitExpiresAt}`;}};
  w.ClubLive = {enhancePickup(){}};
  w.eval(read('assets/passenger-v2/js/ride-controller.js'));
  return {w, dom, listeners, values};
}
const go = {type:'ehailing', rideType:'go', commuterId:'passenger', taxiId:'driver', driverName:'My Driver', status:'accepted',
  paymentMethod:'cash', agreedFare:113, finalAmount:113, pickupAddress:'Saved pickup', commuterLocation:{latitude:-29.85,longitude:31.01},
  destination:'Saved destination', destinationCoords:{latitude:-29.82,longitude:31.04}, routeDistanceKm:8, routeDurationMinutes:18, pickupPin:'1234'};
test('passenger restore paints full saved trip before the delayed realtime listener fires', async () => {
  const {w, dom} = setup(go);
  try {
    assert.equal(await w.ASIYE.ride.restore(), true);
    const text = w.document.getElementById('sheetContent').textContent;
    assert.match(text, /My Driver/); assert.match(text, /Saved pickup/); assert.match(text, /Saved destination/); assert.match(text, /113.00/);
    assert.equal(w.ASIYE.state.destination.latitude, -29.82);
    assert.equal(w.ASIYE.state.booking.pickup.latitude, -29.85);
    assert.equal(w.ASIYE.state.booking.paymentMethod, 'cash');
    assert.equal(w.ASIYE.state.route.distanceKm, 8);
    assert.ok(w.document.querySelector('[data-trip-cancel]'));
  } finally {dom.window.close();}
});
test('Club restore preserves personal pickup, price, countdown and saved arrival state', async () => {
  const trip = {...go, type:'club', rideType:'club', clubSecurityVersion:2, status:'collecting_passengers', passengerCount:2, requiredPassengers:4,
    workWaitExpiresAt:1234567, passengers:{passenger:{name:'Me', pickupAddress:'My pickup', pickupLat:-29.88,pickupLng:31.02,
      destination:'My work', destinationLat:-29.81,destinationLng:31.03, price:42, paymentMethod:'wallet', status:'arrived', arrivedAt:99, pickupPin:'4321'}}};
  const {w, dom} = setup(trip);
  try {
    assert.equal(await w.ASIYE.ride.restore(), true);
    assert.match(w.document.getElementById('sheetContent').textContent, /driver is here/);
    assert.match(w.document.getElementById('sheetContent').textContent, /My work/);
    assert.equal(w.ASIYE.state.booking.fare, 42);
    assert.equal(w.ASIYE.state.booking.club.workWaitExpiresAt, 1234567);
    assert.equal(w.document.querySelector('[data-trip-cancel]'), null);
  } finally {dom.window.close();}
});
test('cancelled Club membership is never restored even while other passengers remain active', async () => {
  const {w, dom} = setup({...go, type:'club', status:'pooling', passengers:{passenger:{status:'cancelled_by_commuter'}}});
  try { assert.equal(await w.ASIYE.ride.restore(), false); assert.equal(w.ASIYE.state.booking.requestId, null); }
  finally {dom.window.close();}
});
test('read errors preserve the saved lock and never report a successful restore', async () => {
  const {w, dom} = setup(go, {failRead:true});
  try {w.localStorage.setItem('currentRequestId','booking-reference-123');
    await assert.rejects(w.ASIYE.ride.restore(), /Offline/);
    assert.equal(w.localStorage.getItem('currentRequestId'),'booking-reference-123');
  } finally {dom.window.close();}
});
test('a late callback from a replaced booking cannot repaint the new trip', async () => {
  const {w, dom, listeners, values} = setup(go);
  try {
    await w.ASIYE.ride.start('booking-reference-123', go);
    const oldListener = listeners['requests/booking-reference-123'];
    const newer = {...go, driverName:'Next Driver'};
    values['requests/new-booking-reference'] = newer;
    await w.ASIYE.ride.start('new-booking-reference', newer);
    oldListener({val:() => ({...go, driverName:'Stale Driver'})});
    assert.equal(w.ASIYE.state.booking.requestId,'new-booking-reference');
    assert.match(w.document.getElementById('sheetContent').textContent,/Next Driver/);
  } finally {dom.window.close();}
});
test('driver restoration reopens arrived Club passenger PIN rather than changing pickup state', async () => {
  const {w, dom, listeners} = setup(go);
  try {
    w.ASIYE_DRIVER = {state:{}, ui:{showPassengerPin: r => {w.document.getElementById('activeTripContent').textContent = `PIN for ${r.passengerName}`;}}, navigator:{stop(){}}};
    w.eval(read('assets/driver-v2/js/trip-controller.js'));
    const trip = {...go, type:'club', clubSecurityVersion:2, status:'collecting_passengers', passengers:{passenger:{name:'Saved Passenger',status:'arrived',arrivedAt:22}}};
    assert.equal(await w.ASIYE_DRIVER.trip.start('booking-reference-123',trip), true);
    assert.match(w.document.getElementById('activeTripContent').textContent,/PIN for Saved Passenger/);
    assert.equal(w.ASIYE_DRIVER.trip.currentPassengerId,'passenger');
    assert.equal(trip.passengers.passenger.status,'arrived');
    assert.equal(w.document.querySelector('[data-trip-cancel]'),null);
  } finally {dom.window.close();}
});
