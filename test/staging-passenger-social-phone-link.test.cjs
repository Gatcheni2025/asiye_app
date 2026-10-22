'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('assets/passenger-v2/js/login.js','utf8');
const html=fs.readFileSync('assets/passenger-v2/login.html','utf8');
const {rewrite}=require('../scripts/build_staging_web_preview.cjs');
function setup(user){
  const nodes=new Map();
  const element=id=>{
    if(!nodes.has(id))nodes.set(id,{id,value:'',textContent:'',disabled:false,innerHTML:'',
      classList:{add(){},remove(){}},addEventListener(){},focus(){}});
    return nodes.get(id);
  };
  const auth={currentUser:user,
    signInWithPhoneNumber:async()=>{throw Error('Direct phone call not configured');}};
  const fbauth=()=>auth;
  fbauth.RecaptchaVerifier=class {};
  const window={};
  const scope={window,document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},
    firebase:{auth:fbauth},console:{log(){},warn(){},error(){}},
    localStorage:{setItem(){},getItem(){return null;}},setTimeout(){},clearTimeout(){},
    setInterval(){return 1;},clearInterval(){},Image:class {}};
  vm.runInNewContext(src,scope,{filename:'passenger-login.js'});
  const login=window.ASIYE_PASSENGER_LOGIN;
  let step='',completed=0;
  login.showStep=id=>{step=id;};
  login.toast=()=>{};
  login.prepareRecaptcha=async()=>({kind:'test-recaptcha'});
  login.startResendTimer=()=>{};
  login.storedFaceAvailable=async()=>true;
  login.resolvePassengerProfile=async()=>({id:user.uid,data:{
    name:'Verified Passenger',profileImageUrl:'https://example.invalid/photo.jpg'}});
  login.completeLogin=async()=>{completed++;};
  return {login,auth,nodes,element,get step(){return step;},get completed(){return completed;}};
}
test('social sign-in requires one-time OTP even if cached profile has a phone field',async()=>{
  const user={uid:'social-uid',phoneNumber:null,providerData:[{providerId:'google.com'}]};
  const x=setup(user);
  await x.login.afterAuthentication(user);
  assert.equal(x.step,'verifyPhoneStep');
  assert.equal(x.completed,0);
  assert.equal(x.login.awaitingPhoneLink,true);
});
test('Google/Apple OTP links same UID, never calls signInWithPhoneNumber, then unlocks existing profile',async()=>{
 for(const providerId of ['google.com','apple.com']){
   const user={uid:'social-uid',phoneNumber:null,providerData:[{providerId}],
     async reload(){}};
   const x=setup(user);let linked=0,signed=0;
   x.auth.signInWithPhoneNumber=async()=>{signed++;throw Error('Do not switch UID');};
   user.linkWithPhoneNumber=async(number,verifier)=>{
     assert.equal(number,'+27821234567');assert.ok(verifier);
     linked++;
     return {confirm:async code=>{
       assert.equal(code,'123456');user.phoneNumber='+27821234567';
       return {user};
     }};
   };
   await x.login.afterAuthentication(user);
   x.element('socialPhoneInput').value='0821234567';
   await x.login.sendOtp();
   assert.equal(x.step,'otpStep');
   x.element('passengerOtpInput').value='123456';
   await x.login.verifyOtp();
   assert.equal(linked,1);assert.equal(signed,0);
   assert.equal(x.completed,1);
   assert.equal(x.login.awaitingPhoneLink,false);
   assert.equal(x.login.pendingUser.uid,'social-uid');
 }
});
test('phone sign-in verifies OTP directly and does not request a second OTP for completed profile',async()=>{
 const user={uid:'phone-uid',phoneNumber:null,providerData:[{providerId:'phone'}]};
 const x=setup(user);let direct=0,linked=0;
 x.auth.signInWithPhoneNumber=async(phone)=>{
   direct++;
   return {confirm:async code=>{assert.equal(code,'123456');user.phoneNumber=phone;return {user};}};
 };
 user.linkWithPhoneNumber=async()=>{linked++;throw Error('Should not link');};
 x.element('passengerPhoneInput').value='0821234567';
 await x.login.sendOtp();
 x.element('passengerOtpInput').value='123456';
 await x.login.verifyOtp();
 assert.equal(direct,1);assert.equal(linked,0);assert.equal(x.completed,1);
 await x.login.afterAuthentication(user);
 assert.equal(x.completed,2);assert.equal(x.login.awaitingPhoneLink,false);
});
test('first-time verified phone user still needs required name and face scan',async()=>{
 const user={uid:'first-time-uid',phoneNumber:'+27821234567'};
 const x=setup(user);
 x.login.resolvePassengerProfile=async()=>null;
 await x.login.afterAuthentication(user);
 assert.equal(x.step,'newPassengerStep');
 assert.equal(x.completed,0);
});
test('UID changes or already-linked phone credentials cannot silently log in',async()=>{
 const user={uid:'original-social-uid',phoneNumber:null,providerData:[{providerId:'apple.com'}],
   async reload(){}};
 const x=setup(user);
 await x.login.afterAuthentication(user);
 user.linkWithPhoneNumber=async()=>({
  confirm:async()=>({user:{uid:'WRONG-UID',phoneNumber:'+27821234567'}})
 });
 x.element('socialPhoneInput').value='0821234567';
 await x.login.sendOtp();
 x.element('passengerOtpInput').value='123456';
 await x.login.verifyOtp();
 assert.equal(x.completed,0);
 assert.equal(x.login.awaitingPhoneLink,true);
 assert.equal(x.auth.currentUser.uid,'original-social-uid');
});
test('social phone view is part of passenger UI with separate input and OTP buttons',()=>{
 for(const id of ['verifyPhoneStep','socialPhoneInput','socialPhoneError','socialSendOtpButton',
                  'passengerPhoneInput','otpStep','newPassengerStep']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(src,/current\.linkWithPhoneNumber\(phone, verifier\)/);
 assert.match(src,/firebase\.auth\(\)\.signInWithPhoneNumber\(phone, verifier\)/);
 assert.doesNotMatch(src,/await this\.completeLogin\(\s*authUser\.uid,/);
 const clean=src.slice(src.indexOf('async afterAuthentication('),src.indexOf('async resolvePassengerProfile('));
 assert.ok(clean.indexOf("if (!user.phoneNumber)")<clean.indexOf("this.resolvePassengerProfile("));
});
