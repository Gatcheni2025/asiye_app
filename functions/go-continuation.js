'use strict';

const terminal = status => ['completed', 'expired', 'rejected', 'cancelled'].includes(status) || String(status || '').startsWith('cancelled');
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
    requirePin: true, safetyShareRequired: true,
    safetyShareCompleted: trip.safetyShareCompleted === true,
    paymentStatus: payment.status, paymentsReady: true, goContinuationVersion: 2,
    negotiatedBookingFinalized: true, negotiatedBookingFinalizedAt: trip.negotiatedBookingFinalizedAt || now};
}

function action(trip, name, body, evidence, now) {
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
  if (name === 'verifyPin') {
    if (trip.status === 'in_transit' && trip.pinVerifiedAt) return trip;
    if (trip.status !== 'arrived' || !trip.arrivedAt) fail('The driver must arrive before checking the PIN.');
    if (!trip.safetyShareCompleted) fail('The passenger must share the trip before departure.');
    if (Number(trip.pinAttempts || 0) >= 5) fail('PIN attempts are locked. Contact support.', 429);
    const next = {...trip, pinAttempts: Number(trip.pinAttempts || 0) + 1};
    if (String(body.pin || '').trim() !== String(trip.pickupPin)) return next;
    return {...next, status: 'in_transit', pinVerifiedAt: now, passengerOnboardAt: now, tripStartedAt: now};
  }
  fail('Unknown booking action.', 400);
}

module.exports = {terminal, arrived, paymentReady, activate, action};
