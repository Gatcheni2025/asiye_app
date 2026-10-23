# Paystack TEST return correction — 23 October 2026

**Status: source correction tested; staging deployment still pending.** Google Cloud Console is unavailable from the assistant's browser. Run the targeted repair in the existing human-authenticated staging Cloud Shell session below. A GitHub commit does not update the deployed endpoint.

## Observed failure

The reported checkout returned to the correct staging `paystackPaymentReturn` URL, which responded with Google's platform-level **403 Forbidden** page. Independent public GET probes confirmed:

| Endpoint | Response | Meaning |
| --- | --- | --- |
| `paystackPaymentReturn` | 403, platform Forbidden | Browser return is blocked before the handler can render. ACTIVE inventory alone did not establish public reachability. |
| `paystackWebhook` | 405 from the handler | Publicly reachable; GET is correctly rejected. This does not prove Paystack delivered this transaction's signed webhook. |
| `verifyTripCardPayment` | 405 from the handler | Publicly reachable; authenticated POST is required. |

The staging console showed an R86 Card booking still at `payment_required`. Checkout completion was reported by the user; provider success, split allocation and webhook delivery have not yet been independently verified for this payment. Do not cancel this Card booking, erase its records or create another charge to work around the return failure.

## Source correction

- The navigation-only callback has a same-project web return instead of relying entirely on a native custom URL scheme. Staging never sends a payment into the production-configured installed app.
- Production mobile return retains the native link and a web fallback; no production deployment is included.
- Browser checkout uses the current tab; `noopener` returning null can no longer cause both a popup and a same-tab checkout to open.
- After authenticated profile and trip restoration, reload/focus/visibility recovery verifies the saved trip payment reference server-side. Concurrent resume events share one check. A mismatched reference, signed-out session or unsuccessful provider result cannot confirm pickup or clear the recovery marker.
- The callback itself never marks a payment paid, reads customer records or initializes a checkout. Existing provider verification, signature validation, amount/currency/subaccount checks and pickup PIN gates remain authoritative.

## Apply only the staging return repair

In the existing Cloud Shell checkout:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/repair_staging_paystack_return.cjs --apply
```

The helper validates project `asiye-paystack-staging` / `1000800408896`, the human operator, review branch, clean reviewed source, ACTIVE Gen2 callback identity and a TEST Paystack secret without printing it. It deploys **only `paystackPaymentReturn`**, restores public invocation **only for that navigation-only Cloud Run service** if missing, and publishes the staging web assets. It reads back the exact reviewed callback HTML and the existing full inventory/rules/46-file Hosting audit. It changes no project-level IAM, other endpoint policy, database rule, ledger, payment or production resource.

The helper refuses restricted ingress or an unexpected resource identity rather than changing those settings automatically. A permission or deployment error stops the operation; it does not grant extra deployer roles or retry a full deployment.

Read-only public diagnosis is also available:

```bash
node scripts/repair_staging_paystack_return.cjs --check
```

Expected applied result: callback HTTP 200 with `REVIEWED_RETURN_PAGE=true`, unchanged payment endpoints HTTP 405 on GET, `STAGING_INFRASTRUCTURE_READBACK: PASS`, then `RETURN_REPAIR: VERIFIED`.

## Recover the existing payment

Return to the original staging passenger tab and select **Check payment**. After publishing the client fix, reloading or resuming that tab also verifies its saved reference. This reuses the original payment; it does not initialize another checkout. Continue only after the server confirms payment, then verify driver pickup navigation and the pickup PIN. Record actual Paystack TEST allocation and authenticated webhook delivery separately; this return correction does not certify either.

Local validation: 52 focused/regression tests and four deployed-source utility tests passed. The exported-handler emulator suite and GitHub checks are recorded with the resulting commit/run; none are real provider transactions or device acceptance.
