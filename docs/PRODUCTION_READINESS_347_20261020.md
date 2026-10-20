# Asiye 347 — controlled production release checklist (20 October 2026)

**Branch:** `fix/paystack-subaccounts-cash-card-no-wallet` (draft PR #19).
**App candidates:** Android 11.0.77 (347), iOS 46522.0.5.
**Gate:** Keep new live Paystack Card checkout **OFF**. An APK/AAB/IPA or passing simulated tests is NOT merchant acceptance or proof of deployed backends.

## 1. Published website documentation — ready to submit for merchant review
- https://asiye.cloud/terms-of-service.html
- https://asiye.cloud/privacy-policy.html (live face scan, photograph, data handling)
- https://asiye.cloud/refund-cancellation-policy.html
- https://asiye.cloud/contact.html (registered company)
- https://asiye.cloud/driver-compliance.html

Do not conflate sending documents with Paystack's written approval.

## 2. Repository prerequisites — must be configured by the authorized account owner
In GitHub **Settings → Secrets and variables → Actions**:

| Setting | Type | Role |
| --- | --- | --- |
| `PAYSTACK_TEST_SECRET_KEY` | secret | Paystack `sk_test_...` only |
| `PAYSTACK_TEST_DRIVER_SUBACCOUNT` | variable | `ACCT_...` code for an assigned, active TEST driver subaccount with 20% platform percentage |
| `FIREBASE_STAGING_PROJECT` | variable | Valid isolated project (not `asiye-80386`) |
| `FIREBASE_STAGING_SERVICE_ACCOUNT` | secret | Credential for that staging project, with least-privilege deploy/inventory permission |

The authorized Paystack account owner must create/verify a designated TEST subaccount, confirm the driver/bank mapping and configure the variable. Do not put bank numbers, keys or driver identification documents in Git history, GitHub Actions dispatch inputs or issue comments. A TEST subaccount can report `is_verified: false`; this does **not** satisfy production driver verification and cannot be bypassed to make staged Card bookings appear successful.

Provision staging Firebase Authentication, Realtime Database, Cloud Functions, billing and appropriate approved test users. Ensure each staging app/web client uses **staging Firebase configuration**, not the existing production project. Configure only the Paystack **Test Mode** webhook to staging `paystackWebhook`.

## 3. Controlled environment order

1. Run [Paystack Technical Readiness](../.github/workflows/paystack_technical_readiness.yml) against the review branch. It inventories TEST subaccount and both backend environments **read-only**. A missing function, mismatched rule digest or missing configuration is a blocker.
2. Run [Deploy Paystack Review to Isolated Staging](../.github/workflows/deploy_paystack_review_staging.yml) manually on the review branch. The workflow refuses production IDs and live keys, tests then deploys staged functions/rules and reads them back. Download `asiye-paystack-staging-verification` evidence. An inventory match does **not** attest function source revision.
3. Run [Paystack Test-Mode Card Preflight](../.github/workflows/paystack_test_mode_preflight.yml), first `check`, then `initialize`, complete **only** a TEST card checkout, and use `verify` with the same reference. This preflight tests Paystack alone, **not** the Asiye webhook/booking end-to-end.
4. Execute staged, device-observed Asiye Go, Work/Club (one payer fails, others pay), and Parcel Card journeys with an approved TEST driver, including webhook authenticity, duplicate delivery, retry/return, refund/cancellation and pickup locks. Record transaction references and pass/fail evidence securely, not customer PII in issues. Verify fee bearer and driver allocation in the Paystack TEST dashboard.
5. Validate Cash journeys separately. Cash is paid after completion; PIN verification occurs **at pickup**, not dropoff. Verify Go counter/decline, 65%–95% offers, Work 30-minute timer/early departure, Parcel PIN retry lockouts, notification delivery, sign-out/restart trip restoration and passenger/driver cancellation.
6. Audit historical Wallet balances and pending EFT/refund/dispute items with finance/support. Do not delete historical ledgers. New Wallet funding/bookings stay disabled.

## 4. Production deployment — not yet authorized

After staging evidence, device acceptance, Wallet reconciliation and written Paystack merchant approval are reviewed by a human release owner:

- Back up the existing production RTDB rules and export relevant configuration. Record commit SHA and deployment window.
- Use a protected, reviewer-approved deployment process to deploy **the same reviewed function source and `database.rules.json`** to `asiye-80386`. Verify required exported endpoint inventory and read back production rules.
- Check project identity and TEST/LIVE secret and subaccount domain consistency. Do not deploy isolated staging keys, secrets or test accounts to production.
- Keep server `paymentLaunch/paystack.liveEnabled` **false** through deployment and smoke testing; do not write an approval record before all acceptance evidence is checked.
- Only after Paystack explicitly approves live processing, validate production driver `is_verified`, commission and fee bearer, and satisfy the server-only launch-approval record. Do a controlled low-value authorized Card transaction with Paystack's approved procedure and reconcile the actual provider settlement separately.
- Public Play/App Store rollout and live payment activation are **separate** release decisions. Restore the previous launch-off state immediately if any critical gate fails.

**Cannot be certified by repository-only work:** creation of TEST subaccount, staging billing/credentials, actual TEST checkout and webhook/refund journey, on-device behavior, deployed source SHA, customer Wallet reconciliation, Paystack's written merchant approval, or actual bank settlement.

## 5. Evidence register

| Evidence | Status as of source review | Sign-off |
| --- | --- | --- |
| Android 347 and iOS 46522.0.5 signed candidates | Build jobs succeeded in run 39131028973 | Candidate only |
| Firebase authorization / UI exported-handler tests | Reported passing in 347 run | Simulated environment |
| Isolated staging Firebase + TEST subaccount | Not configured in last readiness result | Required |
| Staging functions and rules readback | New workflow step added, NOT YET RUN | Required |
| Real provider TEST checkout, webhook, refund | Not completed | Required |
| Passenger/driver physical-device acceptance | Not completed | Required |
| Historical Wallet reconciliation | Not certified | Required |
| Production source/rules match | Not certified | Required |
| Paystack final written approval | Not received in this record | Required |

Never report “production-ready” solely because the automated CI checks or candidate builds are green.
