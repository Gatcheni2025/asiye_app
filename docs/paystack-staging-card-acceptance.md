# Asiye Paystack Card — isolated staging acceptance

**Status:** NOT ACCEPTED until every checkpoint below is verified with evidence.
This checklist is for `asiye-paystack-staging` only. No writes to production Firebase `asiye-80386`.
Never use `sk_live_` keys, launch live Card, or settle to a real driver's bank account during these TEST checks.

## A. Deploy and inventory
- [ ] The owner-authorized Cloud Shell deployment exits successfully using `scripts/deploy_paystack_staging_cloud_shell.sh`.
- [ ] All 37 reviewed functions exist and are active **in staging**. Local export discovery alone is not a deployed-inventory test.
- [ ] Staging Realtime Database rules match the reviewed source; no unexpected public write paths.
- [ ] Staging passenger and driver web previews load, have no production Firebase URLs, and have no-index headers.
- [ ] TEST-only `PAYSTACK_SECRET_KEY` is in staging Secret Manager; no secret is logged, exported, or embedded in Web assets.

## B. Subaccount and checkout
- [ ] Verify the configured TEST subaccount is Paystack TEST code `ACCT_vf0h70jhkw7qall`; dashboard status Verified.
- [ ] The subaccount currently points to **Asiye Group banking details for testing only**. Never treat a TEST split as evidence of settlement into an actual driver's bank account.
- [ ] Confirm merchant `percentage_charge=20`, with 80% allocated to the TEST subaccount before provider fees. Check Paystack transaction detail as well as backend ledger.
- [ ] On an authorized synthetic driver and passenger staging account, book an Asiye Go ride and choose Card.
- [ ] Only one Paystack TEST transaction reference is created for the booking; no wallet top-up and no customer live-charge.
- [ ] Complete checkout with Paystack test credentials in the provider's TEST checkout. Assert correct amount in minor units, currency ZAR, TEST domain, transaction reference, and subaccount code.
- [ ] Failed, expired, or abandoned Card checkout does not release pickup/start or mark the ride paid.

## C. Provider verification and ride safety
- [ ] Verify `verifyTripCardPayment` checks the actual transaction with Paystack and rejects a wrong reference, amount, domain, currency, payer, or subaccount.
- [ ] Valid Paystack `charge.success` webhook signature is verified using the **raw** request body and TEST key; missing/invalid signatures return failure.
- [ ] Repeat the same signed webhook: no duplicate ledger credit, booking transition, or payout/settlement.
- [ ] Driver sees the accepted booking and appropriate state. Driver must enter the **system-generated pickup PIN before departure**, never after drop-off.
- [ ] Cash bookings are never blocked waiting for a completed Card payment; they remain separate.
- [ ] Confirm app restart restores the passenger's and driver's active trip without bypassing PIN or charging twice.

## D. Asiye Club and Parcel
- [ ] Club booking displays the server-consistent 30-minute countdown for passenger and driver; confirms pooling and 30-minute negotiation when appropriate.
- [ ] Card settlement/hold logic for Club does not charge passengers incorrectly while waiting for others.
- [ ] Parcel Card checkout verification precedes driver pickup PIN; no parcel pickup without authorized payment and server-verified PIN.
- [ ] Cancellation paths prohibit pickup after cancellation and preserve payment/refund eligibility.

## E. Refunds, webhooks, and reconciliation
- [ ] Request a permitted Paystack TEST refund and record refund reference, amount, currency, original payment, and provider status.
- [ ] Signed refund webhook synchronizes ledger once. Duplicate/out-of-order refund events do not change unrelated trips.
- [ ] No Asiye-funded post-trip bank transfer disburses the driver's 80% when Paystack is already settling the subaccount split.
- [ ] A staging report shows transaction reference, gross fare, subaccount share, Asiye share, provider fee allocation, status, and any refund, **without bank account numbers or secrets**.

## F. Release gate
- [ ] Execute native Android/iOS TEST booking and Card return flows on supported devices; check background/resume/relaunch.
- [ ] Obtain written Paystack confirmation for the **live driver subaccount** approach, merchant compliance pages, facial-scan privacy disclosures and refund/cancellation policy.
- [ ] A REAL driver-owned Paystack LIVE subaccount is verified in live mode **separately**; the Asiye Group TEST account is never used as a live driver payout destination.
- [ ] Only after verified staging evidence, authorized review, and production rollout plan may PR #19 be taken out of draft and live Card enabled.

**Never submit card numbers, bank details, secret keys, Firebase service account JSON, or raw debug logs to GitHub issues or chat.**
