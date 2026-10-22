'use strict';
// Human Cloud Shell only. Assigns driver-approval scope to one verified account.
const {spawnSync}=require('node:child_process');
const PROJECT='asiye-paystack-staging',NUMBER='1000800408896';
function run(args){
 const p=spawnSync('gcloud',args,{encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 if(p.status!==0||p.error)throw Error('Google Cloud authorization check failed.');
 return p.stdout.trim();
}
function reviewerClaims(user,email){
 if(!user?.localId||String(user.email||'').toLowerCase()!==email.toLowerCase()||user.emailVerified!==true||user.disabled||user.disableUser)
  throw Error('Use an existing, verified, enabled Firebase account with the exact selected email. Sign in to Asiye Admin first.');
 const current=JSON.parse(user.customAttributes||'{}');
 if(!current||typeof current!=='object'||Array.isArray(current))throw Error('Invalid existing account claims.');
 const claims={...current,enrollmentReviewer:true};
 if(Buffer.byteLength(JSON.stringify(claims))>1000)throw Error('The account claims exceed the Firebase size limit.');
 return claims;
}
async function main(){
 const args=process.argv.slice(2);
 if(!(args.length===1&&args[0]==='--self')&&!(args.length===2&&args[0]==='--email'))
  throw Error('Usage: node scripts/grant_staging_driver_reviewer.cjs --self (or --email exact-address)');
 if(run(['config','get-value','project'])!==PROJECT||run(['projects','describe',PROJECT,'--format=value(projectNumber)'])!==NUMBER)
  throw Error('Select the isolated Asiye staging project first.');
 const actor=run(['config','get-value','account']);
 if(!actor.includes('@')||actor.endsWith('gserviceaccount.com'))throw Error('Use the human staging administrator in Cloud Shell.');
 const email=args[0]==='--self'?actor:String(args[1]||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter the exact reviewer email.');
 const token=run(['auth','print-access-token']);
 async function api(action,body){
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:${action}`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Goog-User-Project':PROJECT},
   body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Staging Firebase Auth '+action+' blocked (HTTP '+response.status+'). No raw authentication response is printed.');
  return response.json();
 }
 const found=await api('lookup',{email:[email]});
 if(found.users?.length!==1)throw Error('Sign in to https://'+PROJECT+'.web.app/admin/ with '+email+' once, then rerun this command.');
 const user=found.users[0];reviewerClaims(user,email);
 if(JSON.parse(user.customAttributes||'{}').enrollmentReviewer!==true){
  // Re-read to preserve any claims changed since lookup.
  const latest=(await api('lookup',{localId:[user.localId]})).users?.[0];
  const updated=reviewerClaims(latest,email);
  await api('update',{localId:user.localId,customAttributes:JSON.stringify(updated)});
 }
 const saved=(await api('lookup',{localId:[user.localId]})).users?.[0];
 if(!saved||JSON.parse(saved.customAttributes||'{}').enrollmentReviewer!==true)throw Error('Reviewer access could not be confirmed.');
 console.log('STAGING_DRIVER_REVIEWER: READY | '+email);
 console.log('Scope: driver applications and approval only. Existing account claims are preserved.');
 console.log('Return to Asiye Admin and click Check access again to refresh your session.');
}
if(require.main===module)main().catch(error=>{console.error('BLOCKED: '+error.message);process.exitCode=1;});
module.exports={reviewerClaims};
