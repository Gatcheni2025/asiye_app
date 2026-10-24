'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(role, user) {
 const nodes=new Map(), stored=new Map(), calls={created:0,completed:0,linked:0,direct:0};
 const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,classList:{add(){},remove(){}},addEventListener(){},focus(){}});return nodes.get(id);};
 const auth={currentUser:user, signOut:async()=>{auth.currentUser=null;}, signInWithPhoneNumber:async()=>{calls.direct++;throw Error('Must not replace UID');}};
 const profile={authUid:user.uid,name:user.displayName||''};
 const firebase={auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'LOCAL'}}}),database:Object.assign(()=>({ref:()=>({
   once:async()=>({exists:()=>true,val:()=>profile}),
   transaction:async fn=>{calls.created++;Object.assign(profile,fn(null));return {snapshot:{val:()=>profile}};}
 })}),{ServerValue:{TIMESTAMP:1}})};
 const scope={window:{location:{replace(){}}},document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},firebase,
 localStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval:()=>1,clearInterval,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(`assets/${role}-v2/js/login.js`,'utf8'),scope);
 const login=scope.window[`ASIYE_${role.toUpperCase()}_LOGIN`];let step='';
 login.showStep=id=>{step=id;};login.toast=()=>{};
 return {login,auth,element,calls,stored,profile,get step(){return step;}};
}
test('Google and Apple passengers without phone or picture enter their existing account',async()=>{
 for(const providerId of ['google.com','apple.com']){
  const user={uid:'social',phoneNumber:null,providerData:[{providerId}]};const x=setup('passenger',user);
  x.login.resolvePassengerProfile=async()=>({id:user.uid,data:{authUid:user.uid}});
  x.login.completeLogin=async()=>{x.calls.completed++;};
  await x.login.afterAuthentication(user);
  assert.equal(x.calls.completed,1);assert.equal(x.login.awaitingPhoneLink,false);
  await x.login.sendOtp();assert.equal(x.calls.direct,0);
 }
});
test('first passenger signup creates one owned profile without phone or image',async()=>{
 const user={uid:'new-social',displayName:'Mandla',providerData:[{providerId:'google.com'}]};const x=setup('passenger',user);
 x.login.resolvePassengerProfile=async()=>null;x.login.completeLogin=async()=>{x.calls.completed++;};
 await x.login.afterAuthentication(user);assert.equal(x.calls.created,1);assert.equal(x.calls.completed,1);
 assert.equal(x.profile.authUid,user.uid);assert.equal(x.profile.phone,undefined);assert.equal(x.profile.faceScanCompleted,undefined);
});
test('passenger cannot claim another profile or use phone-only authentication',async()=>{
 const user={uid:'social',providerData:[{providerId:'apple.com'}]};const x=setup('passenger',user);
 await assert.rejects(()=>x.login.completeLogin('other',{authUid:'other'},user),/ownership/);
 await x.login.afterAuthentication({uid:'phone-only',providerData:[{providerId:'phone'}],phoneNumber:'+27821234567'});
 assert.equal(x.step,'loginStep');assert.equal(x.calls.created,0);
});
test('driver sees social chooser first, then phone verification only when needed',()=>{
 const user={uid:'driver',providerData:[{providerId:'google.com'}]};const x=setup('driver',user);
 assert.equal(x.login.driverIdentityReady({uid:'phone-only',phoneNumber:'+27821234567'}),false);assert.equal(x.step,'loginStep');
 assert.equal(x.login.driverIdentityReady(user),false);assert.equal(x.step,'phoneStep');assert.equal(x.login.pendingUser.uid,user.uid);
 user.phoneNumber='+27821234567';assert.equal(x.login.driverIdentityReady(user),true);assert.equal(x.login.awaitingPhoneLink,false);
});
test('web driver OTP links Google/Apple UID, never signs into a separate phone account',async()=>{
 for(const providerId of ['google.com','apple.com']){
  const user={uid:'driver',providerData:[{providerId}]};const x=setup('driver',user);x.login.driverIdentityReady(user);
  x.login.prepareRecaptcha=async()=>({});x.login.startResendTimer=()=>{};
  user.linkWithPhoneNumber=async phone=>{x.calls.linked++;return {confirm:async()=>{user.phoneNumber=phone;return {user};}};};
  x.element('driverPhoneInput').value='0821234567';await x.login.sendOtp();assert.equal(x.step,'otpStep');
  x.login.verifyDriverProfile=async u=>{assert.equal(u.uid,user.uid);x.calls.completed++;};
  x.element('driverOtpInput').value='123456';await x.login.verifyOtp();
  assert.equal(x.calls.linked,1);assert.equal(x.calls.direct,0);assert.equal(x.calls.completed,1);
 }
});
test('driver session changes or phone credential collisions do not complete login',async()=>{
 const user={uid:'driver',providerData:[{providerId:'google.com'}]};const x=setup('driver',user);x.login.driverIdentityReady(user);
 x.login.prepareRecaptcha=async()=>({});x.element('driverPhoneInput').value='0821234567';
 user.linkWithPhoneNumber=async()=>{throw {code:'auth/credential-already-in-use'};};
 await x.login.sendOtp();assert.match(x.element('phoneError').textContent,/another Asiye account/);assert.equal(x.calls.completed,0);
 x.auth.currentUser={uid:'changed'};await x.login.sendOtp();assert.equal(x.step,'loginStep');assert.equal(x.calls.direct,0);
});
test('passenger signup markup has only social methods; driver phone is a later step',()=>{
 const passenger=fs.readFileSync('assets/passenger-v2/login.html','utf8'), driver=fs.readFileSync('assets/driver-v2/login.html','utf8');
 assert.doesNotMatch(passenger,/id="(?:passengerPhoneInput|verifyPhoneStep|newPassengerStep)"/);
 for(const id of ['googleLoginButton','appleLoginButton'])assert.ok(passenger.includes(`id="${id}"`));
 assert.match(driver,/id="loginStep" class="login-step active"/);assert.match(driver,/id="phoneStep"\s+class="login-step"/);
});

test('a verified driver profile read failure returns to social chooser, not another OTP',()=>{
 const user={uid:'driver',phoneNumber:'+27821234567',providerData:[{providerId:'google.com'}]};
 const x=setup('driver',user);assert.equal(x.login.driverIdentityReady(user),true);
 // Run the real showStep with recorded DOM activation.
 const source=fs.readFileSync('assets/driver-v2/js/login.js','utf8');
 const window={};let activated='';
 vm.runInNewContext(source,{window,document:{querySelectorAll:()=>[],getElementById:id=>({classList:{add(){activated=id;}}}),addEventListener(){}},console});
 window.ASIYE_DRIVER_LOGIN.awaitingPhoneLink=false;window.ASIYE_DRIVER_LOGIN.showStep('phoneStep');
 assert.equal(activated,'loginStep');
});
