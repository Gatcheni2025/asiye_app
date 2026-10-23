'use strict';

const {randomUUID}=require('node:crypto');
const TTL=5*60*1000, RADIUS_KM=0.3;
const ACTIONS=new Set(['checkTripEnd','requestEarlyEnd','respondEarlyEnd','withdrawEarlyEnd']);
// RTDB Rules compare scalar values reliably. Persist each server-owned
// confirmation/claim as one JSON scalar so clients cannot alter nested votes
// while unrelated legitimate request updates remain possible.
function decode(trip){
 if(!trip||typeof trip!=='object'||Array.isArray(trip))return trip;
 const result={...trip};
 for(const key of ['tripEndSafety','tripCompletion'])if(typeof result[key]==='string'){
  try{result[key]=JSON.parse(result[key]);}catch(_){fail('Trip confirmation data is unavailable. Contact support.');}
 }
 return result;
}
function encode(trip){
 if(!trip||typeof trip!=='object'||Array.isArray(trip))return trip;
 const result={...trip};
 for(const key of ['tripEndSafety','tripCompletion'])if(result[key]&&typeof result[key]==='object')result[key]=JSON.stringify(result[key]);
 return result;
}
function fail(message,status=409){const error=Error(message);error.status=status;throw error;}
const active=p=>p&&!/cancelled|canceled|rejected|completed/.test(String(p.status||''));
function members(trip){
 return trip.type==='club'?Object.entries(trip.passengers||{}).filter(([,p])=>active(p)).map(([id])=>id).sort():[trip.commuterId].filter(Boolean);
}
function scope(trip){
 return JSON.stringify([trip.taxiId,trip.driverAuthUid||'',trip.tripStartedAt,
  trip.agreedFare||trip.finalAmount||null,trip.destinationCoords||trip.dropoffLocation||null,
  members(trip).map(id=>[id,trip.passengers?.[id]?.authUid||'',trip.passengers?.[id]?.price||null,
   trip.passengers?.[id]?.destinationLat??null,trip.passengers?.[id]?.destinationLng??null])]);
}
function started(trip){
 if(!trip||trip.type==='delivery'||trip.parcelSecurityVersion===2)fail('Use the delivery completion flow for a parcel.');
 if(trip.status!=='in_transit'||!trip.tripStartedAt||!members(trip).length)fail('Only a started passenger trip can be ended.');
 if(trip.type==='club'?!members(trip).every(id=>trip.passengers[id].pinVerifiedAt):!trip.pinVerifiedAt)
  fail('Verify the pickup PIN before ending the trip.');
}
function point(lat,lng){
 if(lat==null||lng==null||lat===''||lng==='')return null;
 lat=Number(lat);lng=Number(lng);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}
function distance(a,b){
 const r=Math.PI/180,x=(b.lat-a.lat)*r,y=(b.lng-a.lng)*r;
 const h=Math.sin(x/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(y/2)**2;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function destination(trip,taxi,id,now){
 const current=point(taxi?.latitude,taxi?.longitude);
 const stamp=Number(taxi?.lastSeen),fresh=stamp>0&&stamp>=now-120000&&stamp<=now+30000;
 const base=trip.destinationCoords||trip.dropoffLocation||{};
 const targets=trip.type==='club'?members(trip).map(key=>point(trip.passengers[key].destinationLat??base.latitude,
  trip.passengers[key].destinationLng??base.longitude)):
  [point(base.latitude??trip.destinationLatitude,base.longitude??trip.destinationLongitude)];
 const known=!!(current&&fresh&&taxi.currentRequest===id&&targets.length&&targets.every(Boolean));
 const km=known?Math.max(...targets.map(target=>distance(current,target))):null;
 return {locationAvailable:known,nearDestination:known&&km<=RADIUS_KM,distanceMeters:km==null?null:Math.round(km*1000)};
}
function driver(trip,taxi,uid,id){
 if(!trip.taxiId||!taxi||taxi.currentRequest!==id||(taxi.authUid||taxi.userUid||trip.taxiId)!==uid||
  (trip.driverAuthUid&&trip.driverAuthUid!==uid))fail('Only the reserved driver can end this trip.',403);
}
function approved(trip,endId,now){
 const end=trip.tripEndSafety;
 return !!(end&&end.id===endId&&end.status==='approved'&&end.expiresAt>now&&end.scope===scope(trip)&&
  end.driverId===trip.taxiId&&members(trip).every(id=>end.responses?.[id]?.accepted===true));
}
function processing(trip){
 const end=trip.tripCompletion;
 return !!(end?.version===1&&end.phase==='processing'&&end.scope===scope(trip)&&end.driverId===trip.taxiId);
}
function check(trip,taxi,id,uid,now){
 started(trip);driver(trip,taxi,uid,id);
 const location=destination(trip,taxi,id,now),end=trip.tripEndSafety;
 return {...location,requiresPassengerConfirmation:!location.nearDestination&&!processing(trip),
  approved:(approved(trip,end?.id,now)&&end.driverUid===uid)||processing(trip),endRequestId:end?.id||null,
  status:end?.expiresAt<=now?'expired':end?.status||null};
}
function action(trip,name,body,actor,location,now,newId){
 started(trip);
 if(processing(trip))fail('This trip is already being completed.');
 const end=trip.tripEndSafety;
 if(name==='requestEarlyEnd'){
  if(actor.role!=='driver')fail('Only the driver can request an early end.',403);
  if(body.warningConfirmed!==true)fail('Confirm the destination safety warning first.');
  if(location.nearDestination)fail('Destination reached. Refresh and complete the trip normally.');
  if(end?.scope===scope(trip)&&end.driverUid===actor.uid&&end.expiresAt>now&&['pending','approved'].includes(end.status))return trip;
  const needsCash=trip.type==='club'?members(trip).some(id=>trip.passengers[id].paymentMethod==='cash'):trip.paymentMethod==='cash';
  if(needsCash&&body.cashCollected!==true)fail('Confirm cash has been collected before asking to finish.');
  return {...trip,tripEndSafety:{id:newId,status:'pending',driverId:trip.taxiId,driverUid:actor.uid,
   scope:scope(trip),requestedAt:now,expiresAt:now+TTL,driverConfirmedAt:now,
   cashCollectedConfirmed:needsCash,locationAvailable:location.locationAvailable,distanceMeters:location.distanceMeters,
   requiredPassengers:members(trip),responses:{}}};
 }
 if(!end||body.endRequestId!==end.id||end.scope!==scope(trip))fail('This end-trip request changed. Refresh and review it again.');
 if(end.expiresAt<=now)fail('This end-trip request expired. Ask the driver to send a new request.');
 if(name==='withdrawEarlyEnd'){
  if(actor.role!=='driver'||actor.uid!==end.driverUid)fail('Only this driver can withdraw the request.',403);
  if(end.status==='withdrawn')return trip;
  if(end.status!=='pending')fail('This request is no longer waiting for confirmation.');
  return {...trip,tripEndSafety:{...end,status:'withdrawn',withdrawnAt:now}};
 }
 if(name==='respondEarlyEnd'){
  if(actor.role!=='passenger'||!members(trip).includes(actor.passengerId))fail('Only an onboard passenger can respond.',403);
  if(typeof body.accepted!=='boolean')fail('Choose End trip here or Keep trip active.',400);
  const previous=end.responses?.[actor.passengerId];
  if(previous){if(previous.accepted===body.accepted)return trip;fail('Your response was already recorded.');}
  if(end.status!=='pending')fail('This request is no longer waiting for confirmation.');
  const responses={...end.responses,[actor.passengerId]:{accepted:body.accepted,respondedAt:now,authUid:actor.uid}};
  const status=!body.accepted?'declined':members(trip).every(id=>responses[id]?.accepted===true)?'approved':'pending';
  return {...trip,tripEndSafety:{...end,responses,status,...(status==='approved'?{approvedAt:now}:{})}};
 }
 fail('Unknown end-trip action.',400);
}
function claim(trip,taxi,id,uid,endId,now){
 started(trip);driver(trip,taxi,uid,id);
 if(processing(trip)){
  if(trip.tripCompletion.driverUid!==uid)fail('The completing driver changed.',403);
  return trip;
 }
 const location=destination(trip,taxi,id,now);
 if(!location.nearDestination&&(!approved(trip,endId,now)||trip.tripEndSafety.driverUid!==uid))
  fail('You are not at the destination. Ask the passenger to confirm ending the trip here.');
 const early=!location.nearDestination;
 return {...trip,tripCompletion:{version:1,phase:'processing',mode:early?'agreed_early_end':'destination',
  scope:scope(trip),driverId:trip.taxiId,driverUid:uid,startedAt:now,
  endRequestId:early?endId:null,locationAvailable:location.locationAvailable,distanceMeters:location.distanceMeters}};
}
function requireClaim(trip){if(!processing(trip))fail('Confirm the destination or passenger-approved early end before completion.');}
function completed(trip,now){requireClaim(trip);return {...trip.tripCompletion,phase:'completed',completedAt:now};}

async function handle({db,id,uid,body,ownsProfile,transact}){
 const ref=db.ref('requests/'+id),trip=decode((await ref.once('value')).val());started(trip);
 const name=body.action,taxi=(await db.ref('taxis/'+trip.taxiId).once('value')).val();
 let actor={role:'driver',uid};
 if(name==='respondEarlyEnd'){
  const owned=[];for(const passengerId of members(trip))
   if(await ownsProfile('commuters',passengerId,uid)&&
    (trip.type!=='club'||trip.passengers[passengerId].authUid===uid))owned.push(passengerId);
  if(owned.length!==1)fail('Only this onboard passenger can confirm.',403);
  if(uid===(taxi?.authUid||taxi?.userUid||trip.taxiId))fail('The driver cannot confirm for the passenger.',403);
  actor={role:'passenger',uid,passengerId:owned[0]};
 }else driver(trip,taxi,uid,id);
 if(name==='checkTripEnd')return {ok:true,...check(trip,taxi,id,uid,Date.now())};
 const newId=randomUUID();
 const tx=await transact(ref,current=>{
  if(!current||scope(current)!==scope(trip))fail('This trip changed. Refresh and try again.');
  return action(current,name,body,actor,destination(current,taxi,id,Date.now()),Date.now(),newId);
 });
 if(!tx.committed)fail('The trip changed. Try again.');
 const live=decode(tx.snapshot.val()),end=live.tripEndSafety;
 const payload={type:'trip_end_confirmation',requestId:id,title:'End trip safety check',
  message:end.status==='pending'?'Your driver wants to end the trip before your destination. Open Asiye to confirm or keep the trip active.':
   end.status==='approved'?'All passengers agreed to end the trip here.':'The trip remains active.',timestamp:Date.now()};
 const updates={};
 for(const passengerId of members(live))updates[`notifications/commuters/${passengerId}/trip-end-${end.id}`]=payload;
 updates[`notifications/taxis/${live.taxiId}/trip-end-${end.id}`]=payload;
 await db.ref().update(updates);
 return {ok:true,status:live.status,endRequestId:end.id,endStatus:end.status};
}
module.exports={ACTIONS,TTL,decode,encode,members,scope,started,destination,approved,processing,check,action,claim,requireClaim,completed,handle};
