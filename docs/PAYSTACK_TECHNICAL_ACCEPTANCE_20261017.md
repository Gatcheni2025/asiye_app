# Paystack technical acceptance — 17 October 2026

Review branch: `fix/paystack-subaccounts-cash-card-no-wallet`, PR #19.
Baseline: build 345 source `c679e1666450bb9986188d70b328a64905c61e36`.
This backend review does not publish another mobile build or activate live payments.

## Completed safeguards

- Card checkout requires the assigned, approved driver's active and verified Paystack subaccount, with 20% allocated to Asiye and the provider fee borne by Asiye. Missing or wrong-mode subaccounts fail before checkout.
- New card ledgers record `paystackDomain`. Provider verification must return the matching Test/Live domain, reference, ZAR amount and driver subaccount before pickup can unlock.
- A live key alone cannot enable new checkout. `paymentLaunch/paystack` must contain `liveEnabled: true`, a nonempty written Paystack `approvalReference`, and a nonempty `validationReference` pointing to accepted technical evidence. The default is disabled. Firebase rules deny reading/writing this path from passenger, driver **and administrator client sessions**; only trusted server/deployment access can record approval. No launch record is created by these changes.
- Existing payment verification, historical reconciliation and refunds remain available while new live checkout is gated. New EFT/Paystack Wallet top-ups and Wallet bookings remain disabled; historical balances and records are preserved.
- Refunds require an authenticated owner and a cancelled, unstarted booking. Active/completed/started services require support review. Work passenger cancellation applies to the affected unboarded member; it does not refund another member.
- Client cancellation and Firebase cancellation triggers share an atomic refund reservation. A lost response remains `refund_unknown`; retrying cannot submit a second refund. Provider-verified results reconcile it through `refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed` and `refund.processed` notifications or the owner's payment-verification endpoint.
- Refund notifications are HMAC checked and re-fetched from Paystack. Amount, currency, transaction and domain must match. A forged event, late charge or older pending callback cannot reverse a completed refund. `processed` records provider completion, not a promise that the customer's bank has already credited the money.
- Support-initiated refunds in Paystack's dashboard also reconcile held/captured Parcel and ride payments through verified notifications; they disable payment readiness and never create another refund. Work refund updates leave other passengers' paid ledgers intact.
- Trip settlement requires an ongoing/completed service and an atomic held-to-captured transition. It cannot overwrite a reserved refund. Direct driver settlement is performed by Paystack; trip completion initiates no replacement bank transfer.
- Checkout return URLs derive from the current Firebase project, so an isolated staging checkout does not return to production.

## Verification and deployment

Engineering validation runs in the existing Paystack migration and Firebase Security Validation workflows. The exported-handler suite uses isolated RTDB emulator namespaces, simulated identities and simulated Paystack responses. It does not certify actual provider charges, physical devices or bank settlement.

The final local source passed **303 checks: 82 booking/payment regressions, 74 authentication/booking regressions and 147 Firebase authorization/UI/exported-handler checks**, with zero failures, cancellations or skips. Workflow YAML, JavaScript syntax and the 38-function staging manifest were validated. The first review commit also passed GitHub Firebase Security Validation and Go negotiation checks; the final source is rechecked in CI.

The first read-only infrastructure check confirmed that the TEST key and production Firebase credential are configured. Production had 57 active endpoints, but was missing `configureDriverCardPayout`, all five secure Parcel endpoints, and `declineGoFareOffer`; its rule digest differed from this review. The assigned TEST subaccount variable, isolated staging project and staging credential were absent. These are observed configuration/deployment gaps, not evidence of completed provider or device acceptance.

`Paystack Technical Readiness` performs **read-only** checks using existing GitHub Actions configuration. Its artifact records configured prerequisites, the active production endpoint inventory and whether deployed database rules match reviewed rules. Function names alone do not prove source revision. It does not deploy or read customer records, enable payments, charge cards, refund funds, or reveal keys/bank details.

Configure the following under repository Settings → Secrets and variables → Actions:

| Name | Type | Purpose |
| --- | --- | --- |
| `PAYSTACK_TEST_SECRET_KEY` | Secret | Paystack `sk_test_…` key; never a live key |
| `PAYSTACK_TEST_DRIVER_SUBACCOUNT` | Variable | The approved test driver's `ACCT_…` subaccount, configured with 20% main-account commission |
| `FIREBASE_STAGING_PROJECT` | Variable | Isolated Firebase project; **must not** be production `asiye-80386` |
| `FIREBASE_STAGING_SERVICE_ACCOUNT` | Secret | Deployment credential belonging to that isolated staging project |

The existing `FIREBASE_SERVICE_ACCOUNT_ASIYE_80386` / `FIREBASE_SERVICE_ACCOUNT` credential is used only to read production deployment inventory in the new readiness workflow.

After configuration, manually run `Deploy Paystack Review to Isolated Staging` **on this review branch**. The workflow re-runs security tests, refuses a production project or live key, sets the staging TEST secret, and deploys the functions in `scripts/paystack_function_manifest.json` with the matching database rules. It does not touch production or mobile stores. The staging project must already have billing, the relevant Firebase services and its Realtime Database enabled; use a region compatible with the test configuration.

Configure the **Test Mode** Paystack webhook URL to the staging `paystackWebhook` function before the provider journey. Use `Paystack Test-Mode Card Preflight` in `check` mode for read-only account validation; `initialize` creates a test checkout and `verify` validates its paid reference. A checkout URL or a passing initialize request is not proof of payment, Firebase fulfillment, refund or settlement.

## Acceptance still required before live activation

1. Paystack-hosted TEST card success, decline, timeout/retry, app closure/return, duplicate callback and refund journeys for Go, each Work member and Parcel. Confirm exact driver/subaccount, 80/20 allocations and platform fee bearer in provider records. Test one member paying while another fails, and verify that pickup remains locked until all required payments are ready.
2. Driver/passenger device acceptance of arrival/GPS, private Parcel PIN retrieval, retry lockout, pickup, cancellation, cash collection, completion and restart/resume on the supported Android/iOS combinations. Verify the same reviewed backend/rules revision as the client.
3. Paystack's written merchant activation approval and confirmation of the applicable South African settlement arrangements. Test transactions do not move real funds or prove bank settlement; reconcile actual settlement only after authorized activation.
4. Reconcile historical Wallet credits, outstanding EFTs, charge/refund disputes and historical transfers without deleting balances. This source review does not inspect or certify the customer ledger.
5. Publish/retain the verified company, Terms, Privacy/face scan, Refund/Cancellation and driver compliance pages at `https://asiye.cloud`; give Paystack the live links for final review.

Do not use the older `Deploy Paystack Test Functions` workflow for this rollout: it checks out `security-payments-phase5` and targets production. Use the isolated staging workflow above until technical acceptance and activation approval are complete.
