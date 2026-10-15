'use strict';
// Test-mode ONLY. This script cannot accept a live Paystack key.
const mode=String(process.argv[2]||'');
const secret=String(process.env.PAYSTACK_TEST_SECRET_KEY||'').trim();
const subaccount=String(process.env.PAYSTACK_TEST_DRIVER_SUBACCOUNT||'').trim();
if(!/^sk_test_[A-Za-z0-9]+$/.test(secret))throw Error('PAYSTACK_TEST_SECRET_KEY must be a Paystack TEST secret (sk_test_). Never use live keys.');
if(!/^ACCT_[A-Za-z0-9]+$/.test(subaccount))throw Error('A valid TEST subaccount code is required.');
if(!['initialize','verify'].includes(mode))throw Error('Mode must be initialize or verify.');
async function api(route,options={}){
 const response=await fetch('https://api.paystack.co'+route,{
  ...options,headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'}
 });
 const payload=await response.json().catch(()=>({}));
 if(!response.ok||payload.status!==true)throw Error('Paystack TEST API: '+(payload.message||response.status));
 return payload.data||{};
}
async function main(){
 const account=await api('/subaccount/'+encodeURIComponent(subaccount));
 if(account.subaccount_code!==subaccount || Number(account.percentage_charge)!==20 ||
    account.active===false || account.domain!=='test')
  throw Error('Driver TEST subaccount must be active, test-mode and have 20% Asiye commission.');
 console.log('PASS Test-mode driver subaccount exists, active, 20% Asiye / 80% driver.');
 // is_verified can be false in test mode; never override the production verification gate.
 if(mode==='initialize'){
  const reference='ASIYE_TEST_'+Date.now().toString(36).toUpperCase();
  const transaction=await api('/transaction/initialize',{
   method:'POST',
   body:JSON.stringify({
    email:'paystack-sandbox@asiye.cloud',amount:'10000',currency:'ZAR',
    reference,subaccount,bearer:'account',channels:['card'],
    metadata:{purpose:'asiye_test_only_no_production_fulfillment'}
   })
  });
  if(transaction.reference!==reference||
     !String(transaction.authorization_url||'').startsWith('https://checkout.paystack.com/'))
   throw Error('Invalid TEST checkout initialization.');
  console.log('PAYSTACK TEST checkout URL:',transaction.authorization_url);
  console.log('PAYSTACK TEST reference:',reference);
  console.log('Next: complete ONLY with Paystack TEST card, then rerun mode=verify with the reference.');
 }else{
  const reference=String(process.env.PAYSTACK_TEST_PAID_REFERENCE||'').trim();
  if(!/^ASIYE_TEST_[A-Z0-9]+$/.test(reference))throw Error('Enter the test reference from initialize run.');
  const transaction=await api('/transaction/verify/'+encodeURIComponent(reference));
  const code=typeof transaction.subaccount==='string'?transaction.subaccount:
    String(transaction.subaccount?.subaccount_code||'');
  if(transaction.status!=='success'||transaction.currency!=='ZAR'||
     Number(transaction.amount)!==10000||transaction.reference!==reference||
     code!==subaccount)
    throw Error('TEST transaction amount, currency, subaccount or status does not match.');
  console.log('PASS TEST card authorization verified against Paystack.');
  console.log('PASS TEST funds associated with the correct 80/20 subaccount.');
  console.log('Test transaction:',transaction.id,'Reference:',reference);
  console.log('NOTE: This does not prove T+2 bank settlement, mobile deep link return or Firebase webhook.');
 }
}
main().catch(e=>{console.error('PAYSTACK TEST MODE CHECK FAILED:',e.message);process.exitCode=1;});
