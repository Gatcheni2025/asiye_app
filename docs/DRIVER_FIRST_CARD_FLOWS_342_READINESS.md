# Asiye 11.0.72 (342): driver-first payment review APK

**Draft engineering state; NOT production release approval.** GitHub payment branch:
`fix/paystack-subaccounts-cash-card-no-wallet`; draft PR #19. Base includes exact Android release
SHA `1646a9a9e4c4fa4145331316887ec3b04dbb3db1` and uploaded iOS
SHA `2b6c424a463c7225ee264ac77aae45f5a2c94759`.
Do not publish another bundle with Android versionCode `341` or reuse Apple build `93124`.

## Android installation-test APK
The signed `11.0.72+342` review APK was built from commit
`bba32240489dad50c11051aa5acb15ffcfec6953` after 152 regression checks and
105 Firebase/security checks passed. The APK signature, Firebase signing
certificate, package name and version were verified before upload.
Build: https://github.com/Gatcheni2025/asiye_app/actions/runs/38723573317

This APK contains both passenger and driver modes. Its configured project
endpoints are unchanged: building it does not deploy the reviewed functions or
rules, or create an isolated staging project. Secure Card/Parcel workflows need
the matching backend. Do not use it for live Card payments before the reviewed
backend, provider configuration and real payment acceptance have been verified.
No AAB, mobile-store release or new iOS build is part of this APK workflow.

## What changed
- **Go negotiated fare** continues to lock an accepting driver and fare before
  Paystack; the protected backend now requires their active approved 20/80
  Paystack subaccount for card transactions.
- **Parcel Card**: create a non-paid request, dispatch to eligible nearby drivers
  and restore its live passenger screen. A driver accepts; the accepted request
  moves to `payment_required` with the driver's `taxiId`. Passenger payment
  controller starts Paystack only with an assigned driver/subaccount.
  A successful verified Paystack split marks the assigned Parcel request
  `accepted` (and its mirror), *not* a second broadcast.
  The driver has a card-payment-wait screen; its pickup button refuses to proceed
  until `paymentsReady` and `paymentStatus` confirm the fare.
  Share sheet is not a prerequisite to dispatch or payment.
- **Work/Club**: full pool **and driver acceptance** are both required before
  any card transaction is initiated. Accepting a ready pool updates
  per-passenger payment status; each member pays their own amount through the
  *same assigned driver's* approved Paystack subaccount. Cash waits until dropoff.
  The original 30-minute timer and negotiations stay in place.
- **Cash and Wallet**: Cash remains available. No new Wallet bookings or
  top-ups; historical Wallet balances/ledger are retained for refund/reconciliation.
- **Shared payment JavaScript**: `assets/passenger-v2/js/wallet.js` contains the
  card controller even though it has a legacy filename. Its script tag must stay
  on the page while cash/card works; its prepaid-wallet UI stays hidden.
- **Anti-loop**: repeated passenger live-trip updates do not reopen Paystack
  if a pending checkout for that request is already stored.
- **Secure Parcel V2**: authenticated backend creation, driver acceptance,
  passenger-only PIN retrieval, driver GPS/arrival/PIN checks and completion.
  PINs live in `parcelPrivate`; clients cannot create or mutate secure trips.
  Completion and cancellation clean up reservations on the server, including
  retries after a lost response. The Go action and generic refund endpoints
  refuse secure Parcel requests.
- **Durable checkout**: reserve one reference and its callback mapping before
  calling Paystack. A failed/unknown response retains that reference for
  verification; retries cannot create another payable checkout. Signed callbacks
  re-verify with Paystack, preserve captured/refunded state and quarantine late
  charges on cancelled or reassigned trips for merchant review.

## Automated evidence (not full sandbox E2E)
- `test/driver-first-card-booking.test.cjs` executes the actual Parcel
  passenger JavaScript in a mocked Firebase WebView to check Cash/Card dispatch
  order and that Wallet is rejected before a request is saved.
- The tests inspect and exercise Work `acceptWaiting`, pending subaccount guard,
  card callback and correct driver-accepted status, and validate that Cash/Card
  controller files are loaded.
- GitHub CI: `.github/workflows/paystack-subaccount-migration.yml` and
  Firebase security emulators. A passing source check alone is not payment
  provider approval and does not certify actual bank settlement.
- `test/security/payment-handlers-emulator.test.cjs` runs the actual exported
  Firebase handlers with an isolated RTDB namespace, simulated identities and
  simulated Paystack HTTP. It covers Cash/Card Parcel completion, concurrent
  driver acceptance/checkout, PIN lockout, GPS, lost API responses, signed and
  forged callbacks, cancellation races, duplicate refunds, Go checkout and
  per-passenger Work checkout. This is integration testing against an emulator,
  not a real Paystack or mobile-device test.

## Release-blocking acceptance before any production deployment
1. **Paystack account approved** in writing for per-driver 80/20 subaccount
   settlement under the applicable provider schedule, with per-driver ZAR bank validation working.
2. **Actual Paystack test charges** for assigned driver, wrong/unverified driver,
   cancellations, failure/retry, webhook duplicates, Paystack return after app
   closure, refunds, fee-bearer confirmation and settlement reconciliation.
   Run Go, Work group and Parcel. Verify net shares and bank destinations.
3. **Parcel staging/device acceptance**: secure V2 pickup/arrival/PIN actions are
   implemented in this branch. Deploy the complete reviewed backend and rules
   together to an isolated staging project, then verify actual driver/passenger
   GPS, camera/WebView sessions, private PIN display, pickup, cash collection and
   completion on devices. Existing legacy Parcel requests need reconciliation;
   they are not silently converted into server-verified V2 bookings.
4. **Approved driver and vehicle**: admin must verify insurance/licensing/
   documents, not just driver-provided data. RTDB rules must reject tampering
   with `taxiId`, payment statuses, PIN and settlement destinations.
5. **Existing wallet credits**: reconcile top-ups and pending refunds; no balances
   may be silently erased. Send customer notices and update legal policies.
6. **Full app/device matrix**: real Android/Android, Android/iOS and iOS/iOS
   passenger/driver runs, Go Cash/Card, Work pooled Cash/Card per member,
   Parcel Cash/Card, cancellation, poor connection and restart/resume.
7. **Store version metadata**: `11.0.72+342` is used for the internal Android
   review APK. Before a store release, finish E2E verification and prepare a
   distinct Apple build newer than `93124`.
   Confirm App Store Connect marketing version before editing iOS workflow.
   Validate the store AAB and IPA; do not publish untested financial code.
8. **Website/merchant compliance**: update driver-commission marketing copy,
   privacy incl. face scans, refund/cancellation and waiting-fee schedule and
   all registered-company contact details before providing new links to Paystack.
