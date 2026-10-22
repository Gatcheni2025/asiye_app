/* Approved drivers configure their own Paystack subaccount, never another UID. */
(async () => {
'use strict';
const base='https://us-central1-asiye-80386.cloudfunctions.net/configureDriverCardPayout';
const state=document.getElementById('payoutStatus'),form=document.getElementById('payoutForm');
const user=firebase.auth().currentUser || await new Promise(resolve=>{
 let off;off=firebase.auth().onAuthStateChanged(u=>{off?.();resolve(u);});
});
if(!user){location.replace('./login.html');return;}
const driverId=localStorage.getItem('driverId') || user.uid;
const send=async(action,body)=>{
 const token=await user.getIdToken(true);
 const response=await fetch(base+'?driverId='+encodeURIComponent(driverId)+(action?'&action='+encodeURIComponent(action):''),{
  method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:body?JSON.stringify({driverId,...body}):undefined});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Could not contact payout service.');
 return data;
};
async function refresh(){
 const button=document.getElementById('checkPayoutStatus');button.disabled=true;form.hidden=true;
 try{
  const info=await send('status');
  if(info.status==='verified'){
   state.textContent='Paystack subaccount verified. Bank: '+info.bankName+' (ending '+info.accountLast4+'). Return to your booking; the passenger can try card payment again.';
   return;
  }
  if(info.status&&info.status!=='not_configured'){
   state.textContent='Paystack subaccount status: '+info.status.replace(/_/g,' ')+'. Check verification again after Paystack completes review. Contact Asiye support if changes are needed.';
   return;
  }
  const banks=await send('banks');
  const list=document.getElementById('payoutBank');list.replaceChildren(new Option('Choose your bank',''));
  (banks.banks||[]).forEach(bank=>list.add(new Option(bank.name,bank.code)));
  state.textContent='Complete your bank verification before passengers pay you by card.';
  form.hidden=false;
 }catch(error){state.textContent=error.message+' Check your connection and approved driver account, then retry.';}
 finally{button.disabled=false;}
}
form.onsubmit=async event=>{
 event.preventDefault();const button=document.getElementById('verifyPayoutBank');button.disabled=true;
 state.textContent='Verifying your banking details with Paystack…';
 try{
  const saved=await send('',{bankCode:document.getElementById('payoutBank').value,
   accountName:document.getElementById('payoutName').value.trim(),accountNumber:document.getElementById('payoutNumber').value.trim(),
   accountType:document.getElementById('payoutType').value,documentType:document.getElementById('payoutDocType').value,
   documentNumber:document.getElementById('payoutDoc').value.trim()});
  state.textContent=saved.status==='verified'?'Paystack verified. Return to your booking; the passenger can try card payment again.':'Paystack review pending. Use Check verification again to refresh.';
  form.hidden=true;document.getElementById('payoutNumber').value='';document.getElementById('payoutDoc').value='';
 }catch(error){state.textContent=error.message;}finally{button.disabled=false;}
};
document.getElementById('checkPayoutStatus').onclick=refresh;
document.getElementById('logoutBank').onclick=async()=>{
 try{await window.AsiyeSession.logout();}catch(error){state.textContent='Unable to confirm you are offline. Check your connection and retry.';}
};
await refresh();
})().catch(error=>{document.getElementById('payoutStatus').textContent=error.message||'Payment setup is unavailable. Refresh to retry.';});
