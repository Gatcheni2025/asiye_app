'use strict';
// Only private server-verified settlement records enable new bookings.
function bookingBankingReady(driverId, driver, account, domain) {
  const owner = driver?.authUid || driver?.userUid || driverId;
  return !!driver && ['live','test'].includes(domain) &&
    account?.ownerUid === owner && account.status === 'verified' &&
    account.paystackDomain === domain && account.platformCommissionPercent === 20 &&
    /^ACCT_[A-Za-z0-9]+$/.test(String(account.subaccountCode || '')) &&
    /^[0-9]{4}$/.test(String(account.accountLast4 || ''));
}
const BANKING_REQUIRED = 'Verify your banking details before receiving or accepting new bookings. Open Menu → Banking details.';
module.exports = {bookingBankingReady, BANKING_REQUIRED};
