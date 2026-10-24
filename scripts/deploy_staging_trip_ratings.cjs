'use strict';
const FUNCTIONS=Object.freeze(require('./staging_trip_rating_functions.json'));
async function main(){
 if(FUNCTIONS.length!==1||FUNCTIONS[0]!=='goTripActionSecure')throw Error('Unexpected rating deployment scope.');
 return require('./deploy_staging_early_trip_end.cjs').deployScoped({
  functions:FUNCTIONS,sourceAudit:'scripts/audit_staging_trip_rating_source.py',
  title:'ASIYE COMPLETED TRIP RATINGS',
  success:'TRIP_RATING_DEPLOYMENT: VERIFIED. Refresh the driver app, open the completed ride in Trip history and rate its passenger.',
  testFiles:['test/trip-ratings.test.cjs','test/trip-end-safety.test.cjs','test/go-continuation.test.cjs','test/club-lifecycle.test.cjs','test/paystack-return.test.cjs']
 });
}
if(require.main===module)main().catch(error=>{console.error('TRIP_RATING: BLOCKED '+error.message);process.exitCode=1;});
module.exports={FUNCTIONS,main};
