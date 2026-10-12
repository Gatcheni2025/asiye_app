# Asiye 11.0.69 (339): active trips and payment continuation

Based on 11.0.68 (338) on `fix/11.0.67-club-booking-arrival-pin-timer`.

Passenger restoration rebuilds pickup, destination, fare, payment method, Club membership,
countdown and personal pickup state, then paints the trip before returning success. Driver
restoration paints the saved request immediately and reopens the current Club passenger PIN
screen after arrival. Stale listeners cannot repaint a replaced trip. Failed reads preserve
booking state and offer Retry. Cancelled membership is excluded from active pool restoration.

Go cancellation and arrival are serialized through `goTripActionSecure`; Club cutoff is
checked in its existing server transaction. Passenger cancellation closes at their arrival;
driver cancellation closes at any pickup arrival. Negotiated group cancellation also closes
when any member arrives, preserving the agreed split.

Cash `cash_due` and reserved Wallet funds unlock driving to pickup. Voucher credits already
credited to Wallet use the same reservation; no new voucher issuance/redemption or unverified
voucher code acceptance is introduced. Card remains locked until the private ledger records
a verified hold/capture for the exact protected fare. Payment preparation, card verification,
the signed Paystack webhook and the ledger trigger activate pickup without an open passenger
app. Server PIN verification and sharing are required after arrival, before departure.
Duplicate confirmation preserves the PIN and advanced trip state.

## Deploy and test

Install 339 on both passenger and driver devices. New Go requests explicitly opt in with
`goContinuationRequestedVersion: 2`; the new client can resume an older active Go booking via
`finalizeNegotiatedGoBooking` with `continuationVersion: 2`. Requests not opted in retain the
338 finalization flow. Test mixed versions before broad rollout: upgraded Go trips require
the new driver's secure actions. Club retains its version-2 server flow.

Run `.github/workflows/deploy_active_trip_339.yml` on this exact branch before distributing
339. This manual workflow tests first, then selectively deploys `goTripActionSecure`,
`finalizeNegotiatedGoBooking`, `continueGoAfterPayment`, `prepareTripPayment`,
`verifyTripCardPayment`, `paystackWebhook`, `createTripShareToken`, `clubDriverActionSecure`
and database rules. Do not deploy the entire Functions project.

Check app restart during pooling, negotiation, payment, pickup, arrived/PIN and transit for
both roles. Verify stale/missing IDs, offline retry, countdown, routes, driver movement,
cancellation versus arrival, cash continuation, voucher-funded Wallet reservation, card
confirmation with the passenger app closed, wrong PIN and five-attempt lock, post-arrival
sharing, repeated verification, cancellation release and final settlement on staging/devices.

105 release regression tests and six restoration behavior tests passed locally. The matching
GitHub Java 21 emulator check passed all 81 tests, including settlement and continuation
security protections: https://github.com/Gatcheni2025/asiye_app/actions/runs/38222280553 . Production deploy,
real-money payment/refund tests, GPS/device acceptance and Play publication have not been
performed. Check the new commit's Android Release APK/AAB and Firebase Security Validation
results before release. No automatic production deploy is configured.
