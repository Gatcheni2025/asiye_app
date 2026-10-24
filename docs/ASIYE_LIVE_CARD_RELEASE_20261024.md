# Asiye release and LIVE Card activation — 24 October 2026

The owner has requested release preparation and LIVE Card activation. Continue that work without asking again for general permission. Production is **asiye-80386 / 531902350858**, in `us-central1`; isolated TEST staging remains **asiye-paystack-staging / 1000800408896**. The requested payment model remains Cash/Card, direct driver-owned Paystack subaccounts, 80% driver / 20% Asiye, with processing fees borne by Asiye. Historical Wallet/EFT records remain available for reconciliation.

**Activation has not been performed.** The current evidence establishes a production deployment gap. The server's existing `paymentLaunch/paystack` approval gate is retained; a Live merchant account or a Live API key alone does not open checkout. A source inspection or successful build cannot supply missing provider/device acceptance.

## Current evidence

| Check | Verified result and limits |
| --- | --- |
| Reviewed source | Review branch `fix/paystack-subaccounts-cash-card-no-wallet`, PR [#19](https://github.com/Gatcheni2025/asiye_app/pull/19). Checkpoint `89629e8`; runtime is unchanged from staging-verified `a017820`. `main` is an older release source. |
| Staging | 43/43 functions ACTIVE; reviewed rules and 46/46 hosted files match. Rating endpoint source MATCH=1/1; full exported-handler/rules/UI suite passed 208/208. |
| Application acceptance | Operator confirmed Cash early completion with a different passenger login. The rating repair is deployed; actual save/reopen confirmation remains pending on the completed Cash ride. No new booking/payment is needed for that rating check. |
| Paystack merchant | Owner reported the merchant account Live on 21 October. Preserve that fact. The actual approval/validation references required by the server launch record have not been reviewed here. |
| Fresh cloud inventory | The read-only [technical-readiness run 40061425242](https://github.com/Gatcheni2025/asiye_app/actions/runs/40061425242), rerun 24 October at **10:37 SAST**, finds 58 active production functions, six missing reviewed endpoints and different production rules. Staging rules now match; the earlier staging mismatch is resolved. |
| Missing production endpoints | `configureDriverCardPayout`, `createParcelRequestSecure`, `acceptParcelRequestSecure`, `cancelParcelBookingSecure`, `getParcelPickupPinSecure`, `parcelTripActionSecure`. Existing function names alone do not attest their deployed code. |
| Rules | Production digest `195fc06e9b49f37aabf990ebc0de0c24020b5f9dfc15df05c61b56c655a4bf8a`; reviewed/staging digest `315cac1dc85c2bd65805a45f4136ebcaad90fbeb78136e963a125df717ff041a`. |
| Provider evidence | TEST subaccount prerequisite passes, including active/verified 80/20 configuration. Real checkout, signed webhook, cancellation/refund and final device acceptance remain separately unverified. The Asiye Group TEST subaccount must never become a real driver's LIVE payout destination. |
| Mobile | Existing Android 11.0.77 (347) / iOS 46522.0.5 (95526) candidates predate these runtime changes. Prepare fresh signed packages from the final accepted source using unused store build numbers. No new binary or store publication is certified here. |

The refreshed readiness artifact is ID `12554511490`; its downloaded ZIP SHA-256 was independently verified as `115921cf194ad47459c7baf2b0c693c0ba21d9ea5ae5e14290b1087b6bc593b5`. Its source is `43ee994`; the subsequent `a017820` commit only fixes a test fixture and `89629e8` only records deployment evidence. The runtime/rules checked in that report are therefore unchanged at the reviewed deployment checkpoint.

## Prepared production inspection

`scripts/production_card_preflight.cjs` checks the production project/number, reviewed inventory, rules, public assets and exact payment-return page. It inspects the **numeric Secret Manager versions actually bound to eight payment/refund functions**, including Gen1 triggers; all must contain the same LIVE key. It prints only safe result categories. It also reports the existing launch gate without modifying it. An optional exact driver profile ID checks that driver's stored owner/bank suffix against an active, verified LIVE ZAR subaccount with 20% main-account commission. It does not scan customer collections or print identities, keys, account details or approval references.

The production scope is **42 reviewed functions** and **43 selected public files**: the staging-only `adminStagingTestConsole` and its three testing-page files are excluded. This is a readback scope, not an instruction to rebuild every existing production function or delete legacy exports. Public checks distinguish content mismatch, HTTP errors and unavailable reads. A failed network read is not evidence of different deployed content.

The new **Production Card Release Preflight (read only)** workflow runs the inspection with existing production credentials. The script can also run in the owner's human-authenticated Cloud Shell. Use a clean review checkout so locally generated staging wrappers do not contaminate production comparisons:

```bash
cd ~
git clone --single-branch --branch fix/paystack-subaccounts-cash-card-no-wallet https://github.com/Gatcheni2025/asiye_app.git asiye-production-release-review
cd ~/asiye-production-release-review
gcloud config set project asiye-80386
node scripts/production_card_preflight.cjs --check
```

If that dedicated checkout already exists, update it with `git pull --ff-only` instead of cloning over it. For driver-specific inspection, append `--driver=THE_EXACT_DRIVER_PROFILE_ID` to `--check`, keeping the real ID in the private operator session. No key is accepted as a command-line argument. `--public-only` needs no cloud credentials.

Passing these infrastructure checks still prints `DEPLOYED_FUNCTION_SOURCE_REVISION: NOT_ATTESTED`, leaves actual provider/device acceptance uncertified, and never enables payments. Source attestation must compare immutable deployed build archives/versions with the accepted runtime before activation; inventory presence is insufficient. Any unavailable secret/rules/source read is a missing result, not permission to weaken the gate.

## Production rollout and activation sequence

| Stage | Concrete work and exit condition |
| --- | --- |
| 1. Close acceptance evidence | Retain the current staging deployment. Confirm rating save/reopen on its existing completed Cash ride. Record TEST Card return, exact fare/ZAR/reference, authenticated webhook, correct driver's 80/20 allocation and fee bearer, retry/decline and eligible refund; complete the supported Go/Club/Parcel and native device cases in the [acceptance register](ASIYE_347_STAGING_TO_RELEASE_ACCEPTANCE_20261022.md). Keep real references and personal data private. |
| 2. Record production state | Read the current launch state, bound secret versions, function metadata/source versions, rules, Hosting release and relevant configuration. Back up them privately before promotion. Reconcile outstanding Wallet/EFT/refund obligations without deleting balances or ledgers. Review existing Card references/webhook mode before changing a production key. |
| 3. Promote accepted source | Use the final reviewed branch/SHA, an explicit production project, the matching rules and production-configured web assets. Review which endpoints differ, add the six missing secure endpoints, and update changed existing endpoints. Preserve unrelated legacy functions and historical financial data; exclude staging test tools. Keep new LIVE checkout off while deploying. Read back immutable deployed source, rules, public callback and assets. |
| 4. Configure LIVE credentials | If the bound key is already correct and LIVE, retain it. Otherwise enter the LIVE secret directly into production Secret Manager through the Firebase CLI's secret prompt, then redeploy its bound payment/webhook/refund functions. Never paste a secret into chat, GitHub, a dispatch input, a command argument or web assets. Recheck numeric deployed bindings; checking only `latest` is insufficient. Do not change the staging TEST secret. |
| 5. Configure LIVE provider routes and drivers | In Paystack **Live Mode**, set the webhook to `https://us-central1-asiye-80386.cloudfunctions.net/paystackWebhook` and callback to `https://us-central1-asiye-80386.cloudfunctions.net/paystackPaymentReturn`. Keep Test Mode routes on staging. Register each real approved driver's own bank/identity through the production payout setup; verify ownership, active/verified LIVE ZAR status and `percentage_charge: 20`. Do not copy TEST mappings. |
| 6. Enable server checkout | After the accepted evidence and immutable production readback are recorded, the trusted production operator records the real `approvalReference` and `validationReference` with `liveEnabled: true` at `paymentLaunch/paystack`. Preserve prior metadata and use a transaction/conditional write with readback. This enables new LIVE checkout generally; the current gate is not a pilot-driver allowlist. Do not put dummy references into it. Passenger/driver/admin clients remain unable to write the path. |
| 7. Verify a controlled LIVE booking | Use distinct passenger/approved-driver accounts and an agreed, authorized fare. Verify server-confirmed LIVE amount/ZAR/reference, signed webhook, direct driver subaccount allocation, pickup navigation only after verification, PIN at pickup, return/restart and completion. Record actual provider settlement when it occurs; TEST mode or the app's internal `held` label does not establish bank settlement. |
| 8. Package and distribute | Freeze the accepted final runtime. Prepare the next unused Android versionCode and fresh iOS build number, signed with the established identities. Verify the actual APK/AAB/IPA, final store SDK/native requirements and installed/upgrade behavior, then internal Play/TestFlight acceptance before public release. Existing 347 packages cannot pick up bundled fixes solely through Hosting. |

The mobile package validator now checks the driver completion screen and shared history assets, in addition to the existing payment/auth/trip files. A signed package with an old rating screen or history file fails even if its payment files are current. Tests exercise the default guard on APK, AAB and IPA layouts.

If LIVE checkout needs to stop, the operator sets only `paymentLaunch/paystack/liveEnabled` false with conditional readback. That prevents new initialization through the reviewed gate while preserving verification/refund/webhook processing and existing ledgers. Disabling checkout is not cancellation, refund or settlement reversal. Restore application/backend versions only after checking compatibility with the new server-owned trip fields; do not restore weaker rules as a blanket rollback.

## Provider references checked for this preparation

- [Paystack API keys and authentication](https://paystack.com/docs/api/): TEST and LIVE key modes.
- [Paystack split payments](https://paystack.com/docs/payments/split-payments/): percentage allocation and fee bearer.
- [Paystack webhook authentication](https://paystack.com/docs/payments/webhooks/): verify the `x-paystack-signature` before processing an event.
- [Paystack server-side transaction verification](https://paystack.com/docs/payments/verify-payments/).
- [Firebase secret configuration](https://firebase.google.com/docs/functions/config-env): deploy bound functions after updating a secret.

No production deployment, key change, launch write, live charge/refund or public store release has been performed by this preparation.
