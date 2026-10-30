'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {main,identityReport,diagnose}=require('../scripts/diagnose_staging_trip_end_403.cjs');
const indexes=require('../database.rules.json').rules.commuters['.indexOn'];
const trip={commuterId:'passenger-private',taxiId:'driver-private',type:'ehailing'};
test('diagnosis separates another passenger, a driver self-confirmation and a valid passenger',()=>{
 const profiles={'passenger-private':{authUid:'passenger-auth'}};
 const taxi={authUid:'driver-auth'};
 assert.equal(identityReport(trip,taxi,'stranger',profiles).EXPECTED_IDENTITY_RESULT,'PASSENGER_OWNERSHIP_403');
 assert.equal(identityReport(trip,taxi,'passenger-auth',profiles).EXPECTED_IDENTITY_RESULT,'IDENTITY_CHECK_PASSES');
 assert.equal(identityReport(trip,{authUid:'passenger-auth'},'passenger-auth',profiles).EXPECTED_IDENTITY_RESULT,'DRIVER_SELF_CONFIRMATION_403');
 const club={...trip,type:'club',passengers:{'passenger-private':{status:'in_transit',authUid:'different-auth'}}};
 assert.equal(identityReport(club,taxi,'passenger-auth',profiles).EXPECTED_IDENTITY_RESULT,'PASSENGER_OWNERSHIP_403');
});
test('read-only diagnostic uses only pinned staging GETs and never prints records or secrets',async()=>{
 const calls=[],output=[],uid='passenger-auth',secret='PRIVATE_OAUTH_TOKEN';
 const records={
  '/commuters/passenger-auth.json':null,
  '/requests/current-private-trip.json':{...trip,status:'in_transit',tripEndSafety:JSON.stringify({status:'pending',expiresAt:Date.now()+60000})},
  '/taxis/driver-private.json':{authUid:uid,bankAccountNumber:'PRIVATE_BANK_RECORD'}
 };
 const result=await main([uid],{
  command:args=>args[0]==='config'?'asiye-paystack-staging':args[0]==='projects'?'1000800408896':secret,
  fetch:async(url,options)=>{
   const u=new URL(url);calls.push(u);assert.equal(u.origin,'https://asiye-paystack-staging-default-rtdb.firebaseio.com');
   assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
   assert.equal(options.headers.Authorization,'Bearer '+secret);
   // Reproduce the deployed REST constraint rather than letting unindexed
   // mocked queries succeed (the original diagnostic's HTTP 400 regression).
   if(u.searchParams.has('orderBy')&&!indexes.includes(JSON.parse(u.searchParams.get('orderBy'))))
    return {ok:false,status:400,text:async()=>JSON.stringify({error:'Index not defined, PRIVATE_PROFILE_IDENTIFIER'})};
   let value=records[u.pathname];
   if(u.pathname==='/commuters.json')value=u.searchParams.get('orderBy')==='"authUid"'?
    {'passenger-private':{authUid:uid,currentRequest:'current-private-trip',phone:'PRIVATE_PHONE'}}:null;
   assert.notEqual(value,undefined,'No collection-wide or unrelated record reads');
   return {ok:true,text:async()=>JSON.stringify(value)};
  },print:line=>output.push(line)
 });
 assert.equal(result.EXPECTED_IDENTITY_RESULT,'DRIVER_SELF_CONFIRMATION_403');assert.equal(calls.length,4);
 for(const privateValue of [uid,secret,'PRIVATE_BANK_RECORD','PRIVATE_PHONE','current-private-trip','passenger-private','driver-private'])
  assert.equal(output.join('\n').includes(privateValue),false);
});
test('direct current-trip pointer works without making any indexed query',async()=>{
 const uid='passenger-auth',calls=[];
 const records={
  ['commuters/'+uid]:{currentRequest:'current-private-trip'},
  'requests/current-private-trip':{...trip,commuterId:uid,status:'in_transit'},
  'taxis/driver-private':{authUid:'driver-auth'}
 };
 const result=await diagnose(uid,async(path,query)=>{
  calls.push(path);assert.equal(query,undefined,'A direct pointer must not depend on any collection query');
  assert.ok(Object.hasOwn(records,path),'Only the selected records are read');return records[path];
 });
 assert.equal(result.EXPECTED_IDENTITY_RESULT,'IDENTITY_CHECK_PASSES');assert.equal(calls.length,3);
});
test('an explicit current trip supports userUid-only legacy profiles without an unindexed query',async()=>{
 const records={
  'requests/current-private-trip':{...trip,status:'in_transit'},
  'taxis/driver-private':{authUid:'driver-auth'},
  'commuters/passenger-private':{userUid:'passenger-auth'}
 };
 const result=await diagnose('passenger-auth',async(path,query)=>{
  assert.equal(query,undefined);assert.ok(Object.hasOwn(records,path));return records[path];
 },'current-private-trip');
 assert.equal(result.EXPECTED_IDENTITY_RESULT,'IDENTITY_CHECK_PASSES');
});
test('an actual missing-index response is categorized without leaking its raw body',async()=>{
 await assert.rejects(main(['passenger-auth'],{
  command:args=>args[0]==='config'?'asiye-paystack-staging':args[0]==='projects'?'1000800408896':'PRIVATE_TOKEN',
  fetch:async url=>new URL(url).pathname==='/commuters/passenger-auth.json'?
   {ok:true,text:async()=> 'null'}:
   {ok:false,status:400,text:async()=>JSON.stringify({error:'Index not defined. PRIVATE_IDENTIFIER'})}
 }),error=>error.message==='STAGING_QUERY_INDEX_MISSING');
});
test('wrong project stops before authentication or database reads',async()=>{
 let reads=0;
 await assert.rejects(main(['passenger-auth'],{command:()=> 'asiye-80386',fetch:async()=>{reads++;}}),/STAGING_PROJECT_IDENTITY_MISMATCH/);
 assert.equal(reads,0);
});
