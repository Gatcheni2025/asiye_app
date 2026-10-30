'use strict';
// GET-only Firebase configuration check. Never sends SMS or prints test numbers/codes.
const {spawnSync}=require('node:child_process');
const PROJECT='asiye-80386',NUMBER='531902350858',APP='1:531902350858:android:1fcdbca2f312daa6e3c1f3';
const PACKAGE='com.asiyeapp.asiye';
const EXPECTED_SHA1='3ef548f3174cedc5bf767f46a91a61a6b31f5108';
const EXPECTED_SHA256='8e72a01ad73956b4e21dc9e4f73ac044b2c3c770e367ba01deebb354b21180cf';
const normalize=v=>String(v||'').replace(/:/g,'').toLowerCase();
function smsRegion(config){
 if(config?.allowlistOnly)return (config.allowlistOnly.allowedRegions||[]).includes('ZA')?'ALLOWED':'BLOCKED';
 if(config?.allowByDefault)return (config.allowByDefault.disallowedRegions||[]).includes('ZA')?'BLOCKED':'ALLOWED';
 return 'NOT_SPECIFIED';
}
async function main(){
 const run=args=>{const r=spawnSync('gcloud',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(r.status!==0||r.error)throw Error('CLOUD_READ_UNAVAILABLE');return r.stdout.trim();};
 if(run(['config','get-value','project'])!==PROJECT||run(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)throw Error('PROJECT_MISMATCH');
 const get=async url=>{
  const r=await fetch(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+run(['auth','print-access-token'])},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('READ_HTTP_'+r.status);return r.json();
 };
 console.log('DRIVER_PHONE_CONFIGURATION: READ_ONLY | '+PROJECT);
 try{
  const c=await get('https://identitytoolkit.googleapis.com/admin/v2/projects/'+PROJECT+'/config');
  console.log('FIREBASE_PHONE_PROVIDER='+(c.signIn?.phoneNumber?.enabled===true?'ENABLED':'DISABLED'));
  console.log('SMS_REGION_ZA='+smsRegion(c.smsRegionConfig));
  console.log('CONFIGURED_TEST_NUMBER_COUNT='+Object.keys(c.signIn?.phoneNumber?.testPhoneNumbers||{}).length);
  console.log('FIREBASE_AUTH_RETURN_DOMAIN='+((c.authorizedDomains||[]).includes(PROJECT+'.firebaseapp.com')?'AUTHORIZED':'NOT_LISTED'));
 }catch(e){console.log('FIREBASE_PHONE_CONFIG='+(e.message.match(/^READ_HTTP_\d+$/)?e.message:'READ_UNAVAILABLE'));}
 try{
  const base='https://firebase.googleapis.com/v1beta1/projects/'+PROJECT+'/androidApps/'+encodeURIComponent(APP);
  const app=await get(base);if(app.appId!==APP||app.packageName!==PACKAGE)throw Error('ANDROID_APP_MISMATCH');
  const certs=(await get(base+'/sha')).certificates||[];
  console.log('ANDROID_APP_IDENTITY=MATCH');
  for(const [type,expected]of [['SHA_1',EXPECTED_SHA1],['SHA_256',EXPECTED_SHA256]]){
   console.log('FIREBASE_RELEASE_'+type+'='+(certs.some(c=>c.certType===type&&normalize(c.shaHash)===expected)?'REGISTERED':'NOT_REGISTERED'));
  }
 }catch(e){console.log('FIREBASE_ANDROID_CERTIFICATES='+(/^READ_HTTP_\d+$|^ANDROID_APP_MISMATCH$/.test(e.message)?e.message:'READ_UNAVAILABLE'));}
 console.log('NO_SMS_SENT | NO_AUTH_CONFIG_CHANGED | NO_KEYS_OR_TEST_CODES_PRINTED');
}
if(require.main===module)main().catch(e=>{console.error('DRIVER_PHONE_CONFIGURATION: '+(/^[A-Z0-9_]+$/.test(e.message)?e.message:'READ_UNAVAILABLE'));process.exitCode=2;});
module.exports={smsRegion};
