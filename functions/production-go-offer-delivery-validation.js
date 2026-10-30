'use strict';

// Only temporary accounts and bookings at isolated ocean coordinates are used.
// This exercises real authentication, database rules and deployed Go endpoints.
// It never prepares a payment, contacts Paystack or finishes a paid trip.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');

if (process.env.ASIYE_GO_VALIDATION_CONFIRMED !== 'yes')
  throw Error('Explicit isolated Go validation gate is required.');
const projectId = 'asiye-80386';
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const functionsURL = `https://us-central1-${projectId}.cloudfunctions.net`;
const source = fs.readFileSync(path.join(__dirname,'../assets/passenger-v2/js/firebase.js'),'utf8');
const apiKey = source.match(/apiKey:\s*[\r\n\s]*["']([^"']+)["']/)?.[1];
assert.ok(apiKey,'Firebase Web API key is required.');
const app = admin.initializeApp({projectId,databaseURL},'isolated-go-offer-validation');
const db = app.database(), auth = app.auth();
const prefix = `e2e_go65_${Date.now().toString(36)}_${require('node:crypto').randomBytes(4).toString('hex')}`;
const passengerId = prefix+'_p', driverId = prefix+'_d';
const requestIds = [], users = [];
const pickup = {latitude:-45,longitude:0};
const destination = {latitude:-44.95,longitude:0.05};
let checks = 0;
const pass = label => {checks++;console.log('PASS [Go offer delivery] '+label);};
const read = async p => (await db.ref(p).once('value')).val();

async function tokenFor(uid) {
  await auth.createUser({uid,displayName:'Isolated Go offer test'});
  users.push(uid);
  const token = await auth.createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true}),
    signal:AbortSignal.timeout(30000)
  });
  const data = await response.json();
  assert.ok(response.ok && data.idToken,'Temporary test sign-in failed: HTTP '+response.status);
  return data.idToken;
}

async function rest(p, method, token, body) {
  const response = await fetch(`${databaseURL}/${p}.json?auth=${encodeURIComponent(token)}`,{
    method,headers:{'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)
  });
  const data = await response.json();
  assert.ok(response.ok,`Authenticated database ${method} failed: HTTP ${response.status}`);
  return data;
}

async function call(name, token, body, expectedStatus=200) {
  const response = await fetch(`${functionsURL}/${name}`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(90000)
  });
  const data = await response.json().catch(()=>({}));
  assert.equal(response.status,expectedStatus,`${name}: ${data.error || 'unexpected HTTP status'}`);
  return data;
}

async function createOffer(label, method, passengerToken) {
  const requestId = prefix+'_'+label;
  requestIds.push(requestId);
  await rest(`requests/${requestId}`,'PUT',passengerToken,{
    requestId,type:'ehailing',rideType:'go',carCategory:'go',commuterId:passengerId,
    commuterName:'Isolated Go passenger',status:'pending',pickupAddress:'Isolated test pickup',
    destination:'Isolated test destination',destinationCoords:destination,commuterLocation:pickup,
    routeDistanceKm:10,routeDurationMinutes:0,passengerOffer:65,finalAmount:65,calculatedPrice:65,
    negotiationEnabled:true,fareStatus:'passenger_offer',negotiationRound:1,
    paymentMethod:method,paymentStatus:'negotiation_pending',paymentsReady:false,
    requirePin:true,safetyShareRequired:false,createdAt:Date.now()
  });
  return requestId;
}

async function clearCase(requestId) {
  assert.ok(requestIds.includes(requestId));
  await db.ref().update({
    [`requests/${requestId}`]:null,[`goFareAgreements/${requestId}`]:null,
    [`tripPayments/${requestId}`]:null,[`notifications/taxis/${driverId}/${requestId}`]:null,
    [`commuters/${passengerId}/currentRequest`]:null,[`taxis/${driverId}/currentRequest`]:null,
    [`taxis/${driverId}/isFull`]:false
  });
}

async function main() {
  // Refuse to send even a test notification to an unrelated nearby driver.
  const taxis = await db.ref('taxis').once('value');
  taxis.forEach(snapshot => {
    const taxi = snapshot.val() || {};
    assert.ok(!(Math.abs(Number(taxi.latitude)-pickup.latitude)<0.3 &&
      Math.abs(Number(taxi.longitude)-pickup.longitude)<0.3),
      'The isolated test area contains another driver; choose an empty area.');
  });
  const passengerToken = await tokenFor(passengerId);
  const driverToken = await tokenFor(driverId);
  await db.ref().update({
    [`commuters/${passengerId}`]:{authUid:passengerId,name:'Isolated Go passenger',phone:'+27000000991',verificationStatus:'verified'},
    [`taxis/${driverId}`]:{authUid:driverId,userUid:driverId,name:'Isolated Go driver',phone:'+27000000992',
      verificationStatus:'verified',enrollmentVersion:2,vehicleApproved:true,vehicleApprovalStatus:'approved',
      isOnline:true,isBroadcasting:true,isFull:false,vehicleType:'ehailing',vehicleMake:'Toyota',
      vehicleModel:'Corolla',vehicleColor:'White',vehicleYear:2025,vehicleSeats:4,seats:4,
      taxiRegistrationNumber:'GO65-E2E',vehicleReg:'GO65-E2E',
      profileImageUrl:'https://example.invalid/go65-profile.jpg',vehiclePhoto:'https://example.invalid/go65-car.jpg',
      latitude:pickup.latitude,longitude:pickup.longitude,lastSeen:Date.now()}
  });
  pass('Created isolated temporary passenger and approved online driver');

  let id = await createOffer('accept','cash',passengerToken);
  for (const amount of [1,64,96]) await call('submitGoFareOffer',passengerToken,{requestId:id,amount},422);
  assert.equal(await read(`notifications/taxis/${driverId}/${id}`),null);
  pass('Below 65% and above 95% stay outside the offer range');
  let submitted = await call('submitGoFareOffer',passengerToken,{requestId:id,amount:65});
  assert.equal(submitted.pricing.minimumFareOffer,65);assert.equal(submitted.pricing.suggestedFare,90);
  assert.equal(submitted.dispatch.mode,'broadcast');
  let notification = await rest(`notifications/taxis/${driverId}/${id}`,'GET',driverToken);
  assert.equal(notification.fare,65);assert.equal(notification.passengerOffer,65);
  let visible = await rest(`requests/${id}`,'GET',driverToken);
  assert.equal(visible.passengerOffer,65);assert.equal(visible.fareStatus,'passenger_offer');
  pass('Submission delivers R65 directly and driver can read it through deployed rules');
  await call('acceptGoFareOffer',driverToken,{requestId:id,amount:65,negotiationRound:submitted.pricing.negotiationRound});
  let agreement = await read(`goFareAgreements/${id}`);
  assert.equal(agreement.agreedFare,65);assert.equal(agreement.driverNetFare,52);assert.equal(agreement.platformCommission,13);
  pass('Driver explicitly accepts R65 with an 80/20 agreement');
  await clearCase(id);

  id = await createOffer('counter','card',passengerToken);
  submitted = await call('submitGoFareOffer',passengerToken,{requestId:id,amount:65});
  await call('counterGoFare',driverToken,{requestId:id,amount:80,passengerOffer:65,negotiationRound:submitted.pricing.negotiationRound});
  visible = await rest(`requests/${id}`,'GET',passengerToken);
  assert.equal(visible.fareStatus,'driver_counter');assert.equal(visible.driverCounterFare,80);
  pass('Passenger immediately reads the driver R80 counter');
  await call('acceptGoFareCounter',passengerToken,{requestId:id,amount:80,negotiationRound:visible.negotiationRound});
  agreement = await read(`goFareAgreements/${id}`);
  assert.equal(agreement.agreedFare,80);assert.equal(agreement.driverNetFare,64);assert.equal(agreement.platformCommission,16);
  assert.equal(await read(`tripPayments/${id}`),null,'Negotiation must not initiate Card payment.');
  pass('Passenger explicitly accepts R80; no Card payment is initialized');
  await clearCase(id);

  id = await createOffer('decline','cash',passengerToken);
  submitted = await call('submitGoFareOffer',passengerToken,{requestId:id,amount:65});
  await call('declineGoFareOffer',driverToken,{requestId:id,amount:65,negotiationRound:submitted.pricing.negotiationRound});
  visible = await rest(`requests/${id}`,'GET',passengerToken);
  assert.equal(visible.lastGoFareDecision.action,'declined');assert.equal(visible.fareStatus,'passenger_offer');
  await call('submitGoFareOffer',passengerToken,{requestId:id,amount:65});
  assert.equal(await read(`notifications/taxis/${driverId}/${id}`),null,'Duplicate offer must preserve the driver decline.');
  await call('submitGoFareOffer',passengerToken,{requestId:id,amount:75});
  notification = await rest(`notifications/taxis/${driverId}/${id}`,'GET',driverToken);
  assert.equal(notification.fare,75);
  pass('Only the driver declines; a changed R75 offer reaches the driver again');
  await clearCase(id);
  console.log(`GO OFFER DELIVERY PRODUCTION CHECK: PASS (${checks} checks)`);
}

async function cleanup() {
  const updates = {};
  for (const id of requestIds) for (const node of ['requests','goFareAgreements','tripPayments','tripShareIssuers','tripChats'])
    updates[`${node}/${id}`]=null;
  for (const p of [`commuters/${passengerId}`,`taxis/${driverId}`,
    `notifications/commuters/${passengerId}`,`notifications/taxis/${driverId}`]) updates[p]=null;
  await db.ref().update(updates);
  for (const uid of users) await auth.deleteUser(uid).catch(error=>{
    if(error.code!=='auth/user-not-found')throw error;
  });
  console.log('Isolated Go test accounts and bookings removed.');
}

main().catch(error=>{console.error('GO OFFER DELIVERY PRODUCTION CHECK: FAIL',error.message);process.exitCode=1;})
  .finally(async()=>{
    try {await cleanup();}catch(error){console.error('Temporary Go cleanup failed:',error.message);process.exitCode=1;}
    await app.delete();
  });
