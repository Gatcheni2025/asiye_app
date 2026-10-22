'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {assertPassengerBookingProfile}=require('../functions/passenger-booking-profile');
const valid={name:'Mandla',profileImageUrl:'https://test.invalid/face.jpg',bookingFaceSavedAt:123,bookingFaceAuthUid:'social'};

test('booking requires a server-confirmed picture for the signed-in UID, with no phone dependency',()=>{
 assert.doesNotThrow(()=>assertPassengerBookingProfile(valid,{uid:'social'}));
 for(const profile of [{},{...valid,bookingFaceAuthUid:'other'},{...valid,bookingFaceSavedAt:0},
   {name:'Mandla',profileImageUrl:valid.profileImageUrl,faceScanCompleted:true}, {...valid,profileImageUrl:''}]){
   assert.throws(()=>assertPassengerBookingProfile(profile,{uid:'social'}),e=>e.status===403&&e.code==='passenger-face-required');
 }
});
test('camera preview cannot be saved; a captured picture survives a save failure for retry',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('assets/passenger-v2/js/onboarding.js','utf8'),{window});
 const s=window.AsiyePassengerOnboarding.createSession();
 assert.equal(s.canSave,false);s.opening();s.live();assert.equal(s.canSave,false);
 assert.throws(()=>s.saving(),/Capture/);assert.throws(()=>s.captured(''),/No picture/);
 s.captured('data:image/jpeg;base64,/9j/');assert.equal(s.canSave,true);s.saving();assert.equal(s.canSave,false);
 s.retry();assert.equal(s.canSave,true);assert.equal(s.photo,'data:image/jpeg;base64,/9j/');
 s.saving();s.saved();assert.equal(s.phase,'saved');
 s.cancel();assert.equal(s.photo,'');assert.equal(s.canSave,false);
});
function uploadHarness({provider='google.com',probeOk=true}={}) {
 let savedBytes, savedOptions, patch=null;
 const file={save:async(bytes,options)=>{savedBytes=bytes;savedOptions=options;},getMetadata:async()=>[{size:savedBytes.length,metadata:savedOptions.metadata.metadata}]};
 const admin={auth:()=>({verifyIdToken:async()=>({uid:'social'}),getUser:async()=>({providerData:[{providerId:provider}]})}),
 database:Object.assign(()=>({ref:()=>({once:async()=>({val:()=>({authUid:'social'})}),update:async p=>{patch=p;}})}),{ServerValue:{TIMESTAMP:123}}),
 storage:()=>({bucket:()=>({file:()=>file})})};
 const source=fs.readFileSync('functions/index.js','utf8');
 const a=source.indexOf('exports.uploadProfileImageProxy ='),b=source.indexOf('// Verified, create-once driver enrollment',a);
 const scope={exports:{},onRequest:(_,fn)=>fn,walletSmsCors(){},admin,safeProfileId:x=>x,profileOwnedByAuth:async()=>true,
 profileImageExtension:()=> 'jpg',firebaseStorageDownloadUrl:()=>valid.profileImageUrl,PROFILE_STORAGE_BUCKET:'fake',
 require,Buffer,AbortSignal,fetch:async()=>({ok:probeOk,status:probeOk?200:404,arrayBuffer:async()=>new ArrayBuffer(0)}),console:{error(){},warn(){}}};
 vm.runInNewContext(source.slice(a,b),scope);
 const req={method:'POST',get:()=> 'Bearer token',body:{userId:'social',purpose:'passenger-profile',fullName:'Mandla',completeSignup:true,
 dataUrl:'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216]),Buffer.alloc(150)]).toString('base64')}};
 const res={statusCode:200,status(c){this.statusCode=c;return this;},json(body){this.body=body;return this;},set(){},send(){}};
 return {run:()=>scope.exports.uploadProfileImageProxy(req,res),res,get patch(){return patch;}};
}
test('real upload handler saves face and completion for Google/Apple passengers with no phone',async()=>{
 for(const provider of ['google.com','apple.com']){
  const h=uploadHarness({provider});await h.run();assert.equal(h.res.statusCode,200);
  assert.equal(h.patch.bookingFaceAuthUid,'social');assert.equal(h.patch.bookingFaceSavedAt,123);assert.equal(h.patch.name,'Mandla');assert.equal(h.patch.phone,undefined);
 }
});
test('failed storage readback or unsupported sign-in cannot mark a face as saved',async()=>{
 for(const options of [{probeOk:false},{provider:'phone'}]){
  const h=uploadHarness(options);await h.run();assert.ok(h.res.statusCode>=400);assert.equal(h.patch,null);
 }
});
test('all booking endpoints enforce the photo before reserving or dispatching',()=>{
 const index=fs.readFileSync('functions/index.js','utf8'),club=fs.readFileSync('functions/club-lifecycle.js','utf8');
 assert.ok(index.indexOf('assertPassengerBookingProfile(bookingProfile, decoded)')<index.indexOf('.transaction(',index.indexOf('exports.submitGoFareOffer =')));
 const parcel=index.slice(index.indexOf('exports.createParcelRequestSecure ='),index.indexOf('exports.cancelParcelBookingSecure ='));
 assert.ok(parcel.indexOf('assertPassengerBookingProfile(passenger, user)')<parcel.indexOf('.push()'));
 for(const name of ['create','join']){
  const body=club.slice(club.indexOf(`const ${name} = endpoint`));
  assert.ok(body.indexOf('assertPassengerBookingProfile(profile, user)')<body.indexOf('reservePassenger('));
 }
});

test('staging rollout selects only seven existing auth/booking functions and never production',()=>{
 const {FUNCTIONS}=require('../scripts/deploy_staging_auth_booking_flow.cjs');
 assert.equal(FUNCTIONS.length,7);assert.equal(new Set(FUNCTIONS).size,7);
 const allowed=[...require('../scripts/paystack_function_manifest.json'),'submitDriverEnrollmentSecure','uploadDriverEnrollmentDocument'];
 for(const name of FUNCTIONS)assert.ok(allowed.includes(name));
});

test('staging rollout accepts only the known old generated package edit, preserving custom edits',()=>{
 const {isGeneratedPackageChange}=require('../scripts/deploy_staging_auth_booking_flow.cjs');
 const reviewed={main:'index.js',engines:{node:'22'},dependencies:{example:'1.0.0'}};
 const generated={...reviewed,main:'staging-index.generated.cjs'};
 assert.equal(isGeneratedPackageChange(['functions/package.json'],generated,reviewed),true);
 assert.equal(isGeneratedPackageChange(['assets/passenger-v2/js/login.js'],generated,reviewed),false);
 assert.equal(isGeneratedPackageChange(['functions/package.json'],{...generated,engines:{node:'18'}},reviewed),false);
});
