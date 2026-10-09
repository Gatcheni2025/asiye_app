# Asiye 11.0.57 (327): Passenger face onboarding & Paystack driver card payout

## Passenger sign-up
Phone OTP login is not sufficient to complete registration. User must supply full name and capture a saved front-camera face photo on `passenger-v2/login.html`.
- `onboarding.js` invokes the Flutter `captureFacePhoto` native bridge (`passenger-profile`) or front-facing browser camera as fallback, returning a JPEG data URL.
- `login.js` writes a minimal authenticated `commuters/{uid}` profile and invokes the authenticated `uploadProfileImageProxy` function to save the picture; only on success does it mark `onboardingCompleted:true` and enter the app.
- Existing incomplete phone profiles return to the same required screen; the passenger dashboard independently checks name and stored photo.
- Failed camera/upload never marks completed or redirects. Existing completed profiles retain their data.

## Card fare settlement — architecture decision
**Do not activate as an instant checkout split.** Asiye charges passengers **before** the matching driver is known. Paystack's checkout-time subaccount split requires the recipient at payment initialization. Instead, collect and verify the passenger card fare on Asiye's Paystack merchant account, then initiate a separate **80% driver bank transfer after completed delivery/ride**. Asiye retains the other **20% of the gross card fare**. Paystack card and transfer fees are **additional** merchant expenses; Asiye's net commission after fees will be less than 20%.

**This is not an escrow or delayed card authorization**: a held card trip ledger means Paystack *already confirmed a successful charge*. The driver transfer is a separate bank payment, possibly after Paystack makes the merchant balance transferable.

Path for Go, Club and Parcel:
1. Passenger books and chooses card. `prepareTripPayment` opens Paystack checkout, payment is verified against reference/currency/amount using Paystack's transaction API and signed webhook.
2. Driver is assigned later. For parcel, driver dispatch is held until the card charge has been confirmed.
3. Driver completes the job, server captures the trip-payment ledger; the DB completion trigger `disburseCompletedCardTrips` verifies the card payment again.
4. `splitCardFare` computes the driver's 80% in ZAR cents and Asiye's 20% as the exact remainder. One immutable `driverCardPayouts/{requestId}/{passengerId}` ledger entry is created with a deterministic `asiye_card_...` transfer reference.
5. Driver sets their verified bank account at `driver-v2/payout.html`: use Paystack ZAR bank list, bank/validate (name, account, identity/passport) and create a `basa` transfer recipient. Full account number and identity number are sent only through an authenticated HTTPS function to Paystack; the payout account record stores recipient code, bank code, masked last four, and validated name. A driver with an unverified bank has `awaiting_bank` status; saved entitlements are retried on bank verification.
6. Server initiates `/transfer` from Paystack merchant `balance` with its immutable reference; only a **signed Paystack `transfer.success` webhook** may mark the ledger `paid`. OTP-required transfers and ambiguous timeouts remain pending/manual reconciliation; never generate a new transfer reference for the same card fare.

## Release blockers / operational checks
- Confirm merchant Paystack account is approved for **South African Transfers** and has sufficient *transferable* ZAR balance; incoming card charges may not immediately fund Transfers. Confirm whether transfer confirmation OTP is enabled. Enable fully automated transfers in Paystack dashboard only with the merchant account owner's approval and appropriate controls.
- Ensure the `PAYSTACK_SECRET_KEY` Cloud Functions secret and Paystack signed webhook URL are configured for the **same** merchant. Verify test mode vs live mode and retry logic with Paystack.
- Monitor `driverCardPayouts` for `awaiting_bank`, `otp_required`, `needs_reconciliation`, `transfer_pending`, `transfer_failed`, `reversed` and `paid`. **Do not manually resend or repay ambiguous transfers without reconciling reference in Paystack**.
- Deploy functions selectively: `configureDriverCardPayout`, `disburseCompletedCardTrips`, `paystackWebhook`, and any payment changes to `prepareTripPayment`, `verifyTripCardPayment`, `settleTripPayment` and `uploadProfileImageProxy` from the SAME reviewed release branch. Avoid deploying older payment functions from main. Deploy Realtime Database rules and hosting assets. Production deployment has **not** occurred.
- Finance/KYC review: bank account ownership, payout identification, POPIA retention, refunds, failed transfers, disputes, chargebacks, Paystack fees, tax accounting, duplicate booking reconciliation, and Club passenger share math. Prevent unpaid card passengers being dispatched or drivers being paid for cancelled jobs.
- Android release must pass all Node tests, Flutter build/signature verification, Firebase emulator security tests, native camera test, and real Paystack sandbox end-to-end transfers. Do **not** claim the app is launched on GitHub commit alone.
- Wallet top-ups paid using a card are **not** driver fares and should not pay a driver at recharge time. Driver entitlements should be recognized when a ride consumes Wallet funds, a separate future change.
