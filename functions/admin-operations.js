'use strict';

// Admin-only operations. The calling Cloud Function verifies admin identity
// before invoking this module. Cases and invitations never move money or
// create a verified Firebase Auth user.
async function handle({data, actor, admin, audit}) {
  const action=String(data?.action||'').trim();
  const db=admin.database();
  const stamp=admin.database.ServerValue.TIMESTAMP;
  const clean=(v,max=200)=>String(v==null?'':v).trim().slice(0,max);
  const safeId=v=>/^[A-Za-z0-9_-]{1,160}$/.test(String(v||''));
  const invalid=(message)=>{const e=new Error(message);e.code='invalid-argument';throw e;};
  if(action==='inviteUser'){
    const fullName=clean(data?.fullName,120);
    const phone=clean(data?.phone,32);
    const email=clean(data?.email,180).toLowerCase();
    const role=clean(data?.role,24);
    if(!['passenger','driver'].includes(role))invalid('Choose passenger or driver.');
    if(fullName.length<2 || /[<>\u0000-\u001f]/.test(fullName))invalid('Enter a valid full name.');
    if(!/^\+?[0-9 ]{9,19}$/.test(phone))invalid('Enter a South African mobile number.');
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid('Invalid email.');
    const ref=db.ref('adminInvitations').push();
    await ref.set({fullName,phone,email,role,status:'invited',
      note:'Registration invitation only. User must verify own phone using Firebase SMS OTP.',
      invitedBy:actor.uid,createdAt:stamp});
    await audit(actor,'registration_invited',ref.key,{role});
    return {ok:true,id:ref.key,status:'invited',registrationPath:role==='driver'?'/driver-v2/login.html':'/passenger-v2/login.html'};
  }
  if(action==='createRefundCase'){
    const bookingId=clean(data?.bookingId,160);
    const passengerId=clean(data?.passengerId,160);
    const providerReference=clean(data?.providerReference,180);
    const reason=clean(data?.reason,600);
    const amount=Number(data?.amount);
    if(!reason || !Number.isFinite(amount)|| amount<=0||amount>100000)invalid('Enter a positive refund amount and reason.');
    if(!bookingId && !providerReference)invalid('Enter the trip ID or gateway payment reference.');
    if(bookingId && !safeId(bookingId))invalid('Invalid booking ID.');
    if(passengerId && !safeId(passengerId))invalid('Invalid passenger ID.');
    if(bookingId){
      const booking=(await db.ref('requests/'+bookingId).once('value')).val();
      if(!booking)invalid('The booking does not exist; use a gateway reference for standalone payments.');
    }
    const ref=db.ref('refundCases').push();
    await ref.set({bookingId,passengerId,providerReference,amount:Math.round(amount*100)/100,
      reason,status:'open',createdBy:actor.uid,createdAt:stamp,updatedAt:stamp,
      disbursed:false,note:'Case record only; gateway refund has NOT been issued.'});
    await audit(actor,'refund_case_created',ref.key,{bookingId,amount});
    return {ok:true,id:ref.key,status:'open',disbursed:false};
  }
  if(action==='updateRefundCase'){
    const id=clean(data?.id,160);
    const status=clean(data?.status,32);
    const note=clean(data?.note,700);
    if(!safeId(id) || !['open','under_review','awaiting_gateway','resolved','rejected'].includes(status))
      invalid('Invalid refund case or status.');
    if(!note)invalid('An audit note is required.');
    const ref=db.ref('refundCases/'+id);
    const current=(await ref.once('value')).val();
    if(!current)invalid('Refund case was not found.');
    await ref.update({status,adminNote:note,updatedAt:stamp,reviewedBy:actor.uid,
      // No backend gateway transfer or disbursement is performed here.
      disbursed:false});
    await audit(actor,'refund_case_updated',id,{status});
    return {ok:true,id,status,disbursed:false};
  }
  invalid('Unsupported admin operation.');
}
module.exports={handle};
