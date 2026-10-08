'use strict';
const crypto = require('node:crypto');
const PLATFORM_SHARE_BPS = 2000; // 20%
const DRIVER_SHARE_BPS = 8000;   // 80%

function splitCardFare(amountSubunit) {
  if (!Number.isSafeInteger(amountSubunit) || amountSubunit <= 0) {
    throw Error('Card amount must be a positive integer in ZAR cents.');
  }
  const driverSubunit = Math.floor(amountSubunit * DRIVER_SHARE_BPS / 10000);
  return { grossSubunit: amountSubunit, driverSubunit,
    asiyeSubunit: amountSubunit - driverSubunit,
    driverShare: 80, asiyeShare: 20, currency: 'ZAR' };
}

function stableTransferReference(requestId, passengerId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(String(requestId || '')) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(String(passengerId || ''))) {
    throw Error('Invalid payout reference identity.');
  }
  return 'asiye_card_' + crypto.createHash('sha256')
    .update(requestId + ':' + passengerId).digest('hex').slice(0, 32);
}
function isVerifiedCardPayment(payment, transaction) {
  if (!payment || !transaction) return false;
  return payment.provider === 'paystack' && payment.method === 'card' &&
    ['held','captured'].includes(payment.status) &&
    transaction.status === 'success' &&
    Number(payment.amountSubunit) === Number(transaction.amount) &&
    String(transaction.currency).toUpperCase() === 'ZAR' &&
    transaction.reference === payment.reference &&
    Number(transaction.amount) > 0;
}
function isPayoutReady({trip, payment, driverId, banking}) {
  return !!(
    trip?.status === 'completed' &&
    (trip.taxiId === driverId || trip.driverId === driverId) &&
    payment?.method === 'card' &&
    payment?.status === 'captured' &&
    banking?.status === 'verified' &&
    /^RCP_[A-Za-z0-9]+$/.test(String(banking.recipientCode || ''))
  );
}
function bankInput(input) {
  const bankCode = String(input?.bankCode || '').trim();
  const accountNumber = String(input?.accountNumber || '').trim();
  const accountName = String(input?.accountName || '').trim();
  const documentNumber = String(input?.documentNumber || '').trim();
  const documentType = String(input?.documentType || '').trim();
  const accountType = String(input?.accountType || '').trim();
  if (!/^[0-9]{3,10}$/.test(bankCode) ||
      !/^[0-9]{6,20}$/.test(accountNumber) ||
      accountName.length < 4 || accountName.length > 120 ||
      !['personal','business'].includes(accountType) ||
      !['identityNumber','passportNumber','businessRegistrationNumber'].includes(documentType) ||
      !/^[A-Za-z0-9]{5,30}$/.test(documentNumber)) {
    throw Error('Provide a valid bank, account holder, account number and verification document.');
  }
  return { bankCode, accountNumber, accountName, accountType, documentType, documentNumber };
}
module.exports = { splitCardFare, stableTransferReference, isVerifiedCardPayment,
  isPayoutReady, bankInput };
