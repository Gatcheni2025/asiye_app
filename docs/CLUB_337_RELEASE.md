# Asiye 11.0.67 (337): secure Club booking

Status: implemented and locally verified; production deployment, signed Android builds and physical-device acceptance remain release gates. Do not publish automatically.

## Behavior

- New bookings and joins use authenticated server endpoints, not client request writes. The first booking starts a single server deadline exactly 30 minutes later. Joins and reloads never restart it.
- The nearest eligible driver is reserved while the group forms. Driver and passenger receive "Driver found, waiting for more passengers". The assigned driver sees all active passenger pickup addresses and destinations, live membership and the shared countdown. The driver explicitly accepts the waiting booking.
- Countdown remains visible during collection until server-verified departure. When an underfilled group reaches zero, each passenger approves the exact negotiated group fare. The assigned driver can accept or counter within the protected range. Changing the offer resets every approval. Acceptance is revision checked and splits cents exactly; Asiye receives 20%, driver 80%.
- After negotiated acceptance, each passenger's payment is prepared for the new agreed amount. Standard full groups prepare their usual seat payments. Driver collection and departure require private server payment records with matching amount, method and eligible status.
- Each passenger has an automatic four-digit cryptographic PIN stored under server-only `clubPrivate`, outside the publicly readable booking. Only that passenger's authenticated endpoint returns it. It is never included in driver request data, pushes or shared messages. Five incorrect attempts lock verification. PIN expiry is 24 hours from booking.
- Driver arrival requires the assigned identity/reservation and a live GPS sample from the taxi at most two minutes old, within 300 m of that passenger's pickup. PIN verification is rejected before arrival. Departure requires every active passenger's arrival and successful server PIN verification.
- Sharing is optional, available after the passenger's own arrival, and token issuance enforces that on the server. Empty `shareToken` is accepted for Cash, Wallet and Card. Card dispatch no longer depends on pre-arrival sharing.
- Completion/cancellation releases server reservation locks idempotently. Completion credits driver earnings once. A passenger leaving an accepted negotiated group ends that group and releases all holds through existing cancellation triggers, so remaining passengers are never charged a revised split without consent.
- A scheduled function checks active waiting pools every minute so timeout alerts do not depend on foreground phones. Notification event keys are deterministic and specific to each state/membership/fare change, allowing the existing on-create push trigger to deliver updates.

## Validation

- Android release regression command: 98 tests passed, including 14 new behavioral lifecycle tests.
- Database emulator/security/UI suite: 67 tests passed, including actual HTTP handler tests against RTDB, concurrent joins and approvals, private PIN authorization, direct-write denial, lock release, idempotent completion and matching rendered countdowns.
- Modified JavaScript parses, all Firebase Functions exports load with a test project configuration, and git diff whitespace checks pass.
- The broad root suite has six failures also reproduced on the original branch: two old v1 enrollment assumptions, one build-328 admin-title assumption and three trip-chat harness tests. These remain tracked release-readiness issues; this change does not claim a green full suite.
- Emulator payment providers are stubbed. These tests do not prove live Paystack charges/refunds, FCM delivery, physical GPS, native app lifecycle or successful signed APK/AAB packaging.

## Deployment and acceptance order

1. Keep the same source SHA for backend, rules, Hosting assets and both Android artifacts. Finish or cancel legacy Club pools before enabling the new client: v337 never joins legacy pools, and the join/negotiation endpoints now require `clubSecurityVersion: 2`. New client-created legacy Club records and converting other trip types into Club records are blocked by rules.
2. In a staging Firebase project, deploy the new `createClubBookingSecure`, `joinClubPoolSecure`, `getClubPickupPin`, `submitWorkEarlyDepartureOffer`, `clubDriverActionSecure`, `synchronizeClubBooking` and `expireClubWaiting` functions. Enable Cloud Scheduler and verify the scheduled job is running. Existing approved vehicle and known seat-count requirements still apply.
3. Deploy the affected bundled handlers with the same code: `prepareTripPayment`, `verifyTripCardPayment`, `settleTripPayment`, `paystackWebhook`, `createTripShareToken`, `notifyDriversOfClubAreaBooking`, `refreshDriversWhileClubPooling`, `notifyDriversWhenClubReady`, `refreshClubPaymentReadinessAfterSafetyShare` and `adminManagePlatform`. Retain/test existing cancellation-release and FCM notification functions. Keep existing Paystack secrets/provider settings. Do not perform an unrelated full production deployment.
4. Deploy reviewed RTDB rules and assets in staging. Verify private `clubPrivate` denies all client access; the passenger PIN endpoint works; driver GPS updates remain permitted; request type/secure state/fare/reservation writes are denied. Admin generic booking edit/reassignment cannot bypass the lifecycle.
5. Build signed APK and AAB from this exact branch. Android Release and Firebase Security Validation now trigger on pushes to this branch. Build artifacts are for testing; no Play publication is configured by this change.
6. Test separate physical passenger and driver devices: one booking, concurrent joins, all routes/counts, early driver acceptance, restart/resume, background timeout alert, actual 30-minute expiry, passenger approvals, driver counter/reaccept, rejected stale offer, Cash/Wallet/Card amounts and payment return, stale/far GPS arrival denial, wrong/correct PIN, all passengers boarding, departure, completion, cancellation/refund and repeated callbacks.
7. Only deploy to production/publish after the source, backend/rules, signed builds and physical-device acceptance have passed. No production deployment was performed by this implementation.
