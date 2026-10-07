'use strict';

function asMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function amountToSubunit(value) {
  const amount = asMoney(value);
  if (amount === null || amount < 10 || amount > 5000) {
    const error = new Error('Amount must be between R10 and R5,000.');
    error.code = 'payment/invalid-amount';
    throw error;
  }
  return Math.round(amount * 100);
}

function sanitizeReference(value) {
  const reference = String(value || '').trim();
  if (!/^[A-Za-z0-9.=\-]{8,100}$/.test(reference)) {
    const error = new Error('Invalid payment reference.');
    error.code = 'payment/invalid-reference';
    throw error;
  }
  return reference;
}

function applyWalletCredit(profile, payment, now = Date.now()) {
  const current = profile && typeof profile === 'object'
    ? structuredClone(profile)
    : {};

  const reference = sanitizeReference(payment?.reference);
  const amount = asMoney(payment?.amount);

  if (amount === null || amount <= 0) {
    const error = new Error('Payment amount is invalid.');
    error.code = 'payment/invalid-amount';
    throw error;
  }

  const markerKey = `paystack_${reference}`;
  const applied = {
    ...(current.walletAppliedPayments || {})
  };

  const currentBalance = asMoney(
    current.walletBalance ?? current.credits ?? 0
  ) ?? 0;

  if (applied[markerKey]) {
    return {
      profile: current,
      credited: false,
      balance: currentBalance,
      markerKey
    };
  }

  const nextBalance = Math.round(
    (currentBalance + amount) * 100
  ) / 100;

  applied[markerKey] = {
    provider: 'paystack',
    reference,
    amount,
    appliedAt: now
  };

  current.walletAppliedPayments = applied;
  current.walletBalance = nextBalance;
  current.credits = nextBalance;
  current.walletUpdatedAt = now;

  return {
    profile: current,
    credited: true,
    balance: nextBalance,
    markerKey
  };
}

function transactionMatchesPayment(transaction, payment) {
  if (!transaction || !payment) return false;

  const expectedSubunit = Math.round(
    Number(payment.amount || 0) * 100
  );

  return (
    transaction.status === 'success' &&
    String(transaction.reference || '') === String(payment.reference || '') &&
    String(transaction.currency || '').toUpperCase() === 'ZAR' &&
    Number(transaction.amount) === expectedSubunit
  );
}

module.exports = {
  amountToSubunit,
  applyWalletCredit,
  sanitizeReference,
  transactionMatchesPayment
};
