'use strict';

function paymentError(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function keyDomain(secret) {
  const match = /^sk_(test|live)_[A-Za-z0-9_]+$/.exec(String(secret || '').trim());
  if (!match) throw paymentError('Paystack is not configured correctly.', 'payment/configuration', 503);
  return match[1];
}

function requireLaunchApproval(domain, launch) {
  if (domain === 'test') return;
  if (domain !== 'live' || launch?.liveEnabled !== true ||
      !String(launch.approvalReference || '').trim() ||
      !String(launch.validationReference || '').trim()) {
    throw paymentError('Card payments await payment-provider approval and technical validation. Cash remains available.',
      'payment/launch-not-approved', 503);
  }
}

function requireTransactionDomain(payment, transaction, configuredDomain) {
  const expected = payment.paystackDomain || configuredDomain;
  if (!['test', 'live'].includes(expected) || transaction?.domain !== expected) {
    throw paymentError('Paystack transaction mode does not match this payment.', 'payment/domain-mismatch');
  }
}

const cancelled = status => ['rejected', 'expired'].includes(String(status || '')) ||
  /^(?:cancelled|canceled)(?:_|$)/.test(String(status || ''));

function refundableCancellation(trip, passengerId) {
  if (!trip) return false;
  if (trip.type === 'club') {
    const member = trip.passengers?.[passengerId];
    return !!member && (cancelled(trip.status) || cancelled(member.status)) &&
      !member.pinVerifiedAt && !member.passengerOnboardAt && !member.onboardAt &&
      !['in_transit', 'completed', 'all_onboard'].includes(trip.status);
  }
  return cancelled(trip.status) && !trip.pinVerifiedAt && !trip.tripStartedAt && !trip.passengerOnboardAt;
}

const refundState = status => status === 'processed' ? 'refunded' :
  ['pending', 'processing'].includes(status) ? 'refund_pending' : 'refund_review';

function createCardRefundService({database, request, configuredDomain, markPayment}) {
  async function updateFromProvider(payment, refund) {
    const transaction = refund?.transaction;
    const transactionMatches = typeof transaction === 'object' && transaction !== null
      ? transaction.reference === payment.reference || String(transaction.id) === String(payment.paystackTransactionId)
      : String(transaction) === String(payment.paystackTransactionId);
    if (!/^\d+$/.test(String(refund?.id || '')) || !transactionMatches ||
        Number(refund.amount) !== Number(payment.amountSubunit || Math.round(payment.amount * 100)) ||
        refund.currency !== 'ZAR' || refund.domain !== (payment.paystackDomain || configuredDomain())) {
      throw paymentError('Paystack refund does not match the original payment.', 'payment/refund-mismatch');
    }
    const ref = database().ref(`tripPayments/${payment.requestId}/${payment.passengerId}`);
    const result = await ref.transaction(current => {
      if (current === null) return null;
      if (current.reference !== payment.reference ||
          !['refund_initializing', 'refund_unknown', 'refund_pending', 'refund_review', 'refunded'].includes(current.status)) return;
      if (current.status === 'refunded') return current;
      return {...current, status: refundState(refund.status), refundId: String(refund.id),
        refundStatus: String(refund.status || 'unknown'), refundVerifiedAt: Date.now(),
        paymentRefundAttention: refundState(refund.status) === 'refund_review'};
    }, undefined, false);
    if (!result.committed || !result.snapshot.val()) throw Error('Refund payment changed during verification.');
    const current = result.snapshot.val();
    const trip = (await database().ref(`requests/${payment.requestId}`).once('value')).val();
    if (trip) await markPayment(payment.requestId, payment.passengerId, trip, {paymentStatus: current.status});
    if (trip && current.paymentRefundAttention) await database().ref(`requests/${payment.requestId}`).update({
      paymentRefundAttention: true, refundReviewReason: 'paystack_refund_needs_review'
    });
    return {status: current.status};
  }

  async function release(payment) {
    const db = database();
    const ref = db.ref(`tripPayments/${payment.requestId}/${payment.passengerId}`);
    const trip = (await db.ref(`requests/${payment.requestId}`).once('value')).val();
    if (!refundableCancellation(trip, payment.passengerId)) {
      throw paymentError('Cancel an unstarted booking before requesting its payment release. Contact support for a started trip.',
        'payment/refund-not-eligible');
    }
    // Only this atomic claim may initiate a refund. Timeouts retain the claim:
    // the provider may have accepted it even if its response never arrived.
    const attempt = require('node:crypto').randomUUID();
    const claim = await ref.transaction(current => {
      if (current === null) return null;
      if (current.reference !== payment.reference || current.status !== 'held') return;
      return {...current, status: 'refund_initializing', refundAttemptId: attempt, refundRequestedAt: Date.now()};
    }, undefined, false);
    if (!claim.committed || !claim.snapshot.val()) return {status: claim.snapshot.val()?.status || 'nothing_to_release'};
    const reserved = claim.snapshot.val();
    if (reserved.refundAttemptId !== attempt) return {status: reserved.status};
    try {
      const latest = (await db.ref(`requests/${payment.requestId}`).once('value')).val();
      if (!refundableCancellation(latest, payment.passengerId)) throw Error('Cancellation changed before refund.');
      const result = await request('/refund', {method: 'POST', body: {
        transaction: payment.paystackTransactionId || payment.reference,
        amount: Number(payment.amountSubunit || Math.round(payment.amount * 100)), currency: 'ZAR',
        customer_note: 'Asiye booking cancelled before service', merchant_note: `Asiye trip ${payment.requestId} cancelled`
      }});
      return await updateFromProvider(reserved, result.data);
    } catch (error) {
      await ref.transaction(current => {
        if (current === null) return null;
        if (current.refundAttemptId !== attempt || current.status !== 'refund_initializing') return;
        return {...current, status: 'refund_unknown', paymentRefundAttention: true, refundErrorAt: Date.now()};
      }, undefined, false);
      await db.ref(`requests/${payment.requestId}`).update({
        paymentRefundAttention: true, refundReviewReason: 'paystack_refund_outcome_unknown'
      });
      throw error;
    }
  }

  async function synchronize(reference) {
    const db = database();
    const mapping = (await db.ref(`tripPaymentReferences/${reference}`).once('value')).val();
    if (!mapping?.requestId || !mapping?.passengerId) return;
    const payment = (await db.ref(`tripPayments/${mapping.requestId}/${mapping.passengerId}`).once('value')).val();
    if (!payment || payment.reference !== reference || payment.method !== 'card') return;
    if (payment.status === 'refunded') return {status: 'refunded'};
    if (!['refund_initializing', 'refund_unknown', 'refund_pending', 'refund_review'].includes(payment.status)) return;
    let refund;
    if (/^\d+$/.test(String(payment.refundId || ''))) {
      refund = (await request('/refund/' + encodeURIComponent(payment.refundId))).data;
    } else {
      if (!/^\d+$/.test(String(payment.paystackTransactionId || ''))) throw Error('Refund transaction needs merchant review.');
      const result = await request('/refund?transaction=' + encodeURIComponent(payment.paystackTransactionId) + '&perPage=100');
      const matches = (Array.isArray(result.data) ? result.data : []).filter(item =>
        Number(item.amount) === Number(payment.amountSubunit || Math.round(payment.amount * 100)) &&
        (String(item.transaction?.id || item.transaction) === String(payment.paystackTransactionId) ||
         item.transaction?.reference === reference));
      if (matches.length !== 1) throw Error('Refund outcome needs provider reconciliation.');
      refund = matches[0];
    }
    return updateFromProvider(payment, refund);
  }
  return {release, synchronize};
}

module.exports = {keyDomain, requireLaunchApproval, requireTransactionDomain,
  refundableCancellation, createCardRefundService};
