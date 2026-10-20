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
| `FIREBASE_STAGING_WEB_CONFIG` | variable | Public Firebase WEB app config JSON, with the isolated staging project ID, API key, auth domain, RTDB URL, storage bucket, sender ID and web app ID |

The authorized Paystack account owner must create/verify a designated TEST subaccount, confirm the driver/bank mapping and configure the variable. Paystack's subaccount setting `percentage_charge: 20` is the **main Asiye account's 20%**; the driver receives the remaining 80%. The standard Paystack split uses `bearer: account` to make Asiye bear transaction processing fees. A TEST subaccount may show `is_verified: false`; **this reviewed service intentionally rejects it for real booking checkout until Paystack verification succeeds**. Do not change that value in client data or weaken live verification to make the test pass. Do not put bank numbers, keys or driver identification documents in Git history, GitHub Actions dispatch inputs or issue comments. A TEST subaccount can report `is_verified: false`; this does **not** satisfy production driver verification and cannot be bypassed to make staged Card bookings appear successful.

Get `FIREBASE_STAGING_WEB_CONFIG` from Firebase Console → isolated staging project → Project settings → Your apps → Web app → SDK setup and configuration → Config. Copy only the public web config object, as valid JSON with double-quoted keys/values. It must identify the `FIREBASE_STAGING_PROJECT`; never copy production Firebase web configuration. The web preview builder fails closed if the RTDB URL, storage bucket, auth domain or project do not agree. Register the staging hosting domain for Firebase Auth and configure test-only allowed OAuth origins as needed. The built-in dry-run CI substitutes synthetic Firebase identifiers and does not deploy a test website.

Provision staging Firebase Authentication, Realtime Database, Cloud Functions, Hosting, billing and appropriate approved test users. Ensure each staging app/web client uses **staging Firebase configuration**, not the existing production project. Configure only the Paystack **Test Mode** webhook to `https://us-central1-<staging-project>.cloudfunctions.net/paystackWebhook`. Do not change the Live Mode webhook to point to staging.

## 3. Controlled environment order

1. Run [Paystack Technical Readiness](../.github/workflows/paystack_technical_readiness.yml) against the review branch. It inventories TEST subaccount and both backend environments **read-only**. A missing function, mismatched rule digest or missing configuration is a blocker.
2. Run [Deploy Paystack Review to Isolated Staging](../.github/workflows/deploy_paystack_review_staging.yml) manually on the review branch. The workflow refuses production IDs and live keys, tests, prepares a separate **web-only staging preview**, deploys the secure functions/rules and the preview to the isolated staging project, then reads back functions, rules and hosted Firebase scripts. The staging URL is `https://<staging-project>.web.app/passenger-v2/index.html`, and the driver page is `/driver-v2/index.html`. Download `asiye-paystack-staging-verification` evidence. The web preview leaves the checked-in production clients untouched, has `noindex` headers, and does **not** provide staging-signed Android or iOS apps. An inventory match does **not** attest function source revision.
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
| Staging functions, rules and web preview readback | Workflow added, NOT YET RUN | Required |
| Real provider TEST checkout, webhook, refund | Not completed | Required |
| Passenger/driver physical-device acceptance | Not completed | Required |
| Historical Wallet reconciliation | Not certified | Required |
| Production source/rules match | Not certified | Required |
| Paystack final written approval | Not received in this record | Required |

Never report “production-ready” solely because the automated CI checks or candidate builds are green.
