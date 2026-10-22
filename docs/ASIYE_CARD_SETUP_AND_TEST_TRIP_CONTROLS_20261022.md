# Card setup recovery and staging trip-test controls

## Observed blocker

The passenger screenshot shows `prepareTripPayment` returning HTTP 409: the assigned driver is not registered with Paystack for direct settlements. The driver correctly waits at `payment_required`. Fare agreement and driver matching have succeeded; the missing driver/subaccount association prevents checkout from opening. The existing Paystack provider verification, 20% platform / 80% subaccount split and private fare agreement must remain enforced.

The later Cloud Shell screenshot shows a partial vehicle-policy deployment. `reviewDriverEnrollmentSecure`, `submitDriverEnrollmentSecure` and `submitWorkEarlyDepartureOffer` failed to update. The screenshot does not contain their underlying errors, so a specific cause is not established. Hosting was not attempted. Do not use `--resume-after-functions` to bypass this partial update.

## Changes

- Passenger payment failures stay visible on the booking. A missing driver subaccount gives a setup-specific message and **Try card payment again**. Profile/GPS events do not repeatedly retry a failed setup. After initialization, **Continue to Paystack** reuses the existing immutable checkout reference, while **I have paid · check confirmation** verifies it server-side.
- Driver Card waiting includes a direct **Card earnings · verify payment setup** link. The bank setup page can recheck verification; an already verified account is displayed independently of the optional bank-list request.
- Server-confirmed Card Go readiness automatically starts the protected `onWay` action and opens in-app pickup navigation. Repeated snapshots do not repeat navigation. Cancelled, unpaid, Cash, Club and Parcel states do not enter this Card Go branch. Pickup PIN verification still gates travel to the destination.
- `/admin/testing.html` uses isolated admin authentication and a separate `stagingTripTester` claim. The server refuses every action outside `asiye-paystack-staging` or with a non-TEST Paystack key. Enrollment-only reviewers and ordinary users cannot use these operations.
- The test administrator may link an existing Paystack TEST subaccount to an approved test driver. The server independently checks the exact code, TEST domain, active/verified status and `percentage_charge:20`. It never replaces a different or unresolved payout destination. This operation creates no transaction.
- Active Go, Club and Parcel test trips may be cancelled with a reason, expected status and exact trip-ID confirmation. Records and financial ledgers remain available. Matching passenger locks, driver locks, queued offers and notifications are cleared; a newer booking and its availability fields remain untouched. Audit records survive retries. A Card cancellation requests separate TEST refund review; the interface does not claim that a cancellation completed a refund.

## Apply the complete staging correction

This replaces the earlier dispatch-only and vehicle-only commands. It includes the vehicle restriction and recovers all three failed function updates.

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_card_test_tools.cjs
node scripts/grant_staging_trip_tester.cjs --self
```

The staging helper deploys the 23 functions in `scripts/staging_card_test_functions.json` in sequential batches of at most three, then compares every immutable deployed source archive with the reviewed commit. Only after that succeeds does it publish Hosting. It does not deploy rules or alter IAM. An unrelated or new deployment failure stops the run with Hosting untouched. Use `--resume-after-functions` only when all selected functions finished and exact source readback is expected to pass.

Target results, not deployment outcomes already observed:

```text
STAGING_CARD_TEST_FUNCTION_SOURCE: MATCH=23/23
FUNCTIONS: 43/43 ACTIVE | MISSING=0 | NONACTIVE=0
STAGING_RTDB_RULES: MATCH
STAGING_HOSTED_FILES: MATCH=46/46
STAGING_INFRASTRUCTURE_READBACK: PASS
STAGING_TRIP_TESTER: READY
```

If a function fails again, retain its actual error above the final summary. Do not change IAM or redeploy production to address a staging error.

## Test the actual journey

1. Open `https://asiye-paystack-staging.web.app/admin/testing.html`, sign in with the account assigned above and click **Check access again** if already signed in. The same account retains its separate driver-review role at `/admin/`.
2. Select the blocked Card booking. Under Driver Card setup, enter the existing verified Paystack TEST subaccount and click **Link TEST subaccount to this driver**. The earlier readiness fixture is `ACCT_vf0h70jhkw7qall`; confirm its current TEST dashboard status before using it. This fixture uses Asiye Group test banking and is not evidence of a real driver's LIVE bank settlement.
3. Refresh the passenger and driver staging pages. Use separate passenger and driver accounts/browser profiles for acceptance. Restore the same booking, then choose **Try card payment again**. Paystack must show the agreed fare, once, in TEST mode.
4. Complete the provider's TEST checkout. Confirm server verification uses the exact amount/currency/reference/subaccount/domain, the private ledger becomes held, and the driver's in-app route opens toward passenger pickup. Failed/abandoned checkout must not start pickup. Check the gross split in Paystack transaction details.
5. Check the system-generated PIN at pickup before departure. Cash retains its tested behavior and is collected after drop-off.
6. To reset a test, select its current record, enter a reason, type the exact ID and cancel. Both staging apps must release the cancelled trip. Check any Card payment/refund separately in Paystack TEST and the retained ledger.

Automated emulator/browser coverage simulates provider responses and identities. A real TEST checkout, webhook delivery, split allocation and device journey still require observed staging evidence. No LIVE charge or production publication is authorized by these changes.
