# Passenger-confirmed early trip ending

Status: implementation under review; staging deployment and device acceptance pending. Existing Paystack return repair remains verified at its recorded checkpoint.

For a started Go or Club/Work trip, the driver may request to end away from the destination. A fresh server location check retains normal completion within 300 metres of the destination. Missing/stale location also requires the confirmation flow. Parcel recipient/delivery completion remains separate.

1. Driver selects Complete trip. Away from the destination, the driver sees “You are not at your destination. Are you sure you want to end the trip here?” The warning states that the passenger must also agree and that the agreed fare stays the same. Cash receipt must be confirmed explicitly.
2. The trip stays `in_transit`, with tracking and active-trip locks preserved. The passenger sees **End trip here** and **Keep trip active**. Club/Work needs every active onboard passenger's approval.
3. Approval authorizes the existing settlement/completion path. The driver app resumes it once when it receives approval, including after restart. A failed attempt offers a retry; it cannot initialize another checkout. Early completion says **Trip ended here**, without recording false destination arrival.
4. Decline, withdrawal or no response keeps the trip active. Requests expire after five minutes. Old request IDs, changed driver/fare/group, wrong roles, direct RTDB consent edits and pre-pickup completion are rejected on the server.

The server freezes the approved completion before financial writes. Retries reuse that claim and the existing trip credit markers. Existing agreed fare, commission and Paystack allocation remain unchanged; this feature introduces no charge, refund or pro-rata fare adjustment. Cash early drop-off has its own confirmation timestamp; it never fabricates `dropoffArrivedAt`.

## Staging apply

After source/security checks pass, use the existing human-authenticated Cloud Shell:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_early_trip_end.cjs --apply
```

The helper pins `asiye-paystack-staging` / `1000800408896`, the review branch and TEST configuration. It deploys only three existing endpoints: `goTripActionSecure`, `settleTripPayment` and `clubDriverActionSecure`. It then compares the ACTIVE deployed immutable source archives with reviewed JS/package/wrapper bytes, publishes RTDB rules and Hosting, and audits 43-function inventory, rules and 46 web files. It does not change project IAM, production, customer trips or provider transactions. Errors preserve private Firebase diagnostics. To finish after a partial success without rebuilding Functions, use `--resume-after-functions`; the exact source comparison must pass first. `--check` performs only the source readback.

## Acceptance

Use two distinct staging accounts/devices, starting after valid pickup PIN verification. Check away-from-destination and unknown-location warnings; approval followed by exactly one completion/credit; decline and timeout preserving the live trip; driver withdrawal; pending/approved restoration after restart; stale-ID and wrong-account rejection; normal destination Cash/Card completion; and all-member consent on Club/Work. Confirm both apps release only this trip's pointers after completion. Keep the already-paid TEST reference when testing the existing Card trip. Native installed candidates require a new build after staging web/backend acceptance.
