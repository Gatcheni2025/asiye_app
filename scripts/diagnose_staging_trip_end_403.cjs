'use strict';
// Read one passenger's current staging trip. Never changes a booking, profile,
// permission, payment or deployment; never prints records, UIDs or tokens.
const {spawnSync}=require('node:child_process');
const {members,decode}=require('../functions/trip-end-safety');
const PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
const DATABASE='https://asiye-paystack-staging-default-rtdb.firebaseio.com';
const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
function command(args){
 const result=spawnSync('gcloud',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(result.status!==0||result.error)throw Error('CLOUD_SHELL_READ_UNAVAILABLE');
 return result.stdout.trim();
}
function identityReport(trip,taxi,uid,profiles){
 const owned=members(trip).filter(id=>{
  const profile=profiles[id]||{};
  return (id===uid||profile.authUid===uid||profile.userUid===uid)&&
   (trip.type!=='club'||trip.passengers[id].authUid===uid);
 });
 const sameDriver=uid===(taxi?.authUid||taxi?.userUid||trip.taxiId);
 return {
  PASSENGER_OWNS_EXACTLY_ONE_ONBOARD_PROFILE:owned.length===1,
  DRIVER_AND_PASSENGER_USE_SAME_AUTH_ACCOUNT:sameDriver,
  EXPECTED_IDENTITY_RESULT:owned.length!==1?'PASSENGER_OWNERSHIP_403':
   sameDriver?'DRIVER_SELF_CONFIRMATION_403':'IDENTITY_CHECK_PASSES'
 };
}
async function diagnose(uid,read){
 const profiles={};let candidates={};
 const direct=await read('commuters/'+uid);
 if(direct)profiles[uid]=direct;
 // Include linked legacy IDs, without downloading the commuters collection.
 for(const field of ['authUid','userUid']){
  const matches=await read('commuters',{orderBy:JSON.stringify(field),equalTo:JSON.stringify(uid),limitToFirst:'3'});
  if(matches&&Object.keys(matches).length>=3)throw Error('PASSENGER_PROFILE_LOOKUP_AMBIGUOUS');
  for(const [id,profile]of Object.entries(matches||{})){
   if(!validKey(id))throw Error('PASSENGER_PROFILE_KEY_UNSUPPORTED');
   profiles[id]=profile;
  }
 }
 for(const profile of Object.values(profiles)){
  const id=profile?.currentRequest;
  if(id!=null){if(!validKey(id))throw Error('CURRENT_TRIP_KEY_UNSUPPORTED');candidates[id]=true;}
 }
 const ids=Object.keys(candidates);
 if(ids.length!==1)throw Error(ids.length?'MULTIPLE_CURRENT_TRIPS_REQUIRE_REVIEW':'NO_CURRENT_TRIP_FOR_PASSENGER');
 const trip=decode(await read('requests/'+ids[0]));
 if(!trip)throw Error('CURRENT_TRIP_NOT_FOUND');
 if(!validKey(trip.taxiId))throw Error('CURRENT_TRIP_HAS_NO_SUPPORTED_DRIVER');
 const taxi=await read('taxis/'+trip.taxiId);
 for(const id of members(trip)){
  if(!validKey(id))throw Error('ONBOARD_PASSENGER_KEY_UNSUPPORTED');
  if(id!==uid&&!profiles[id])profiles[id]=await read('commuters/'+id);
 }
 const end=trip.tripEndSafety;
 return {
  CURRENT_TRIP_IS_IN_TRANSIT:trip.status==='in_transit',
  END_REQUEST_IS_PENDING:end?.status==='pending',
  END_REQUEST_HAS_EXPIRED:!!end&&Number(end.expiresAt)<=Date.now(),
  ...identityReport(trip,taxi,uid,profiles)
 };
}
async function main(args=process.argv.slice(2),deps={}){
 if(args.length!==1||!validKey(args[0]))throw Error('USE_ONE_PASSENGER_AUTH_UID_FROM_THE_PASSENGER_CONSOLE');
 const run=deps.command||command,http=deps.fetch||fetch,print=deps.print||console.log;
 if(run(['config','get-value','project'])!==PROJECT||
  run(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
  throw Error('STAGING_PROJECT_IDENTITY_MISMATCH');
 const token=run(['auth','print-access-token']);
 if(!token)throw Error('CLOUD_SHELL_READ_UNAVAILABLE');
 const read=async(path,query={})=>{
  const url=new URL(DATABASE+'/'+path+'.json');
  for(const [key,value]of Object.entries(query))url.searchParams.set(key,value);
  let response;
  try{response=await http(url.href,{method:'GET',headers:{Authorization:'Bearer '+token},
   redirect:'error',signal:AbortSignal.timeout(20000)});}catch(_){throw Error('STAGING_DATABASE_READ_UNAVAILABLE');}
  if(!response.ok)throw Error('STAGING_DATABASE_READ_HTTP_'+response.status);
  const text=await response.text();
  if(text.length>1024*1024)throw Error('STAGING_DATABASE_READ_SIZE_LIMIT');
  try{return JSON.parse(text);}catch(_){throw Error('STAGING_DATABASE_RESPONSE_UNAVAILABLE');}
 };
 const report=await diagnose(args[0],read);
 print('PROJECT='+PROJECT+' | READ_ONLY');
 for(const [key,value]of Object.entries(report))print(key+'='+value);
 print('No records, identities, credentials or payment references printed. No writes or deployments.');
 return report;
}
if(require.main===module)main().catch(error=>{
 const allowed=/^(?:USE_ONE_PASSENGER_AUTH_UID_FROM_THE_PASSENGER_CONSOLE|CLOUD_SHELL_READ_UNAVAILABLE|STAGING_PROJECT_IDENTITY_MISMATCH|PASSENGER_PROFILE_LOOKUP_AMBIGUOUS|PASSENGER_PROFILE_KEY_UNSUPPORTED|CURRENT_TRIP_KEY_UNSUPPORTED|MULTIPLE_CURRENT_TRIPS_REQUIRE_REVIEW|NO_CURRENT_TRIP_FOR_PASSENGER|CURRENT_TRIP_NOT_FOUND|CURRENT_TRIP_HAS_NO_SUPPORTED_DRIVER|ONBOARD_PASSENGER_KEY_UNSUPPORTED|STAGING_DATABASE_READ_UNAVAILABLE|STAGING_DATABASE_READ_HTTP_\d{3}|STAGING_DATABASE_READ_SIZE_LIMIT|STAGING_DATABASE_RESPONSE_UNAVAILABLE)$/;
 console.error('EARLY_END_DIAGNOSIS: '+(allowed.test(error.message)?error.message:'READ_UNAVAILABLE'));
 process.exitCode=2;
});
module.exports={identityReport,diagnose,main};
