# Asiye 11.0.70 (340): cash pickup and PIN ordering

Cash Go fare acceptance now prepares the deferred `cash_due` ledger and system PIN on the
server and returns `accepted`. No passenger-side payment action or cash receipt is required
before pickup. This also works when the passenger app is closed. The driver can resume an
older agreed cash booking using Start cash pickup, which authorizes the same server flow.
Card and Wallet still require the verified private ledger at the exact agreed fare.

Pickup PIN is checked by the driver after arrival and before destination navigation. Secure
Go destination navigation refuses an unverified PIN, and the PIN overlay closes at verified
departure and completion. There is no dropoff PIN. At the destination the driver selects
Collect cash and finish ride; the server requires fresh destination proximity and verified
departure before recording the receipt. Newly created 340 cash bookings cannot settle without
that dropoff receipt. Installed 339 booking completion remains compatible with its prior flow.

Server-completed protected Go rides exit client completion immediately, avoiding a second
client financial settlement or duplicate earnings write.

This repair changes both the APK assets and live backend. The scoped deployment workflow
`.github/workflows/deploy_active_trip_339.yml` runs regression and Java 21 emulator checks
before deploying the matching handlers and database rules. It then creates isolated temporary
passenger/driver identities far from service areas, tests a synthetic cash booking end to end,
and deletes the test data and identities. No real passengers are contacted, no card is charged,
and no payout/refund is initiated by that synthetic cash test. Endpoint CORS/auth is checked
for installed-app origins. The workflow starts when its file changes on the verified branch.

Local verification: 113 release/regression tests plus seven restoration/completion behavior
tests passed. Production deployment, isolated live validation and signed APK/AAB results must
be checked before claiming the installed app is repaired. Physical-device GPS/share acceptance
remains separate from the isolated API test. Reopen the passenger and driver app after the
matching backend deploy; install 340 for the corrected UI and destination cash receipt step.
