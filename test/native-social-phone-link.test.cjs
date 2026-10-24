'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({installed = true, role = 'driver'} = {}) {
  const elements = new Map(), values = new Map(), posted = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '', textContent: '', disabled: false,
      innerHTML: '', dataset: {}, style: {}, classList: {add(){}, remove(){}},
      addEventListener(){}, removeAttribute(){}, focus(){}});
    return elements.get(id);
  };
  const user = {uid: 'original-social', phoneNumber: null};
  const calls = {tokens: 0, completed: 0, switched: 0, webOtp: 0, errors: []};
  const auth = {currentUser: user, setPersistence: async()=>{}, signOut: async()=>{},
    signInWithCustomToken: async()=>{calls.tokens++; user.phoneNumber = '+27821234567'; return {user};}};
  const login = {awaitingPhoneLink: role === 'driver', pendingUser: user,
    normalizePhone: raw => /^0\d{9}$/.test(raw || '') ? '+27' + raw.slice(1) : null,
    sendOtp: async()=>{calls.webOtp++;}, afterAuthentication: async()=>{calls.completed++;},
    verifyDriverProfile: async()=>{calls.completed++;},
    useAnotherSignInMethod: async()=>{calls.switched++; login.awaitingPhoneLink = false;},
    toast: message=>calls.errors.push(message), showStep(){}, startResendTimer(){}};
  const window = {['ASIYE_' + role.toUpperCase() + '_LOGIN']: login};
  if (installed) window.Asiye = {postMessage: message=>posted.push(JSON.parse(message))};
  const scope = {window, document: {getElementById: element},
    localStorage: {getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k)},
    firebase: {apps:[{}], auth: Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'LOCAL'}}})},
    setTimeout, clearTimeout, queueMicrotask:()=>{}, console:{error(){}}};
  vm.runInNewContext(fs.readFileSync('assets/native-auth-session.js','utf8'), scope);
  return {window, login, user, auth, calls, element, posted, values};
}

test('installed social OTP reads social input and sends original UID for native linking', async()=>{
  const x = setup();
  x.element('passengerPhoneInput').value = '0830000000';
  x.element('driverPhoneInput').value = '0821234567';
  await x.login.sendOtp();
  assert.equal(x.posted.length, 1);
  assert.deepEqual(x.posted[0], {action:'startPhoneSignIn', phone:'+27821234567', linkUid:x.user.uid});
  assert.equal(x.element('sendOtpButton').disabled, true);
  assert.equal(x.values.get('asiyePendingPhoneAuthLinkUid'), x.user.uid);
  await x.login.resendOtp();
  assert.equal(x.posted[1].linkUid, x.user.uid);
});

test('phone authentication cannot begin before driver social sign-in or for passengers', async()=>{
  for (const role of ['passenger','driver']) {
    const x = setup({role}); x.login.awaitingPhoneLink = false;
    x.element('driverPhoneInput').value = '0821234567';
    await x.login.sendOtp();
    assert.equal(x.posted.length, 0);
  }
});

test('a phone callback for another UID cannot replace the current social session', async()=>{
  const x = setup();
  await assert.rejects(()=>x.window.onNativeAuthSession({provider:'phone', customToken:'wrong-owner', uid:'phone-owner'}),
    /original account/);
  assert.equal(x.calls.tokens, 0);
  assert.equal(x.calls.completed, 0);
  assert.equal(x.auth.currentUser.uid, x.user.uid);
});

test('same-UID native phone session completes driver flow and clears link recovery state', async()=>{
  const x = setup();
  x.values.set('asiyePendingPhoneAuthLinkUid', x.user.uid);
  await x.window.onNativeAuthSession({provider:'phone', customToken:'linked-token', uid:x.user.uid});
  assert.equal(x.calls.tokens, 1);
  assert.equal(x.calls.completed, 1);
  assert.equal(x.values.has('asiyePendingPhoneAuthLinkUid'), false);
});

test('a changed social session sends no native OTP request', async()=>{
  const x = setup(); x.auth.currentUser = {uid:'different-user'};
  x.element('driverPhoneInput').value = '0821234567';
  await x.login.sendOtp();
  assert.equal(x.posted.length, 0);
  assert.match(x.element('phoneError').textContent, /session changed/);
});

test('native phone-link failure resets the social button and shows its own error', async()=>{
  const x = setup();
  x.element('sendOtpButton').disabled = true;
  x.window.onNativePhoneAuthError('This phone belongs to another Asiye account.');
  assert.equal(x.element('sendOtpButton').disabled, false);
  assert.match(x.element('phoneError').textContent, /another Asiye account/);
});

test('chooser waits for successful native sign-out and ignores stale acknowledgements', async()=>{
  const x = setup();
  const pending = x.login.useAnotherSignInMethod();
  assert.equal(x.calls.switched, 0);
  const request = x.posted[0];
  x.window.onNativeSignInReset({requestId:'stale',success:true});
  assert.equal(x.calls.switched, 0);
  x.window.onNativeSignInReset({requestId:request.requestId,success:true});
  await pending;
  assert.equal(x.calls.switched, 1);
});

test('failed native sign-out keeps the phone verification gate', async()=>{
  const x = setup();
  const pending = x.login.useAnotherSignInMethod();
  x.window.onNativeSignInReset({requestId:x.posted[0].requestId,success:false});
  await pending;
  assert.equal(x.calls.switched, 0);
  assert.equal(x.login.awaitingPhoneLink, true);
});

test('hosted website continues to use the original web OTP flow', async()=>{
  const x = setup({installed:false});
  await x.login.sendOtp();
  assert.equal(x.calls.webOtp, 1);
  assert.equal(x.posted.length, 0);
});
