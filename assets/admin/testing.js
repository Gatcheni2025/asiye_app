/* Only the staging-only callable may read or change test trips. */
(() => {
 'use strict';
 const config={apiKey:'AIzaSyCX_euO2EEPhfhuG5DTsSi5vCpZ9MFZczY',authDomain:'asiye-80386.firebaseapp.com',
  databaseURL:'https://asiye-80386-default-rtdb.firebaseio.com',projectId:'asiye-80386',
  storageBucket:'asiye-80386.firebasestorage.app',appId:'1:531902350858:web:f8a4a246bf350d50e3c1f3'};
 const $=id=>document.getElementById(id);
 const notice=(message,error=false)=>{ $('testNotice').textContent=message; $('testNotice').classList.toggle('error',error); };
 if(config.projectId!=='asiye-paystack-staging'){
  $('testLogin').hidden=true;notice('Test-trip controls are available only on the isolated staging website.',true);return;
 }
 const client=window.AsiyeAdminAuth.create(firebase,config),{auth,callable}=client;
 const api=async data=>(await callable('adminStagingTestConsole')(data)).data;
 let trips=[],selected=null,epoch=0;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 async function authorize(user){
  const generation=++epoch;
  $('testWorkspace').hidden=true;$('testLogin').hidden=false;$('testDetails').hidden=true;
  selected=null;trips=[];$('testTrips').replaceChildren();
  $('testIdentity').textContent=user?user.email+' · '+user.uid:'';$('testCheckAccess').hidden=!user;
  if(!user)return;
  try{
   await user.getIdToken(true);const session=await api({action:'session'});
   if(generation!==epoch||auth.currentUser?.uid!==user.uid)return;
   if(!session.ok||session.uid!==user.uid||session.projectId!==config.projectId||session.paystackDomain!=='test')throw Error('The test administrator session could not be verified.');
   $('testLogin').hidden=true;$('testWorkspace').hidden=false;notice('Staging TEST access verified.');await refresh();
  }catch(error){if(generation===epoch)notice(error.message||'Staging trip-test access has not been assigned.',true);}
 }
 async function refresh(){
  const generation=epoch;$('testRefresh').disabled=true;
  try{
   const result=await api({action:'list'});if(generation!==epoch)return;
   trips=result.trips||[];$('testTrips').replaceChildren();
   if(!trips.length)$('testTrips').append(node('p','No active test trips. Start a booking in the staging apps.'));
   for(const trip of trips){
    const card=node('article',undefined,'trip');card.append(node('span',trip.type.toUpperCase()+' · '+trip.status.replaceAll('_',' '),'pill'));
    card.append(node('h3','R'+Number(trip.fare).toFixed(2)+' · '+trip.paymentMethod.toUpperCase()));
    card.append(node('p',trip.driver?.name||'Waiting for driver'));card.append(node('p',trip.id));
    const button=node('button','Review test trip');button.type='button';button.onclick=()=>select(trip);card.append(button);$('testTrips').append(card);
   }
   if(selected){const current=trips.find(trip=>trip.id===selected.id);if(current)select(current);else{$('testDetails').hidden=true;selected=null;}}
  }catch(error){notice(error.message||'Could not load test trips.',true);}finally{$('testRefresh').disabled=false;}
 }
 function select(trip){
  const same=selected?.id===trip.id;selected=trip;$('testDetails').hidden=false;
  $('testTripTitle').textContent=trip.id;$('testTripSummary').textContent=trip.status.replaceAll('_',' ')+' · '+trip.paymentMethod.toUpperCase()+' · '+trip.paymentStatus;
  $('testDriverStatus').textContent=trip.driver?trip.driver.name+' · '+trip.driver.payoutStatus.replaceAll('_',' ')+(trip.driver.subaccountCode?' · '+trip.driver.subaccountCode:''):'A driver must be assigned first.';
  $('testLinkForm').hidden=!trip.driver;$('testLinkButton').disabled=!trip.driver?.approved;
  if(!same){$('testCancelReason').value='';$('testCancelConfirm').value='';$('testSubaccount').value=trip.driver?.subaccountCode||'';}
 }
 $('testLinkForm').onsubmit=async event=>{
  event.preventDefault();if(!selected?.driver)return;const trip=selected;$('testLinkButton').disabled=true;
  try{
   await api({action:'linkTestSubaccount',driverId:trip.driver.id,subaccountCode:$('testSubaccount').value.trim()});
   notice('Verified TEST subaccount linked. On the passenger app, tap Try card payment again.');await refresh();
  }catch(error){notice(error.message||'The TEST subaccount could not be linked.',true);}finally{$('testLinkButton').disabled=false;}
 };
 $('testCancelForm').onsubmit=async event=>{
  event.preventDefault();if(!selected)return;const trip=selected;
  if($('testCancelConfirm').value.trim()!==trip.id){notice('Type the exact selected trip ID to confirm cancellation.',true);return;}
  $('testCancelButton').disabled=true;
  try{
   const result=await api({action:'cancelTrip',requestId:trip.id,expectedStatus:trip.status,confirmation:$('testCancelConfirm').value.trim(),reason:$('testCancelReason').value.trim()});
   notice('Test trip cancelled. Matching booking locks released.'+(result.needsPaymentReview?' Check the Paystack TEST payment/refund separately.':''));
   selected=null;$('testDetails').hidden=true;await refresh();
  }catch(error){notice(error.message||'The test trip could not be cancelled. Refresh and retry.',true);}finally{$('testCancelButton').disabled=false;}
 };
 for(const provider of ['Google','Apple'])$('test'+provider).onclick=async()=>{
  try{await client.signIn(provider.toLowerCase());}catch(error){notice(client.errorMessage(error),true);}
 };
 $('testCheckAccess').onclick=()=>authorize(auth.currentUser);$('testRefresh').onclick=refresh;$('testLogout').onclick=()=>auth.signOut();
 client.ready.then(()=>auth.onAuthStateChanged(authorize)).catch(error=>notice(client.errorMessage(error),true));
})();
