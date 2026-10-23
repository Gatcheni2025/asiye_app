# Asiye Paystack Card — isolated staging acceptance

**Status:** NOT ACCEPTED until every checkpoint below is verified with evidence.
This checklist is for `asiye-paystack-staging` only. No writes to production Firebase `asiye-80386`.
Never use `sk_live_` keys, launch live Card, or settle to a real driver's bank account during these TEST checks.

**Deployment checkpoint, updated 23 October 2026:** the [current release review](ASIYE_347_STAGING_TO_RELEASE_ACCEPTANCE_20261022.md) records 43/43 staging functions ACTIVE and matching rules in the later operator audit. The independent public Hosting recheck passes 46/46 files. These resolve the earlier unconfirmed 37-function deployment checkpoint; payment acceptance below remains outstanding.

## A. Deploy and inventory
- [x] Later operator audit records 43/43 expected functions ACTIVE, none missing/nonactive, and `STAGING_INFRASTRUCTURE_READBACK: PASS`. Do not rerun the full deployment solely to complete this checklist.
- [x] The same recorded full audit confirms deployed staging Realtime Database rules match the reviewed source.
- [x] Independent public Hosting recheck on 23 October passes 46/46 reviewed files, including both roles' Firebase configuration, with no production identifiers and with no-index headers.
- [ ] Before the real TEST journey, rerun `node scripts/audit_347_staging_readonly.cjs` in the authenticated staging Cloud Shell checkout. If inventory, rules and Hosting still match, proceed without deployment. Local export discovery alone does not attest deployed inventory or function source.
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
