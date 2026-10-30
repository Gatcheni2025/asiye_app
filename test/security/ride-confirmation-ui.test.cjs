const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const fixture = require('./ride-confirmation-fixture.cjs');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/passenger-v2/js/ride-controller.js'), 'utf8');

function setup(patch = {}) {
  const dom = new JSDOM('<div id="sheetContent"></div>', {
    url:'https://asiye-80386.web.app/', runScripts:'outside-only'
  });
  const w = dom.window;
  w.eval('(' + fixture.bootstrap.toString() + ')()');
  w.eval(source);
  const request = {...fixture.request, ...patch};
  w.ASIYE.ride.renderDriverAssigned(request);
  w.ASIYE.ride.renderTripSummary(request, 'accepted');
  return {dom,w,request,body:w.document.getElementById('sheetContent')};
}

test('confirmation has one identity card, compact vehicle, route, agreed fare and working contact/cancel actions', async () => {
  const {dom,w,body} = setup();
  try {
    assert.equal(body.querySelectorAll('.ride-match-driver-card').length, 1);
    assert.equal(body.querySelector('.ride-match-avatar img').getAttribute('src'), fixture.request.driverProfileImageUrl);
    assert.equal(body.querySelectorAll('.ride-match-car-photo img').length, 0);
    assert.equal(body.querySelectorAll('.ride-match-car-photo svg.asiye-vehicle-art').length, 1);
    assert.equal(body.querySelector('.ride-match-car-photo svg').getAttribute('data-vehicle-art'), 'toyota-corolla');
    assert.match(body.querySelector('.ride-match-plate').textContent, /ND/);
    assert.match(body.querySelector('.ride-match-driver-info').textContent, /Alex Dlamini/);
    assert.match(body.querySelector('.ride-match-route').textContent, /Pickup Road/);
    assert.match(body.querySelector('.ride-match-fare').textContent, /R113.00/);
    assert.match(body.querySelector('.ride-match-fare').textContent, /pay after your trip/);
    assert.equal(body.querySelector('a[href^="tel:"]').getAttribute('href'), 'tel:+27310000000');
    body.querySelector('[data-match-message]').click();
    body.querySelector('[data-trip-cancel]').click();
    await Promise.resolve();
    assert.deepEqual(JSON.parse(JSON.stringify(w.__actions)), [['message',fixture.request.requestId],['cancel']]);
  } finally {dom.window.close();}
});

test('confirmation escapes supplied text, rejects unsafe images and does not invent a five-star rating', () => {
  const {dom,body} = setup({driverName:'<img src=x onerror="alert(1)">', driverRating:null,
    driverProfileImageUrl:'javascript:alert(1)',driverVehiclePhoto:'data:text/html,<script>alert(1)</script>',
    vehicleReg:'<script>bad()</script>',pickupAddress:'<svg onload="bad()">'});
  try {
    assert.equal(body.querySelectorAll('script,[onerror],[onload]').length,0);
    assert.equal(body.querySelectorAll('.ride-match-avatar img,.ride-match-car-photo img').length,0);
    assert.match(body.querySelector('.ride-match-driver-info').textContent,/Your assigned driver/);
    assert.doesNotMatch(body.querySelector('.ride-match-driver-info').textContent,/5\.0/);
    assert.match(body.querySelector('.ride-match-route').textContent,/<svg/);
  } finally {dom.window.close();}
});

test('failed photos leave the avatar and vehicle fallback visible; missing chat gives clear feedback', async () => {
  const {dom,w,body} = setup({driverPhone:''});
  try {
    body.querySelectorAll('.ride-match img').forEach(img => img.dispatchEvent(new w.Event('error')));
    assert.equal(body.querySelectorAll('.ride-match img').length,0);
    assert.match(body.querySelector('.ride-match-avatar').textContent,/A/);
    assert.ok(body.querySelector('.ride-match-car-photo svg'));
    assert.ok(body.querySelector('.ride-match-actions button[disabled]'));
    delete w.AsiyeTripChat;
    body.querySelector('[data-match-message]').click();
    await Promise.resolve();
    assert.match(body.querySelector('[role="status"]').textContent,/Messaging is unavailable/);
    w.ASIYE.ride.renderTripSummary({...fixture.request,arrivedAt:1},'arrived');
    assert.equal(body.querySelector('[data-trip-cancel]'),null);
  } finally {dom.window.close();}
});

for (const amount of [80,64,96]) {
  test(`driver can send an in-range counter but rejects out-of-range amount ${amount}`,async()=>{
    const dom = new JSDOM('<main id="incoming"><button id="acceptRequestButton"></button></main>',{runScripts:'outside-only'});
    try {
      const w=dom.window, calls=[];
      w.ASIYE_DRIVER={requests:{counterFare:async(value,id)=>calls.push([value,id])},ui:{toast(){},closeIncomingRequest(){}}};
      w.eval(fs.readFileSync(path.join(root,'assets/driver-v2/js/go-negotiation.js'),'utf8'));
      w.ASIYE_DRIVER.goNegotiation.decorateIncomingRequest({
        requestId:'offer65',type:'ehailing',rideType:'go',negotiationEnabled:true,
        fareStatus:'passenger_offer',passengerOffer:65,maximumFareOffer:95
      },w.document.getElementById('incoming'));
      const input=w.document.getElementById('driverCounterFareInput');
      assert.equal(input.min,'65');assert.equal(input.max,'95');
      input.value=String(amount);
      w.document.getElementById('counterFareButton').click();
      await Promise.resolve();
      assert.deepEqual(calls,amount===80?[[80,'offer65']]:[]);
    } finally {dom.window.close();}
  });
}
