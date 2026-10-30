'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {returnModel, renderPaymentReturn} = require('../functions/paystack-return');
const PROJECT = 'asiye-paystack-staging';

function returnPage(project, userAgent, hidden = false) {
  const elements = Object.fromEntries(['reference','nativeReturn','returnMessage'].map(id => [id, {hidden:true}]));
  const navigations = [], timers = [];
  const location = {replace:url => navigations.push(url)};
  const document = {hidden, getElementById:id => elements[id]};
  const html = renderPaymentReturn(project, 'ASIYE-paid-reference');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document, navigator:{userAgent}, window:{location}, setTimeout:fn => timers.push(fn)
  });
  return {elements, navigations, timers, location, html};
}
test('desktop and staging mobile return to the same Firebase project without opening the production app', () => {
  for (const agent of ['Chrome Windows', 'Android Chrome', 'iPhone Safari']) {
    const page = returnPage(PROJECT, agent);
    assert.equal(page.navigations.length, 1);
    const url = new URL(page.navigations[0]);
    assert.equal(url.origin, 'https://' + PROJECT + '.web.app');
    assert.equal(url.pathname, '/passenger-v2/index.html');
    assert.equal(url.searchParams.get('reference'), 'ASIYE-paid-reference');
    assert.equal(url.searchParams.get('payment_return'), '1');
    assert.equal(page.location.href, undefined);
    assert.equal(page.elements.nativeReturn.hidden, true);
    assert.doesNotMatch(page.html, /wallet|payment successful|payment confirmed/i);
  }
});
test('production mobile keeps the native return and falls back to web only while visible', () => {
  const android = returnPage('asiye-80386', 'Android Chrome');
  assert.match(android.location.href, /^intent:\/\/payment-complete/);
  assert.equal(android.elements.nativeReturn.hidden, false);
  android.timers[0]();
  assert.equal(new URL(android.navigations[0]).origin, 'https://asiye-80386.web.app');
  const ios = returnPage('asiye-80386', 'iPhone Safari', true);
  assert.match(ios.location.href, /^asiye:\/\/payment-complete/);
  ios.timers[0]();
  assert.equal(ios.navigations.length, 0, 'Do not navigate a hidden callback after the app opens');
});
test('callback reference and project validation cannot inject HTML or select an external return host', () => {
  for (const reference of ['<script>alert(1)</script>', 'x" onclick="alert(1)', ['ASIYE-paid'], 'x'.repeat(101)]) {
    assert.equal(returnModel(PROJECT, reference).reference, '');
  }
  assert.throws(() => returnModel('evil.example/path', 'ASIYE-paid'));
  const page = returnPage(PROJECT, 'Desktop');
  assert.doesNotMatch(page.html, /transaction\/initialize|verifyTripCardPayment|firebase\.database/);
});

function paymentClient({search='?payment_return=1&reference=ASIYE-paid', signedIn=true, ready=true} = {}) {
  const values = new Map([['pendingTripCardPayment', JSON.stringify({requestId:'ride',reference:'ASIYE-paid'})]]);
  const calls = [], finalized = [], cleaned = [], notices = [];
  const context = {
    console, URL, URLSearchParams,
    setTimeout:resolve => resolve(),
    localStorage:{getItem:key => values.get(key) || null, setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key)},
    document:{querySelector:() => null},
    location:{search,href:'https://' + PROJECT + '.web.app/passenger-v2/index.html' + search},
    history:{replaceState:(_state,_title,url) => cleaned.push(url)},
    firebase:{auth:() => ({currentUser:signedIn ? {getIdToken:async() => 'synthetic-test-token'} : null}),
      database:() => ({ref:name => {assert.equal(name,'requests/ride'); return {once:async() => ({val:() => ({
        requestId:'ride', type:'ehailing', rideType:'go', paymentMethod:'card', taxiId:'driver', status:'accepted'
      })})};}})},
    ASIYE:{state:{userId:'passenger'}, ui:{toast:message => notices.push(message)},
      booking:{finalizePaidCardBooking:async id => finalized.push(id)}},
    fetch:async(url,options) => {
      calls.push({url,body:JSON.parse(options.body)});
      assert.match(url,/\/verifyTripCardPayment$/);
      return {ok:ready,json:async() => ready ? {ready:true,status:'held'} : {error:'Payment is not confirmed.'}};
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/passenger-v2/js/wallet.js','utf8'), context);
  return {api:context.ASIYE.payments, values, calls, finalized, cleaned, notices};
}
test('page return and concurrent resume events verify one existing reference and restore the paid ride', async () => {
  const h = paymentClient();
  assert.deepEqual(await Promise.all([h.api.resumeCardReturn(),h.api.resumeCardReturn()]), [true,true]);
  assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0].body,{requestId:'ride',reference:'ASIYE-paid'});
  assert.deepEqual(h.finalized,['ride']);
  assert.equal(h.values.has('pendingTripCardPayment'),false);
  assert.deepEqual(h.cleaned,['/passenger-v2/index.html']);
  assert.equal(await h.api.resumeCardReturn(),false);
  assert.equal(h.calls.length,1,'A later focus cannot verify or charge again');
});
test('wrong references and a signed-out browser cannot resume or clear another payment', async () => {
  for (const options of [{search:'?payment_return=1&reference=ASIYE-other'}, {signedIn:false}]) {
    const h = paymentClient(options);
    assert.equal(await h.api.resumeCardReturn(),false);
    assert.equal(h.calls.length,0);
    assert.equal(h.finalized.length,0);
    assert.ok(h.values.has('pendingTripCardPayment'));
    assert.deepEqual(h.cleaned,[]);
  }
});
test('failed provider verification keeps recovery available and never initializes another checkout', async () => {
  const h = paymentClient({ready:false,search:'?payment_return=1&reference=ASIYE-paid&status=success'});
  assert.equal(await h.api.resumeCardReturn(),false);
  assert.equal(h.finalized.length,0);
  assert.ok(h.values.has('pendingTripCardPayment'));
  assert.match(h.notices[0],/not confirmed/);
  assert.equal(h.cleaned.length,0);
  assert.ok(h.calls.every(c => c.url.endsWith('/verifyTripCardPayment')));
});
