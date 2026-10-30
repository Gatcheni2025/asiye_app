'use strict';
const {test,before,after,beforeEach}=require('node:test');
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,set,update}=require('firebase/database');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'asiye-booking-face-rules',database:{rules:fs.readFileSync('../../database.rules.json','utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearDatabase();await env.withSecurityRulesDisabled(async c=>set(ref(c.database()),{commuters:{rider:{authUid:'rider',name:'Rider'}}}));});
test('a Google/Apple passenger can create a basic profile without phone or picture',async()=>{
 const db=env.authenticatedContext('new-rider').database();
 await assertSucceeds(set(ref(db,'commuters/new-rider'),{authUid:'new-rider',name:'New Rider'}));
});
test('passengers cannot set or delete server-owned booking picture completion',async()=>{
 const db=env.authenticatedContext('rider').database();
 await assertFails(update(ref(db,'commuters/rider'),{bookingFaceAuthUid:'rider',bookingFaceSavedAt:Date.now()}));
 await env.withSecurityRulesDisabled(c=>update(ref(c.database(),'commuters/rider'),{bookingFaceAuthUid:'rider',bookingFaceSavedAt:1}));
 await assertFails(update(ref(db,'commuters/rider'),{bookingFaceSavedAt:null}));
 await assertSucceeds(update(ref(db,'commuters/rider'),{name:'Updated Rider'}));
});
test('direct Go request cannot precede the saved picture or bypass the root via passenger child',async()=>{
 const db=env.authenticatedContext('rider').database();
 const request={commuterId:'rider',type:'ehailing',status:'pending'};
 await assertFails(set(ref(db,'requests/new-go'),request));
 await assertFails(set(ref(db,'requests/child-bypass/passengers/rider'),{commuterId:'rider'}));
 await assertSucceeds(update(ref(db,'commuters/rider'),{faceScanCompleted:true,profileImageUrl:'https://untrusted.invalid/avatar.jpg'}));
 await assertFails(set(ref(db,'requests/new-go'),request));
 await env.withSecurityRulesDisabled(c=>update(ref(c.database(),'commuters/rider'),{bookingFaceAuthUid:'rider',bookingFaceSavedAt:1}));
 await assertSucceeds(set(ref(db,'requests/new-go'),request));
});
