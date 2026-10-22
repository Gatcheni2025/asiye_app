'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {ref,set}=require('firebase/database');
const admin=require('../../functions/node_modules/firebase-admin');
let env,app,db,handlers,originalGetUser;
const projectId='demo-asiye-admin-reviewer';
const reviewer={auth:{uid:'reviewer',token:{enrollmentReviewer:true,email:'reviewer@example.test'}}};
const enrollment=()=>({version:2,status:'pending',authUid:'driver',fullName:'Test Driver',phone:'+27821234567',phoneVerified:true,
 residentialAddress:'10 Test Road, Durban',vehicleMake:'Toyota',vehicleModel:'Corolla',vehicleColor:'White',vehicleYear:2025,vehicleReg:'ND1234',
 vehiclePending:{type:'sedan',make:'Toyota',model:'Corolla',colour:'White',year:2025,registration:'ND1234',seats:4},
 profileImageUrl:'https://example.test/selfie.jpg',profile_picture_url:'https://example.test/selfie.jpg',vehiclePhoto:'https://example.test/car.jpg',
 documents:{selfie:'owned/selfie',car:'owned/car',identity:'owned/identity',licence:'owned/licence',address:'owned/address'},
 documentUrls:Object.fromEntries(['selfie','car','identity','licence','address'].map(k=>[k,'https://example.test/'+k+'.jpg'])),submittedAt:1});
before(async()=>{
 const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;assert.match(host||'',/^(127\.0\.0\.1|localhost):\d+$/);
 env=await initializeTestEnvironment({projectId,database:{rules:fs.readFileSync('../../database.rules.json','utf8')}});
 app=admin.initializeApp({projectId,databaseURL:`http://${host}?ns=${projectId}`});db=app.database();
 originalGetUser=admin.auth().getUser;admin.auth().getUser=async uid=>({uid,phoneNumber:'+27821234567',email:'driver@example.test'});
 handlers=require('../../functions/index');
});
beforeEach(async()=>{await db.ref().set({driverEnrollments:{driver:enrollment()},taxis:{driver:{authUid:'driver',verificationStatus:'pending',walletBalance:19}}});});
after(async()=>{admin.auth().getUser=originalGetUser;await app?.delete();await env?.cleanup();});
test('ordinary users cannot list or approve applications, while reviewer cannot use financial admin APIs',async()=>{
 await assert.rejects(()=>handlers.adminEnrollmentConsole.run({data:{action:'list'},auth:{uid:'passenger',token:{}}}),e=>e.code==='permission-denied');
 await assert.rejects(()=>handlers.reviewDriverEnrollmentSecure.run({data:{uid:'driver',decision:'approved'},auth:{uid:'passenger',token:{}}}),e=>e.code==='permission-denied');
 for(const name of ['adminFetchData','adminManagePlatform','adminOperations'])
  await assert.rejects(()=>handlers[name].run({},reviewer),e=>e.code==='permission-denied');
 assert.equal((await db.ref('driverEnrollments/driver/status').once('value')).val(),'pending');
});
test('reviewer lists submitted documents, approves the driver, and preserves existing balances',async()=>{
 const listed=await handlers.adminEnrollmentConsole.run({...reviewer,data:{action:'list',resource:'driverEnrollments',limit:500}});
 assert.equal(listed.data.driver.documentUrls.identity,'https://example.test/identity.jpg');
 const result=await handlers.reviewDriverEnrollmentSecure.run({...reviewer,data:{uid:'driver',decision:'approved'}});
 assert.equal(result.ok,true);assert.equal(result.status,'approved');
 const taxi=(await db.ref('taxis/driver').once('value')).val();
 assert.equal(taxi.verificationStatus,'verified');assert.equal(taxi.vehicleApproved,true);assert.equal(taxi.walletBalance,19);
 assert.equal((await db.ref('driverApprovals/driver/status').once('value')).val(),'approved');
 assert.equal((await db.ref('driverEnrollments/driver/status').once('value')).val(),'approved');
 assert.ok((await db.ref('adminAudit').once('value')).exists());
});
test('incomplete documents cannot activate a driver and clients cannot bootstrap their own admin role',async()=>{
 await db.ref('driverEnrollments/driver/documents/identity').remove();
 await assert.rejects(()=>handlers.reviewDriverEnrollmentSecure.run({...reviewer,data:{uid:'driver',decision:'approved'}}),e=>e.code==='failed-precondition');
 await assertFails(set(ref(env.authenticatedContext('passenger').database(),'admins/passenger'),true));
 await assertFails(set(ref(env.authenticatedContext('reviewer',{enrollmentReviewer:true}).database(),'admins/reviewer'),true));
 assert.equal((await db.ref('taxis/driver/verificationStatus').once('value')).val(),'pending');
});
