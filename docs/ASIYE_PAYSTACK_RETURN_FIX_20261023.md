# Paystack TEST return correction — 23 October 2026

**Status: staging return repair deployed and independently verified, 23 October 2026.** The operator ran `--resume-after-function` from helper `15a80b6`. The screenshot confirms `FUNCTION_DEPLOYMENT: SKIPPED`, `CALLBACK_IAM: UNCHANGED`, exact callback HTTP 200, **43/43 functions ACTIVE**, no missing/nonactive functions, matching RTDB rules, **46/46 hosted files matching**, `STAGING_INFRASTRUCTURE_READBACK: PASS` and `RETURN_REPAIR: VERIFIED`. The assistant separately reran both public checks: the callback matches the reviewed page exactly and Hosting matches **46/46**, with `PUBLIC_HOSTING_READBACK: PASS`.

The public recheck reads no customer records and does not independently attest authenticated inventory, rules or all deployed function sources. This checkpoint verifies deployment/reachability of the return repair; the passenger's actual return, provider success, authenticated webhook and transaction split still require acceptance on the existing payment. No further deployment is needed for this repair.

The earlier function-only CLI deployment exited nonzero and its first helper suppressed/deleted the error. The callback was subsequently independently verified before the web-only resume. The precise cause of that earlier CLI exit remains unknown. Future errors preserve private diagnostics; do not infer a historical cause from the successful later readback.

## Observed failure

The reported checkout returned to the correct staging `paystackPaymentReturn` URL, which responded with Google's platform-level **403 Forbidden** page. Independent public GET probes confirmed:

| Endpoint | Response | Meaning |
| --- | --- | --- |
| `paystackPaymentReturn` | 403, platform Forbidden | Browser return is blocked before the handler can render. ACTIVE inventory alone did not establish public reachability. |
| `paystackWebhook` | 405 from the handler | Publicly reachable; GET is correctly rejected. This does not prove Paystack delivered this transaction's signed webhook. |
| `verifyTripCardPayment` | 405 from the handler | Publicly reachable; authenticated POST is required. |

The staging console initially showed an R86 Card booking at `payment_required` and later showed it `in transit`. Checkout completion was reported by the user; the UI status does not independently certify provider success, split allocation or webhook delivery for this payment. Do not cancel this Card booking, erase its records or create another charge to work around the return failure.

## Source correction

- The navigation-only callback has a same-project web return instead of relying entirely on a native custom URL scheme. Staging never sends a payment into the production-configured installed app.
- Production mobile return retains the native link and a web fallback; no production deployment is included.
- Browser checkout uses the current tab; `noopener` returning null can no longer cause both a popup and a same-tab checkout to open.
- After authenticated profile and trip restoration, reload/focus/visibility recovery verifies the saved trip payment reference server-side. Concurrent resume events share one check. A mismatched reference, signed-out session or unsuccessful provider result cannot confirm pickup or clear the recovery marker.
- The callback itself never marks a payment paid, reads customer records or initializes a checkout. Existing provider verification, signature validation, amount/currency/subaccount checks and pickup PIN gates remain authoritative.

## Completed web-only resume

The operator completed the following command. It is retained for recovery reference; do not rerun it for this verified checkpoint:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/repair_staging_paystack_return.cjs --resume-after-function
```

Resume mode requires the exact reviewed public callback page before proceeding. It validates the pinned staging project, human operator, review branch, tracked source and ACTIVE callback identity, then publishes the staging web preview if needed and runs the full inventory/rules/46-file readback. It never deploys Functions, changes IAM or reads the Paystack secret. If the callback no longer matches, it stops before any local cloud command or mutation.

Observed result: `FUNCTION_DEPLOYMENT: SKIPPED`, `CALLBACK_IAM: UNCHANGED`, `STAGING_HOSTED_FILES: MATCH=46/46`, `STAGING_INFRASTRUCTURE_READBACK: PASS`, then `RETURN_REPAIR: VERIFIED`. The helper's 21 selected tests passed before publishing; the separate 24-test local run also included the three offline-log tests.

## Apply a callback repair only when needed

In the existing Cloud Shell checkout:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/repair_staging_paystack_return.cjs --apply
```

The apply helper validates project `asiye-paystack-staging` / `1000800408896`, the human operator, review branch, clean reviewed source and ACTIVE Gen2 callback identity. When a function deployment is needed, it privately checks that Paystack uses a TEST secret and deploys **only `paystackPaymentReturn`**. It restores public invocation **only for that navigation-only Cloud Run service** if missing, and publishes the staging web assets. It reads back the exact reviewed callback HTML and the existing full inventory/rules/46-file Hosting audit. It changes no project-level IAM, other endpoint policy, database rule, ledger, payment or production resource.

The helper refuses restricted ingress or an unexpected resource identity rather than changing those settings automatically. Future nonzero Firebase deployments preserve CLI output and a fresh debug log in a private `asiye-return-logs-*` folder in Cloud Shell home (folder 0700, files 0600), outside disposable source. It prints only fixed failure-category signals and the local log location; do not upload raw logs. A callback-success message plus the sole known cleanup-policy error permits proceeding to mandatory live readback. Other errors stop without an automatic retry. The original failed attempt's deleted log cannot be reconstructed by this correction.

Read-only public diagnosis is also available:

```bash
node scripts/repair_staging_paystack_return.cjs --check
```

Expected applied result: callback HTTP 200 with `REVIEWED_RETURN_PAGE=true`, unchanged payment endpoints HTTP 405 on GET, `STAGING_INFRASTRUCTURE_READBACK: PASS`, then `RETURN_REPAIR: VERIFIED`.

## Recover the existing payment

Return to the original staging passenger tab and select **Check payment**. After publishing the client fix, reloading or resuming that tab also verifies its saved reference. This reuses the original payment; it does not initialize another checkout. Continue only after the server confirms payment, then verify driver pickup navigation and the pickup PIN. Record actual Paystack TEST allocation and authenticated webhook delivery separately; this return correction does not certify either.

Local validation: 52 focused/regression tests and four deployed-source utility tests passed. The exported-handler emulator suite and GitHub checks are recorded with the resulting commit/run; none are real provider transactions or device acceptance.

Resume/logging correction: 24 focused tests passed, including the real command orchestrator with simulated cloud boundaries, which publishes only Hosting and rejects every unexpected cloud command; private log persistence after disposable source removal; strict cleanup-warning handling; and callback/payment-resume regressions. These tests do not deploy staging.

At helper `15a80b6`, [source gate 39949344956](https://github.com/Gatcheni2025/asiye_app/actions/runs/39949344956), including exported-handler emulator and browser jobs; [Firebase security 39949349108](https://github.com/Gatcheni2025/asiye_app/actions/runs/39949349108); and [Paystack regression 39949344966](https://github.com/Gatcheni2025/asiye_app/actions/runs/39949344966) all passed. This deployment checkpoint update changes documentation only.
