# Asiye Paystack 80/20 + Cash/Card only migration (review branch)
**DO NOT deploy to production automatically.** Source: 11.0.71+341.
### Core changes
- New Paystack `/subaccount` route for approved drivers, with `percentage_charge: 20` credited to Asiye and 80% directly settled to driver's Paystack subaccount. Gateway fees default to Asiye.
- Each new card charge MUST identify the verified and assigned driver before `/transaction/initialize`, with `subaccount: ACCT_...`. A passenger is NEVER charged to Asiye's main account as a later-to-be-split payment.
- Existing Go negotiated fares choose their driver before attempting payment. Legacy fixed-fare Go and parcel checkout currently attempt card payment before a driver is assigned; these now FAIL CLOSED for card (cash continues). Implement a driver-reservation-before-Paystack flow for these paths before launch.
- Pool/Work must also assign the approved driver BEFORE collecting each passenger's card amount; validate multi-passenger final fares and driver assignment prior to enabling card mode.
- No new Wallet top-ups (manual EFT or Paystack). Wallet choice and menu entry are removed. All existing balances, historical top-up receipts, wallet transaction records, webhooks and support reconciliation data MUST be preserved. Prepare balance ledger review and lawful refund/return arrangements; never zero customer balances.
- Legacy `/transfer` initiation removed from live route. Historical Paystack `transfer.*` webhooks remain to account for transfers already initiated before migration; no automatic replacement bank transfers.
### Signoff required before live rollout
1. Obtain written Paystack activation approval and confirm South African subaccount bank validation, percentage and settlement behavior in sandbox.
2. Verify each driver's correct bank and ID, active subaccount, driver identity and vehicle approval. Never use one driver's subaccount for another driver's trip.
3. Run sandbox tests for Go negotiated fare, full/partial Club, parcel, cancellation/refunds, driver reassignment, double callbacks, cash payments, multiple passenger IDs, all payment methods. Confirm Paystack transaction includes subaccount and amount; Asiye bears processing fees.
4. Reconcile every legacy wallet balance, uncleared EFT and historical payout through admin/support. Do not delete old ledger state. Update legal policies and customer notices.
5. Update and test signed APK/AAB and iOS builds, and server rule protections before enabling card checkout in Production. Confirm final app version used by Play/App Store.
6. Payment descriptions must not claim funds are held in escrow: Paystack settles on its own T+2 schedule.
### Important
`is_verified` on the Paystack subaccount must be true before a driver may receive card-funded trips. New Paystack subaccounts may initially be pending verification. Paystack's official subaccount API and account verification prerequisites are authoritative.
