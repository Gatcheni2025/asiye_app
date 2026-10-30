'use strict';
// Reviewer scope: driver enrollment session and document list only.
function makeEnrollmentConsole({admin,requireReviewer,HttpsError}){
 return async(data,context)=>{
  const actor=await requireReviewer(context);
  if(data?.action==='session')return {ok:true,uid:actor.uid,email:actor.email||'',scope:'enrollments'};
  if(data?.action!=='list'||data.resource&&data.resource!=='driverEnrollments')
   throw new HttpsError('invalid-argument','Only driver enrollment reviews are available here.');
  const limit=data.limit==null?500:Number(data.limit);
  if(!Number.isInteger(limit)||limit<1||limit>500)throw new HttpsError('invalid-argument','Choose a limit from 1 to 500.');
  const snapshot=await admin.database().ref('driverEnrollments').orderByChild('submittedAt').limitToLast(limit).once('value');
  return {ok:true,data:snapshot.val()||{},limit};
 };
}
module.exports={makeEnrollmentConsole};
