const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {makeEnrollmentSubmission}=require('../functions/enrollment-submission.js');

const uid='verified-driver-17';
const submissionId='a6f8fddb-d132-4936-abf5-4779a75af245';
const base='driverEnrollments/'+uid+'/'+submissionId+'/';
function sample(){
 return {fullName:'Test Driver',residentialAddress:'45 Test Road, Durban',
   vehiclePending:{type:'sedan',make:'Toyota',model:'Corolla',colour:'white',year:2020,
      registration:'ND12345',seats:4},
   references:{
     reference1:{name:'Reference One',phone:'0821234567',relationship:'Colleague'},
     reference2:{name:'Reference Two',phone:'0831234567',relationship:'Colleague'},
     reference3:{name:'Reference Three',phone:'0841234567',relationship:'Colleague'}
   },
   banking:{accountHolder:'Test Driver',bank:'FNB',accountNumber:'1234567890',
      branchCode:'250655',accountType:'Savings'},
   consent:true
 };
}
function harness({phone='+27821234567',storedOwner=uid,existing=null,verifiedTaxi=false}={}){
 const writes={count:0,taxi:null,record:null};
 const req={method:'POST',get:(k)=>k==='authorization'?'Bearer verified':'',
   body:{submissionId,enrollment:sample()}};
 const res={statusCode:200,body:null,
   set(){return this;},status(code){this.statusCode=code;return this;},
   json(v){this.body=v;return this;},send(v){this.body=v;return this;}};
 let saved=existing;
 const admin={
   auth:()=>({verifyIdToken:async()=>({uid,phone_number:phone}),
      getUser:async()=>({phoneNumber:phone})}),
   database:Object.assign(()=>({ref:path=>{
      if(path==='driverEnrollments/'+uid) return {
        once:async()=>({val:()=>saved}),
        transaction:async fn=>{const next=fn(saved);
          if(next===undefined) return {committed:false,snapshot:{val:()=>saved}};
          writes.count++;writes.record=next;saved=next;
          return {committed:true,snapshot:{val:()=>saved}};
        }
      };
      if(path==='taxis/'+uid) return {
        once:async()=>({val:()=>verifiedTaxi?{verificationStatus:'verified',vehicleApproved:true}:null}),
        update:async v=>{writes.taxi=v}
      };
      throw Error('Unexpected path '+path);
    }}),{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}),
   storage:()=>({bucket:()=>({file:path=>{
     assert.ok(path.startsWith(base));
     return {getMetadata:async()=>[{metadata:{
        ownerUid:storedOwner,
        enrollmentKind:path.split('/').pop(),
        firebaseStorageDownloadTokens:'a6f8fddb-d132-4936-abf5-4779a75af245'
      },size:'4096'}]};
   }})})
 };
 const handler=makeEnrollmentSubmission({admin,bucketName:'fake-bucket',cors:()=>{}});
 return {req,res,writes,handler:()=>handler(req,res)};
}
test('OTP-authenticated driver with five owned documents submits pending once',async()=>{
 const h=harness();await h.handler();
 assert.equal(h.res.statusCode,200);
 assert.equal(h.res.body.status,'pending');
 assert.equal(h.writes.count,1);
 assert.equal(h.writes.record.phone,'+27821234567');
 assert.equal(h.writes.record.verificationStatus,undefined);
 assert.equal(h.writes.record.documents.identity,base+'identity');
 assert.equal(h.writes.record.documentUrls.address.includes('fake-bucket'),true);
 assert.equal(h.writes.taxi.vehicleApproved,false);
 assert.equal(h.writes.taxi.isOnline,false);
 await h.handler();
 assert.equal(h.res.body.alreadySubmitted,true);
 assert.equal(h.writes.count,1);
});
test('driver cannot submit without verified Firebase Auth phone',async()=>{
 const h=harness({phone:''});await h.handler();
 assert.equal(h.res.statusCode,403);
 assert.equal(h.writes.count,0);
});
test('upload from another driver cannot be used in enrollment',async()=>{
 const h=harness({storedOwner:'another-uid'});await h.handler();
 assert.equal(h.res.statusCode,403);
 assert.equal(h.writes.count,0);
});
test('registered taxi cannot be downgraded to pending by new form',async()=>{
 const h=harness({verifiedTaxi:true});await h.handler();
 assert.equal(h.res.statusCode,409);
 assert.equal(h.writes.count,0);
});
test('the enrollment frontend posts to the server, not directly to protected RTDB',()=>{
 const src=fs.readFileSync('assets/driver-v2/js/enrollment.js','utf8');
 const part=src.slice(src.indexOf('const enrollmentRecord ='),src.indexOf('// Show the saved application state.'));
 assert.match(part,/submitDriverEnrollmentSecure/);
 assert.doesNotMatch(part,/\.ref\(`driverEnrollments\/\$\{user.uid\}\`\)/);
 assert.match(part,/Authorization:/);
});
test('new passenger with no phone is sent to actual OTP screen instead of false completion',()=>{
 const src=fs.readFileSync('assets/passenger-v2/js/login.js','utf8');
 assert.match(src,/if \(!user\.phoneNumber\) \{/);
 assert.match(src,/this\.showStep\('loginStep'\)/);
 assert.match(src,/uploaded\.code === 'phone-otp-required'/);
 const backend=fs.readFileSync('functions/index.js','utf8');
 assert.match(backend,/admin\.auth\(\)\.getUser\(decoded\.uid\)/);
 assert.match(backend,/phone: verifiedPhone/);
});
