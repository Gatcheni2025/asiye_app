# Asiye Paystack 80/20 + Cash/Card only migration (review branch)
**DO NOT deploy to production automatically.** Android review source: `11.0.72+342`,
descended from the signed 341 release and uploaded iOS source.
The signed APK is for installation testing: 152 regression checks and
105 Firebase/security checks passed before build. The workflow does not deploy
functions/rules/hosting, publish mobile stores or certify real Paystack settlement.
### Core changes
- New Paystack `/subaccount` route for approved drivers, with `percentage_charge: 20` credited to Asiye and 80% directly settled to driver's Paystack subaccount. Gateway fees default to Asiye.
- Each new card charge MUST identify the verified and assigned driver before `/transaction/initialize`, with `subaccount: ACCT_...`. A passenger is NEVER charged to Asiye's main account as a later-to-be-split payment.
- Go negotiated fares choose their driver before attempting payment. Parcel V2 dispatches and accepts a driver before checkout; the same driver receives the split and performs server-verified pickup. Any legacy fixed-fare path without an assigned approved driver fails closed for Card.
- Pool/Work requires a ready pool and accepted approved driver BEFORE collecting each passenger's card amount. Each passenger has a separate reference for the same driver's subaccount.
- Parcel creation, acceptance, cancellation, arrival, private PIN retrieval, PIN verification and completion now use authenticated backend endpoints. Shared Go/refund routes cannot bypass Parcel checks. Server-only completion markers and active booking locks resist client tampering.
- Checkout reserves one reference before contacting Paystack. Concurrent requests cannot create separate payable checkouts; an unknown provider response stays pending verification/support. Late charges on cancelled or reassigned trips require merchant review and cannot reactivate the trip or overwrite a completed refund.
- No new Wallet top-ups (manual EFT or Paystack). Wallet choice and menu entry are removed. All existing balances, historical top-up receipts, wallet transaction records, webhooks and support reconciliation data MUST be preserved. Prepare balance ledger review and lawful refund/return arrangements; never zero customer balances.
- Legacy `/transfer` initiation removed from live route. Historical Paystack `transfer.*` webhooks remain to account for transfers already initiated before migration; no automatic replacement bank transfers.
### Signoff required before live rollout
1. Obtain written Paystack activation approval and confirm South African subaccount bank validation, percentage and settlement behavior in sandbox.
2. Verify each driver's correct bank and ID, active subaccount, driver identity and vehicle approval. Never use one driver's subaccount for another driver's trip.
3. Run sandbox tests for Go negotiated fare, full/partial Club, parcel, cancellation/refunds, driver reassignment, double callbacks, cash payments, multiple passenger IDs, all payment methods. Confirm Paystack transaction includes subaccount and amount; Asiye bears processing fees.
4. Reconcile every legacy wallet balance, uncleared EFT and historical payout through admin/support. Do not delete old ledger state. Update legal policies and customer notices.
5. Update and test signed APK/AAB and iOS builds, and server rule protections before enabling card checkout in Production. Confirm final app version used by Play/App Store.
6. Payment descriptions must not claim funds are held in escrow: Paystack controls settlement under its applicable schedule.
### Important
`is_verified` on the Paystack subaccount must be true before a driver may receive card-funded trips. New Paystack subaccounts may initially be pending verification. Paystack's official subaccount API and account verification prerequisites are authoritative.
