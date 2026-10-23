'use strict';
const tripEndSafety = require('./trip-end-safety');

const terminal = status => {
  const value = String(status || '').trim().toLowerCase();
  return ['completed', 'expired', 'rejected'].includes(value) || /^cancelled(?:_|$)|^canceled(?:_|$)/.test(value);
};
// Firebase may invoke a transaction with null before loading the server value.
// Return null to let it synchronize; abort only for a different booking.
const clearRequestPointer = (current, expected) =>
  current == null || current === '' || String(current) === String(expected) ? null : undefined;
const arrived = trip => Boolean(trip?.arrivedAt || trip?.tripStartedAt || ['arrived', 'passenger_onboard', 'all_onboard', 'in_transit', 'completed'].includes(trip?.status));
const money = value => Math.round(Number(value) * 100);
function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }

function paymentReady(trip, agreement, payment) {
  if (!trip || !agreement || !payment || trip.fareStatus !== 'agreed' ||
      !trip.taxiId || agreement.driverId !== trip.taxiId ||
      money(agreement.agreedFare) <= 0 || !Number.isFinite(money(agreement.agreedFare)) ||
      money(trip.agreedFare) !== money(agreement.agreedFare) ||
      money(trip.finalAmount) !== money(agreement.agreedFare) ||
      money(payment.amount) !== money(agreement.agreedFare) ||
      Number(agreement.commissionRate) !== 0.20 ||
      agreement.paymentMethod !== trip.paymentMethod || payment.method !== trip.paymentMethod) return false;
  return trip.paymentMethod === 'cash'
    ? payment.status === 'cash_due'
    : ['wallet', 'card'].includes(trip.paymentMethod) && ['held', 'captured'].includes(payment.status);
}

function activate(trip, agreement, payment, pin, now) {
  if (!trip || terminal(trip.status)) return trip;
  if (!paymentReady(trip, agreement, payment)) fail('Payment for the agreed fare must be confirmed before pickup.');
  if (trip.negotiatedBookingFinalized === true && trip.goContinuationVersion === 2) return trip;
  if (!['payment_required', 'accepted', 'driver_on_way', 'arrived'].includes(trip.status))
    fail('This booking can no longer be activated.');
  return {...trip, status: trip.status === 'payment_required' ? 'accepted' : trip.status,
    pickupPin: trip.negotiatedBookingFinalized === true && /^\d{4}$/.test(String(trip.pickupPin || '')) ? String(trip.pickupPin) : pin,
    requirePin: true, safetyShareRequired: false, // Sharing is offered, never a PIN gate.
    safetyShareCompleted: trip.safetyShareCompleted === true,
    paymentStatus: payment.status, paymentsReady: true, goContinuationVersion: 2,
    negotiatedBookingFinalized: true, negotiatedBookingFinalizedAt: trip.negotiatedBookingFinalizedAt || now};
}

function action(trip, name, body, evidence, now) {
  if (name === 'cancel' && /^cancelled(?:_|$)|^canceled(?:_|$)/.test(String(trip?.status || ''))) return trip;
  if (!trip || terminal(trip.status)) fail('This booking has ended.');
  if (name === 'cancel') {
    if (arrived(trip)) fail('The driver has arrived. Contact support to end this booking.');
    return {...trip, status: evidence.role === 'driver' ? 'cancelled_by_driver' : 'cancelled_by_commuter', cancelledAt: now};
  }
  if (!paymentReady(trip, evidence.agreement, evidence.payment) || !trip.negotiatedBookingFinalized)
    fail('Payment for the agreed fare must be confirmed before pickup.');
  if (name === 'shareComplete') {
    if (!arrived(trip) || !evidence.shareIssued) fail('Share your trip after the driver arrives.');
    return {...trip, safetyShareCompleted: true, safetyShareAt: trip.safetyShareAt || now};
  }
  if (name === 'onWay') {
    if (trip.status === 'driver_on_way') return trip;
    if (trip.status !== 'accepted') fail('The booking is not awaiting pickup.');
    return {...trip, status: 'driver_on_way', driverOnWayAt: now};
  }
  if (name === 'arrive') {
    if (trip.status === 'arrived') return trip;
    if (trip.status !== 'driver_on_way') fail('Start pickup before marking arrival.');
    if (!evidence.nearPickup) fail('Update your live location at pickup before marking arrival.');
    return {...trip, status: 'arrived', arrivedAt: now};
  }
  if (name === 'collectCash') {
    if (trip.paymentMethod !== 'cash' || trip.status !== 'in_transit' || !trip.pinVerifiedAt || !trip.tripStartedAt)
      fail('Verify the pickup PIN and drive to the destination before collecting cash.');
    if (trip.cashCollectedAt) return trip;
    const early=tripEndSafety.approved(trip,body.endRequestId,now)&&trip.tripEndSafety.cashCollectedConfirmed===true;
    if (body.cashCollected !== true || (!evidence.nearDestination&&!early))
      fail('Confirm cash collection only after arriving at the destination.');
    return {...trip, cashCollectedAt: now, cashCollectionStatus: 'collected',
      ...(evidence.nearDestination?{dropoffArrivedAt:now}:{earlyDropoffConfirmedAt:now})};
  }
  if (name === 'verifyPin') {
    if (trip.status === 'in_transit' && trip.pinVerifiedAt) return trip;
    if (trip.status !== 'arrived' || !trip.arrivedAt) fail('The driver must arrive before checking the PIN.');
    // External share sheets may be dismissed or fail to return a callback.
    // Payment, arrival and verified pickup PIN are mandatory; sharing is not.
    if (Number(trip.pinAttempts || 0) >= 5) fail('PIN attempts are locked. Contact support.', 429);
    const next = {...trip, pinAttempts: Number(trip.pinAttempts || 0) + 1};
    const enteredPin = String(body.pin || '').trim();
    if (!/^\d{4}$/.test(enteredPin) || !/^\d{4}$/.test(String(trip.pickupPin || '')) || enteredPin !== String(trip.pickupPin)) return next;
    return {...next, status: 'in_transit', pinVerifiedAt: now, passengerOnboardAt: now, tripStartedAt: now};
  }
  fail('Unknown booking action.', 400);
}

function requireCashDropoff(trip) {
  const early=trip.earlyDropoffConfirmedAt&&(tripEndSafety.approved(trip,trip.tripEndSafety?.id,Date.now())||
    (tripEndSafety.processing(trip)&&trip.tripCompletion.mode==='agreed_early_end'));
  if (!trip.pinVerifiedAt || !trip.tripStartedAt || !trip.cashCollectedAt || (!trip.dropoffArrivedAt&&!early) ||
      !['in_transit', 'completed'].includes(trip.status))
    fail('Cash is collected after drop-off. Confirm collection at destination before completing the ride.');
}
module.exports = {terminal, clearRequestPointer, arrived, paymentReady, activate, action, requireCashDropoff};
