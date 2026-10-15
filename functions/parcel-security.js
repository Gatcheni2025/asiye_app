"use strict";
const crypto = require("node:crypto");
const TERMINAL = new Set(["completed","cancelled_by_commuter","cancelled_by_driver","cancelled_by_admin","rejected"]);
function fail(message,status=409){const e=new Error(message);e.status=status;throw e;}
function validId(id){return /^[A-Za-z0-9_-]{16,128}$/.test(String(id||""));}
function coordinate(value,limit){const n=Number(value);return value!=="" && value!=null && Number.isFinite(n) && Math.abs(n)<=limit?n:null;}
function text(value,max=140){return String(value||"").trim().slice(0,max);}
function distanceKm(a,b,c,d){
  const rad=n=>n*Math.PI/180, dy=rad(c-a),dx=rad(d-b);
  const h=Math.sin(dy/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dx/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function createParcelRecord(body,passenger,id,now){
  if(!validId(id))fail("Invalid parcel reference.",400);
  const pick=body.pickup||{},dest=body.destination||{};
  const pLat=coordinate(pick.latitude,90),pLng=coordinate(pick.longitude,180),
    dLat=coordinate(dest.latitude,90),dLng=coordinate(dest.longitude,180);
  if([pLat,pLng,dLat,dLng].some(n=>n===null))fail("Valid pickup and destination are required.",400);
  const directDistance=distanceKm(pLat,pLng,dLat,dLng);
  if(directDistance<0.2 || directDistance>200)fail("Parcel distance is outside the supported range.",400);
  const routeDistance=Number(body.routeDistanceKm);
  const routeTime=Number(body.routeDurationMinutes);
  if(!Number.isFinite(routeDistance)||routeDistance<directDistance*0.95||routeDistance>directDistance*5+20||
     !Number.isFinite(routeTime)||routeTime<0||routeTime>600)fail("Invalid parcel route estimate.",400);
  const method=String(body.paymentMethod||"cash").toLowerCase();
  if(!["cash","card"].includes(method))fail("Only Cash or Card can be used.",400);
  if(!text(body.recipientName,100)||!/^\+?[0-9 ()-]{7,25}$/.test(text(body.recipientPhone,30))||
     !text(body.parcelDescription,300))fail("Valid parcel and recipient details are required.",400);
  // The accepted total is computed by the backend, not the passenger WebView.
  const fare=Math.round(Math.max(30,12+routeDistance*8.25+routeTime*0.9+5)*0.90*100)/100;
  return {
    requestId:id,type:"delivery",rideType:"delivery",carCategory:"go",parcelSecurityVersion:2,
    commuterId:passenger.id,commuterName:text(passenger.name,120)||"Passenger",
    commuterPhone:text(passenger.phone,30),commuterProfileImageUrl:text(passenger.profileImageUrl,500),
    recipientName:text(body.recipientName,100),recipientPhone:text(body.recipientPhone,30),
    parcelDescription:text(body.parcelDescription,300),parcelSize:text(body.parcelSize||"small",20),
    fragile:body.fragile===true,pickupAddress:text(pick.address,300),
    commuterLocation:{latitude:pLat,longitude:pLng},
    destination:text(dest.address,300),destinationName:text(dest.name||dest.address,300),
    destinationCoords:{latitude:dLat,longitude:dLng},
    routeDistanceKm:routeDistance,routeDurationMinutes:routeTime,
    calculatedPrice:fare,finalAmount:fare,paymentMethod:method,
    paymentStatus:method==="card"?"awaiting_driver":"cash_due",
    paymentsReady:method==="cash",status:"pending",
    requirePin:true,pickupPin:null,pinVerifiedAt:null,pinAttempts:0,
    safetyShareRequired:false,safetyShareCompleted:false,commissionRate:0.20,
    taxiId:null,driverAuthUid:null,createdAt:now
  };
}
function paymentReady(trip,ledger){
  if(!["cash","card"].includes(trip.paymentMethod))return false;
  if(trip.paymentMethod==="cash")return !!ledger&&ledger.method==="cash"&&ledger.status==="cash_due";
  return !!ledger && ledger.method==="card" && ["held","captured"].includes(ledger.status) &&
    ledger.splitDriverId===trip.taxiId && ledger.splitMode==="paystack_subaccount_80_20" &&
    Number(ledger.amount)===Number(trip.finalAmount);
}
function action(trip,name,pin,secret,evidence,now){
  if(!trip||trip.type!=="delivery"||trip.parcelSecurityVersion!==2)fail("Secure parcel booking required.",409);
  if(TERMINAL.has(trip.status))fail("Parcel is no longer active.");
  if(!trip.taxiId||!evidence.driverReserved)fail("Driver reservation expired.",403);
  if(!paymentReady(trip,evidence.ledger))fail("Confirmed payment is required before collection.");
  if(name==="onWay"){
    if(trip.status==="driver_on_way"||["arrived","in_transit"].includes(trip.status))return trip;
    if(trip.status!=="accepted")fail("Parcel is not ready for pickup.");
    return {...trip,status:"driver_on_way",driverOnWayAt:now};
  }
  if(name==="arrive"){
    if(trip.status==="arrived")return trip;
    if(trip.status!=="driver_on_way")fail("Start collection navigation before arrival.");
    if(!evidence.nearPickup)fail("Fresh driver GPS location at pickup is required.",403);
    return {...trip,status:"arrived",arrivedAt:now};
  }
  if(name==="verifyPin"){
    if(trip.status==="in_transit"&&trip.pinVerifiedAt)return trip;
    if(trip.status!=="arrived"||!trip.arrivedAt)fail("Driver must arrive before PIN verification.");
    if(!evidence.nearPickup)fail("Return to the pickup location before verifying the PIN.",403);
    if((trip.pinAttempts||0)>=5)fail("PIN locked after five failed attempts. Contact support.",429);
    const attempts=Number(trip.pinAttempts||0)+1;
    const input=String(pin||"");
    if(!/^\d{4}$/.test(input)||!/^\d{4}$/.test(String(secret||""))||
       !crypto.timingSafeEqual(Buffer.from(input.padEnd(4,"x").slice(0,4)),Buffer.from(String(secret).padEnd(4,"x").slice(0,4))))
      return {...trip,pinAttempts:attempts};
    return {...trip,pinAttempts:attempts,status:"in_transit",pinVerifiedAt:now,
      passengerOnboardAt:now,tripStartedAt:now};
  }
  fail("Unsupported Parcel action.",400);
}
module.exports={createParcelRecord,action,paymentReady,distanceKm,validId,fail};
