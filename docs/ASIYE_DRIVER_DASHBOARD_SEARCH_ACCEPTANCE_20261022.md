# Driver dashboard, optional contact and Go search acceptance

The 22 October staging screenshots confirm 41 active Functions, matching RTDB rules, 32 matching hosted assets and reviewer access. Later screenshots show an approved driver dashboard, a blank driver map and a passenger offer waiting for a driver.

## Findings and changes

The latest staging screenshots confirm the driver map, GPS watch and request listener are working, but no driver is found. The original Go filter accepted only legacy service labels (`go`, `ehailing`, `e-hailing`, `car`) and excluded the physical categories collected at registration. Asiye's supported physical vehicles are **Sedan and Hatchback only**. Registration and vehicle updates now offer exactly these categories, and server submission/review validates the same two values. The shared booking and dashboard gates exclude existing SUV/Minibus records, including conflicting nested/flat fields. Existing approved service-label profiles remain compatible when they do not declare an unsupported physical category. Approval, online, broadcasting, location, distance and seat-capacity checks still apply.

- `loadDriver` returned before map initialization, GPS, live profile updates and offer setup whenever a trusted contact was missing. Saving the contact reopened Safety without resuming driver startup. Trusted contacts now load after the driver is ready, with **Add later — go to dashboard** and **Save and continue**. An online driver or restored trip is not interrupted by the setup prompt. The driver's own linked OTP phone and enrollment approval are separate authentication requirements.
- Go retried at eight-second intervals only six times, then silently stopped. Open offers now continue at twenty-second intervals after the initial checks, including when a previously notified driver goes offline. Cancellation, a pending counter or assignment stops the search. A slow or failed HTTP response keeps the same request ID.
- The Go screen has animated radar and activity dots, real Searching/Driver found states, reduced-motion support, a route summary, the passenger's **offer** rather than an incorrectly labelled agreed fare, and one cancellation control. A matched driver still needs to accept or counter.
- Driver map startup proceeds independently of optional contacts and location permission. Loading errors show a message and **Retry map** instead of only a grey surface. Live GPS still updates the driver's database location for matching.
- Browser tests cover contact skip/save and responsive search; emulator tests cover a driver coming online later, receiving the request through the actual Driver V2 notification client and accepting the fare through the actual protected backend handler.

## Current staging update: supported vehicle policy

For the latest Card recovery and test-trip controls, use `docs/ASIYE_CARD_SETUP_AND_TEST_TRIP_CONTROLS_20261022.md` and its combined staging command. It includes this vehicle policy and repairs the subsequent partial deployment.

The earlier UI fix was deployed and a user screenshot confirmed **40/40** hosted files, **41/41** active Functions and matching rules. Those results predate this Sedan/Hatchback correction. Use this command instead of the earlier two-function dispatch update:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_vehicle_eligibility.cjs
```

This deploys the 17 functions listed in `scripts/staging_vehicle_eligibility_functions.json` from an isolated archive of the reviewed commit. The selection covers enrollment submission/review, Go and Club matching/acceptance, Parcel acceptance and driver/payment eligibility. It also includes the existing authenticated `submitDriverVehicleForReview` endpoint, bringing the reviewed staging inventory to **42**. An owner may submit only their own vehicle changes; submission resets approval and puts the driver offline. Enrollment-only reviewers retain their existing permissions.

The helper verifies all 17 immutable deployed source archives before publishing Hosting. It reads the existing staging SDK configuration, verifies the Paystack secret is TEST, preserves database rules, and does not migrate/delete driver data. Source verification must pass before Hosting is published. Expected target results, not observed deployment evidence:

```text
STAGING_VEHICLE_ELIGIBILITY_FUNCTION_SOURCE: MATCH=17/17
FUNCTIONS: 42/42 ACTIVE | MISSING=0 | NONACTIVE=0
STAGING_RTDB_RULES: MATCH
STAGING_HOSTED_FILES: MATCH=41/41
STAGING_INFRASTRUCTURE_READBACK: PASS
```

Use `--resume-after-functions` only after the function operations completed; it independently verifies the exact current source again before attempting Hosting. A cleanup-policy-only error after all selected successful function operations also requires independent source verification.

Regression coverage derives supported categories from the actual registration HTML. Emulator cases approve Sedan/Hatchback applications through the reviewer handler, submit/retry Cash and Card offers, and accept through the protected driver endpoint. Negative cases reject SUV/Minibus approval and vehicle updates, and prevent previously approved unsupported profiles from receiving or accepting new offers. Dashboard and shared Go/Club/Parcel eligibility tests include contradictory legacy category fields.

## Human acceptance

1. Refresh the staging driver tab. Choose **Add later** or save a trusted contact. The dashboard must appear without another login, with a visible map. Allow location for the site and select **Go Online**. Console should show **Driver Mapbox ready**, **Driver GPS watch started** and **Starting Asiye Driver request service**. The earlier **Driver Google Maps ready** message proves only the Places SDK loaded; it is not the driver map renderer.
2. Use a different passenger Google/Apple account in a separate browser profile or private window. The submitted screenshots showed the same UID on both sides. Separate accounts and browser storage are needed for meaningful passenger-to-driver acceptance.
3. Confirm registration and the vehicle editor offer only Sedan and Hatchback. Use an approved Sedan or Hatchback for a nearby Cash Go offer. Confirm the radar animates, **Driver found** appears only when real dispatch reports a candidate, and the driver's popup offers Accept/Decline/Counter.
4. Accept. Passenger must leave searching, keep the agreed fare and show the assigned driver. Continue pickup/PIN and completion acceptance from the release checklist.
5. Repeat with the driver initially offline. Submit a passenger offer, wait beyond the former 48-second limit, then bring the driver online. The same open request should reach the driver.
6. If map tiles still fail, use the visible map error and browser Console/Network result to distinguish token/network/graphics errors. No server or authentication permissions should be weakened to resolve a map error.

Actual device GPS, provider map tiles and a real two-account staging booking still require user acceptance. Synthetic UI/emulator checks do not authorize production or LIVE payments.
