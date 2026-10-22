'use strict';

const {isVerifiedSubaccount, PLATFORM_COMMISSION_PERCENT} = require('./paystack-subaccount-split');
const {terminal, clearRequestPointer} = require('./go-continuation');
const PROJECT = 'asiye-paystack-staging';
const idOf = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || '')) ? String(value) : '';

// This service is deliberately unavailable in production, even to a full admin.
// Its separate claim is assigned by the staging owner, never by a browser.
function makeStagingTestConsole({admin, projectId, paymentDomain, paystackRequest, driverEligible, HttpsError}) {
  const db = admin.database();
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const read = async path => (await db.ref(path).once('value')).val();
  async function driverInfo(id) {
    if (!id) return null;
    const [driver, account] = await Promise.all([read('taxis/' + id), read('driverPaystackSubaccounts/' + id)]);
    return {id, name: String(driver?.name || driver?.fullName || 'Driver'),
      approved: !!driver && driverEligible(driver),
      payoutStatus: account?.status || 'not_configured',
      subaccountCode: account?.subaccountCode || '', paystackDomain: account?.paystackDomain || ''};
  }
  async function cleanPointers(trip, requestId) {
    const passengers = new Set([trip.commuterId, ...Object.keys(trip.passengers || {})].filter(idOf));
    for (const id of passengers) {
      await db.ref(`commuters/${id}/currentRequest`).transaction(value => clearRequestPointer(value, requestId), undefined, false);
    }
    // Updating the profile in a transaction protects a newer booking's lock,
    // seat count, broadcasting and online state from a delayed cancel retry.
    const taxis = (await read('taxis')) || {};
    for (const [id, taxi] of Object.entries(taxis)) {
      if (taxi.currentRequest === requestId || taxi.bookingQueue?.[requestId]) {
        await db.ref('taxis/' + id).transaction(current => {
          if (current === null) return null;
          const next = {...current};
          if (next.currentRequest === requestId) {
            delete next.currentRequest;
            Object.assign(next, {isFull: false, passengerCount: 0, isOnline: false, isBroadcasting: false});
          }
          if (next.bookingQueue?.[requestId]) {
            next.bookingQueue = {...next.bookingQueue}; delete next.bookingQueue[requestId];
          }
          return next;
        }, undefined, false);
      }
    }
    const notices = (await read('notifications/taxis')) || {};
    for (const [id, rows] of Object.entries(notices)) {
      for (const [key, value] of Object.entries(rows || {})) {
        if (key !== requestId && value?.requestId !== requestId) continue;
        await db.ref(`notifications/taxis/${id}/${key}`).transaction(current =>
          current == null || key === requestId || current.requestId === requestId ? null : undefined, undefined, false);
      }
    }
    if (trip.type === 'delivery' || trip.parcelSecurityVersion === 2) {
      await db.ref('delivery_requests/' + requestId).update({status: 'cancelled_by_admin', cancelledAt: trip.cancelledAt});
    }
  }
  return async function stagingTestConsole(data, context) {
    if (projectId() !== PROJECT) fail('permission-denied', 'Test-trip tools are restricted to isolated Asiye staging.');
    if (!context?.auth?.uid) fail('unauthenticated', 'Sign in with your staging test administrator account.');
    if (context.auth.token?.stagingTripTester !== true)
      fail('permission-denied', 'Staging trip-test access has not been assigned to this account.');
    if (paymentDomain() !== 'test') fail('failed-precondition', 'The staging Paystack key must be TEST.');
    const action = String(data?.action || 'session');
    if (action === 'session') return {ok: true, uid: context.auth.uid, projectId: PROJECT, paystackDomain: 'test'};
    if (action === 'list') {
      const rows = (await db.ref('requests').orderByChild('createdAt').limitToLast(100).once('value')).val() || {};
      const drivers = new Map();
      const trips = [];
      for (const [id, trip] of Object.entries(rows)) {
        if (!trip || terminal(trip.status)) continue;
        const driverId = idOf(trip.taxiId || trip.driverId);
        if (driverId && !drivers.has(driverId)) drivers.set(driverId, await driverInfo(driverId));
        trips.push({id, status: String(trip.status || 'pending'), type: String(trip.type || 'go'),
          passengerName: String(trip.commuterName || 'Passenger'), driver: drivers.get(driverId) || null,
          paymentMethod: String(trip.paymentMethod || 'cash'), paymentStatus: String(trip.paymentStatus || 'unpaid'),
          fare: Number(trip.agreedFare || trip.finalAmount || trip.totalPoolFare || 0),
          createdAt: Number(trip.createdAt || 0), started: !!trip.tripStartedAt || trip.status === 'in_transit'});
      }
      return {ok: true, trips: trips.sort((a,b) => b.createdAt - a.createdAt), limit: 100};
    }
    if (action === 'linkTestSubaccount') {
      const driverId = idOf(data?.driverId), subaccountCode = String(data?.subaccountCode || '').trim();
      if (!driverId || !/^ACCT_[A-Za-z0-9]+$/.test(subaccountCode))
        fail('invalid-argument', 'Select an approved staging driver and a Paystack TEST subaccount code.');
      const driver = await read('taxis/' + driverId);
      if (!driver || !driverEligible(driver)) fail('failed-precondition', 'The driver and supported vehicle must be approved first.');
      const result = await paystackRequest('/subaccount/' + encodeURIComponent(subaccountCode));
      const account = result.data || {};
      if (account.domain !== 'test' || !isVerifiedSubaccount(account, subaccountCode))
        fail('failed-precondition', 'Use an active, verified TEST subaccount with 20% Asiye commission.');
      const record = {status: 'verified', subaccountCode, platformCommissionPercent: PLATFORM_COMMISSION_PERCENT,
        paystackDomain: 'test', ownerUid: String(driver.authUid || driver.userUid || driverId),
        accountLast4: String(account.account_number || '').slice(-4), bankName: String(account.settlement_bank || ''),
        accountName: String(account.business_name || ''), testOnly: true, linkedBy: context.auth.uid, createdAt: Date.now()};
      const ref = db.ref('driverPaystackSubaccounts/' + driverId);
      await ref.once('value');
      const saved = await ref.transaction(current => {
        if (current === null) return record;
        // Never replace an existing payout destination, including incomplete
        // provisioning records whose outcome may still need reconciliation.
        if (current.subaccountCode === subaccountCode && current.paystackDomain === 'test') return current;
        return undefined;
      }, undefined, false);
      if (!saved.committed) fail('failed-precondition', 'A different or unresolved subaccount already exists. It must be reconciled before relinking.');
      await db.ref('taxis/' + driverId).update({payoutStatus: 'verified', payoutAccountLast4: record.accountLast4});
      await db.ref('adminAudit').push().set({action: 'staging_test_subaccount_linked', target: driverId,
        adminUid: context.auth.uid, subaccountCode, paystackDomain: 'test', createdAt: Date.now()});
      return {ok: true, driverId, subaccountCode, paystackDomain: 'test', status: 'verified'};
    }
    if (action !== 'cancelTrip') fail('invalid-argument', 'Unknown staging test action.');
    const requestId = idOf(data?.requestId), reason = String(data?.reason || '').trim();
    if (!requestId || reason.length < 10 || reason.length > 500 || /[<>\u0000-\u001f]/.test(reason))
      fail('invalid-argument', 'Select a test trip and give a cancellation reason of 10–500 characters.');
    if (data?.confirmation !== requestId) fail('invalid-argument', 'Confirm the exact test trip ID before cancellation.');
    const payments = (await read('tripPayments/' + requestId)) || {};
    if (Object.values(payments).some(payment => payment?.method === 'card' && payment.paystackDomain !== 'test'))
      fail('failed-precondition', 'This trip has a LIVE or unclassified card payment and cannot be cancelled by TEST tools.');
    const ref = db.ref('requests/' + requestId);
    await ref.once('value');
    const cancelled = await ref.transaction(trip => {
      if (trip === null) return null;
      if (trip.status === 'cancelled_by_admin' && trip.stagingTestCancellation) return trip;
      if (terminal(trip.status) || trip.status !== data?.expectedStatus) return undefined;
      return {...trip, status: 'cancelled_by_admin', cancelledAt: Date.now(), cancelledBy: context.auth.uid,
        stagingTestCancellation: {reason, previousStatus: trip.status, actorUid: context.auth.uid, projectId: PROJECT}};
    }, undefined, false);
    const trip = cancelled.snapshot.val();
    if (!cancelled.committed || !trip?.stagingTestCancellation)
      fail('failed-precondition', 'The trip changed or ended. Refresh before cancelling.');
    await cleanPointers(trip, requestId);
    const needsPaymentReview = Object.values(payments).some(payment => payment?.method === 'card');
    if (needsPaymentReview) await db.ref('stagingTestPaymentReviews/' + requestId).update({
      requestId, status: 'check_test_refund', cancelledAt: trip.cancelledAt, actorUid: context.auth.uid});
    await db.ref('adminAudit/staging-cancel-' + requestId).set({action: 'staging_test_trip_cancelled', target: requestId,
      reason: trip.stagingTestCancellation.reason, previousStatus: trip.stagingTestCancellation.previousStatus,
      adminUid: trip.stagingTestCancellation.actorUid, createdAt: trip.cancelledAt});
    return {ok: true, requestId, status: 'cancelled_by_admin', needsPaymentReview};
  };
}
module.exports = {makeStagingTestConsole, PROJECT};
