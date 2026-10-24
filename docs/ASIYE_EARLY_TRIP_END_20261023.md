# Passenger-confirmed early trip ending

Status: staging deployment/readback verified at runtime source `538584af47a514df7444ed1da435488c0a1ef79f`; device acceptance is blocked by a reported passenger confirmation HTTP 403. Existing Paystack return repair remains verified at its recorded checkpoint.

The operator's 23 October deployment screenshot records selected source `MATCH=3/3`, 43/43 expected functions ACTIVE, deployed rules MATCH, hosted files MATCH=46/46 and `EARLY_TRIP_END_DEPLOYMENT: VERIFIED`. An independent public Hosting audit subsequently confirmed all 46 files. These results confirm deployment, not a successful passenger confirmation or completed trip. Do not repeat the three-function deployment to diagnose the 403.

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

## Passenger confirmation 403 diagnosis

The server's confirmation identity checks reject a login that does not own exactly one onboard passenger profile, including a mismatched Club member UID. They also reject the reserved driver's own login confirming as the passenger. Separate devices or browser tabs do not make the same Firebase login two independent people. Neither check should be bypassed to make a test pass.

The public endpoint independently returned its application JSON `Sign-in required.` with HTTP 401 for an unauthenticated empty POST. This confirms anonymous reachability; it does not establish the source of the passenger's authenticated 403. Capture only the failed request's **Response error message** if needed; never copy Authorization headers or tokens.

In the existing authenticated staging Cloud Shell, the following read-only diagnostic accepts the passenger UID shown by the passenger console. It resolves only matching passenger profiles and their single current trip, compares the same identity fields as the deployed handler, and prints booleans/reason categories. It does not print identities, records or references and cannot change a trip, payment, rule or deployment.

The first operator run on 24 October stopped at `STAGING_DATABASE_READ_HTTP_400`, before producing an identity result. The original helper unnecessarily queried `commuters/userUid`, which is not indexed in the reviewed/deployed rules. The correction follows the direct current-trip pointer first, uses only the indexed `authUid` lookup when necessary, and supports an optional exact current-trip ID for legacy bindings. It changes the read-only helper, not database rules or deployed application code. The original passenger HTTP 403 remains unresolved until an identity report or its actual response is obtained.

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/diagnose_staging_trip_end_403.cjs PASSENGER_UID_FROM_CONSOLE
```

If the passenger has only a legacy `userUid` binding and no discoverable current-trip pointer, append the exact current trip ID as a second argument. The helper then reads that trip and its participant profiles directly; it does not scan collections or reassign a booking.

- `DRIVER_SELF_CONFIRMATION_403`: use distinct passenger and driver accounts for acceptance. Do not reassign an existing paid trip or weaken the approval gate.
- `PASSENGER_OWNERSHIP_403`: inspect the signed-in passenger/profile binding before any targeted correction; do not grant broad permissions.
- `IDENTITY_CHECK_PASSES`: the identity checks do not explain this failure; use the actual HTTP response to distinguish application and platform denial.
- `STAGING_DATABASE_READ_HTTP_403`: the Cloud Shell diagnostic itself lacked read access. This is not a diagnosis of the passenger's original response.
