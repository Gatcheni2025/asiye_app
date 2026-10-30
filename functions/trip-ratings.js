'use strict';

function fail(message,status=409){const error=Error(message);error.status=status;throw error;}
function record(trip){
 if(!trip.tripRatings)return {version:1,driverToPassenger:{}};
 let value=trip.tripRatings;
 try{if(typeof value==='string')value=JSON.parse(value);}catch(_){fail('Saved ratings could not be read. Contact support.');}
 if(value?.version!==1||!value.driverToPassenger||typeof value.driverToPassenger!=='object'||Array.isArray(value.driverToPassenger))
  fail('Saved ratings could not be read. Contact support.');
 return value;
}
function eligible(trip,passengerId){
 if(!trip||trip.status!=='completed')fail('You can rate a passenger after the trip is completed.');
 if(trip.type==='delivery'||trip.parcelSecurityVersion===2)fail('Passenger ratings are not available for a delivery.');
 if(trip.type==='club'){
  const passenger=trip.passengers?.[passengerId];
  if(!passenger||passenger.status!=='completed')
   fail('Choose a passenger who completed this trip.',403);
 }else if(trip.commuterId!==passengerId)fail('Choose the passenger from this completed trip.',403);
}
async function handle({db,id,uid,body,ownsProfile,transact}){
 const {passengerId,score}=body;
 if(typeof passengerId!=='string'||!(/^[A-Za-z0-9_-]{1,160}$/).test(passengerId))fail('Choose a passenger.',400);
 if(typeof score!=='number'||!Number.isInteger(score)||score<1||score>5)fail('Choose a rating from 1 to 5 stars.',400);
 const ref=db.ref('requests/'+id),trip=(await ref.once('value')).val();
 eligible(trip,passengerId);
 if(!trip.taxiId||(trip.driverAuthUid&&trip.driverAuthUid!==uid)||!await ownsProfile('taxis',trip.taxiId,uid))
  fail('Only the driver assigned to this completed trip can rate its passenger.',403);
 const passenger=(await db.ref('commuters/'+passengerId).once('value')).val()||{};
 if(passengerId===uid||passenger.authUid===uid||passenger.userUid===uid||trip.passengers?.[passengerId]?.authUid===uid)
  fail('You cannot rate your own passenger account.',403);
 const submittedAt=Date.now();
 const tx=await transact(ref,current=>{
  eligible(current,passengerId);
  if(current.taxiId!==trip.taxiId||current.driverAuthUid!==trip.driverAuthUid||
   (current.type==='club'&&current.passengers[passengerId].authUid!==trip.passengers[passengerId].authUid))
   fail('This trip changed. Refresh before rating.');
  const ratings=record(current),previous=ratings.driverToPassenger[passengerId];
  if(previous){
   if(previous.score===score&&previous.driverUid===uid)return current;
   fail('Your rating for this passenger was already saved.');
  }
  return {...current,tripRatings:JSON.stringify({...ratings,driverToPassenger:{...ratings.driverToPassenger,
   [passengerId]:{score,driverUid:uid,submittedAt}}})};
 });
 if(!tx.committed)fail('The trip changed. Refresh and try again.');
 return {ok:true,ratings:record(tx.snapshot.val())};
}
module.exports={record,eligible,handle};
