'use strict';
const PLATFORM_COMMISSION_PERCENT = 20;
const code = value => typeof value === 'string' ? value : String(value?.subaccount_code || '');
function isVerifiedSubaccount(value, expected) {
  return /^ACCT_[A-Za-z0-9]+$/.test(code(value)) &&
    (!expected || code(value) === expected) &&
    Number(value?.percentage_charge) === PLATFORM_COMMISSION_PERCENT &&
    value?.is_verified === true &&
    ![false,0,'0'].includes(value?.active);
}
function verifySplit(payment, transaction) {
  const returned = transaction?.subaccount;
  return payment?.splitMode === 'paystack_subaccount_80_20' &&
    /^ACCT_[A-Za-z0-9]+$/.test(String(payment.subaccountCode || '')) &&
    code(returned) === payment.subaccountCode &&
    (typeof returned !== 'object' || returned === null ||
      returned.percentage_charge == null ||
      Number(returned.percentage_charge) === PLATFORM_COMMISSION_PERCENT);
}
module.exports = {PLATFORM_COMMISSION_PERCENT, code, isVerifiedSubaccount, verifySplit};
