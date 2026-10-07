const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  amountToSubunit,
  applyWalletCredit,
  sanitizeReference,
  transactionMatchesPayment
} = require('../../functions/paystack-wallet');

test('Paystack wallet amounts use ZAR subunits and enforce wallet limits', () => {
  assert.equal(amountToSubunit(10), 1000);
  assert.equal(amountToSubunit(95.55), 9555);
  assert.equal(amountToSubunit(5000), 500000);

  assert.throws(
    () => amountToSubunit(9.99),
    error => error.code === 'payment/invalid-amount'
  );

  assert.throws(
    () => amountToSubunit(5000.01),
    error => error.code === 'payment/invalid-amount'
  );
});

test('Paystack references reject unsafe characters', () => {
  assert.equal(
    sanitizeReference('ASIYE-ABC12345'),
    'ASIYE-ABC12345'
  );

  assert.throws(
    () => sanitizeReference('../bad/reference'),
    error => error.code === 'payment/invalid-reference'
  );
});

test('wallet credit is idempotent for the same Paystack reference', () => {
  const payment = {
    reference: 'ASIYE-TEST-123456',
    amount: 100
  };

  const first = applyWalletCredit(
    {
      walletBalance: 50,
      credits: 50
    },
    payment,
    1000
  );

  assert.equal(first.credited, true);
  assert.equal(first.balance, 150);
  assert.equal(first.profile.walletBalance, 150);
  assert.equal(first.profile.credits, 150);

  const second = applyWalletCredit(
    first.profile,
    payment,
    2000
  );

  assert.equal(second.credited, false);
  assert.equal(second.balance, 150);
});

test('Paystack transaction must match amount, currency, reference and success state', () => {
  const payment = {
    reference: 'ASIYE-MATCH-123456',
    amount: 95.5
  };

  assert.equal(
    transactionMatchesPayment(
      {
        status: 'success',
        reference: 'ASIYE-MATCH-123456',
        currency: 'ZAR',
        amount: 9550
      },
      payment
    ),
    true
  );

  assert.equal(
    transactionMatchesPayment(
      {
        status: 'success',
        reference: 'ASIYE-MATCH-123456',
        currency: 'ZAR',
        amount: 9500
      },
      payment
    ),
    false
  );

  assert.equal(
    transactionMatchesPayment(
      {
        status: 'failed',
        reference: 'ASIYE-MATCH-123456',
        currency: 'ZAR',
        amount: 9550
      },
      payment
    ),
    false
  );
});
