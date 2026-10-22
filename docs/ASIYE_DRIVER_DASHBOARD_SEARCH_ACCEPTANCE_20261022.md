# Driver dashboard, optional contact and Go search acceptance

The 22 October staging screenshots confirm 41 active Functions, matching RTDB rules, 32 matching hosted assets and reviewer access. Later screenshots show an approved driver dashboard, a blank driver map and a passenger offer waiting for a driver.

## Findings and changes

The latest staging screenshots confirm the driver map, GPS watch and request listener are working, but no driver is found. The remaining backend filter accepted only legacy service labels (`go`, `ehailing`, `e-hailing`, `car`) while enrollment supplies physical categories (`sedan`, `hatchback`, `suv`, `minibus`). Every newly enrolled category was therefore excluded. The fix accepts the four registration categories and legacy labels, normalizes case/whitespace and uses the approved nested vehicle category first. Existing approval, online, broadcasting, location and distance checks remain enforced.

- `loadDriver` returned before map initialization, GPS, live profile updates and offer setup whenever a trusted contact was missing. Saving the contact reopened Safety without resuming driver startup. Trusted contacts now load after the driver is ready, with **Add later — go to dashboard** and **Save and continue**. An online driver or restored trip is not interrupted by the setup prompt. The driver's own linked OTP phone and enrollment approval are separate authentication requirements.
- Go retried at eight-second intervals only six times, then silently stopped. Open offers now continue at twenty-second intervals after the initial checks, including when a previously notified driver goes offline. Cancellation, a pending counter or assignment stops the search. A slow or failed HTTP response keeps the same request ID.
- The Go screen has animated radar and activity dots, real Searching/Driver found states, reduced-motion support, a route summary, the passenger's **offer** rather than an incorrectly labelled agreed fare, and one cancellation control. A matched driver still needs to accept or counter.
- Driver map startup proceeds independently of optional contacts and location permission. Loading errors show a message and **Retry map** instead of only a grey surface. Live GPS still updates the driver's database location for matching.
- Browser tests cover contact skip/save and responsive search; emulator tests cover a driver coming online later, receiving the request through the actual Driver V2 notification client and accepting the fare through the actual protected backend handler.

## Current staging update: two Go dispatch functions

The earlier UI fix has been deployed and the user screenshot confirms **40/40** hosted files, **41/41** active Functions and matching rules. The category mismatch is in the backend and is corrected in both new-offer submission and continued search.

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_go_dispatch.cjs
```

This updates only `submitGoFareOffer` and `dispatchGoRideRequest` from an isolated archive of the reviewed commit. It verifies both immutable source archives, then reads back the staging inventory/rules/40 hosted files. It preserves the current website, database rules, driver profiles and roles. Expected result: **STAGING_GO_DISPATCH_FUNCTION_SOURCE: MATCH=2/2**, **41/41 ACTIVE**, **40/40 hosted files** and **STAGING_INFRASTRUCTURE_READBACK: PASS**. A cleanup-policy-only error after two successful operations is followed by independent source verification. Use `--resume-after-functions` if the deployment stopped after both functions finished.

New regression tests derive categories from the actual registration HTML. Emulator cases create an application, approve it through the real reviewer handler, submit and retry a Cash/Card offer, and accept it through the protected driver handler. Earlier fixtures using only legacy `go` labels did not catch this mismatch.

## Human acceptance

1. Refresh the staging driver tab. Choose **Add later** or save a trusted contact. The dashboard must appear without another login, with a visible map. Allow location for the site and select **Go Online**. Console should show **Driver Mapbox ready**, **Driver GPS watch started** and **Starting Asiye Driver request service**. The earlier **Driver Google Maps ready** message proves only the Places SDK loaded; it is not the driver map renderer.
2. Use a different passenger Google/Apple account in a separate browser profile or private window. The submitted screenshots showed the same UID on both sides. Separate accounts and browser storage are needed for meaningful passenger-to-driver acceptance.
3. Start a nearby Cash Go offer. Confirm the radar animates, **Driver found** appears only when real dispatch reports a candidate, and the driver's popup offers Accept/Decline/Counter.
4. Accept. Passenger must leave searching, keep the agreed fare and show the assigned driver. Continue pickup/PIN and completion acceptance from the release checklist.
5. Repeat with the driver initially offline. Submit a passenger offer, wait beyond the former 48-second limit, then bring the driver online. The same open request should reach the driver.
6. If map tiles still fail, use the visible map error and browser Console/Network result to distinguish token/network/graphics errors. No server or authentication permissions should be weakened to resolve a map error.

Actual device GPS, provider map tiles and a real two-account staging booking still require user acceptance. Synthetic UI/emulator checks do not authorize production or LIVE payments.
