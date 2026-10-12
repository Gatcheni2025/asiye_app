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

Local verification: 113 release/regression tests plus eight restoration/completion behavior
tests passed. Production deployment, isolated live validation and signed APK/AAB results must
be checked before claiming the installed app is repaired. Physical-device GPS/share acceptance
remains separate from the isolated API test. Reopen the passenger and driver app after the
matching backend deploy; install 340 for the corrected UI and destination cash receipt step.

## Verified results

Backend source `aa854a9707c6e06c7d179e1b49b5c47a39162969` successfully deployed the eleven scoped
handlers and database rules: https://github.com/Gatcheni2025/asiye_app/actions/runs/38226966049 .
The isolated production cash trip passed all six journey checks, including pickup unlock
without passenger payment preparation, PIN before departure, dropoff-only cash receipt,
no completion PIN and idempotent earnings. Temporary data/users were cleaned up. All eight
installed-app/web endpoint CORS/auth probes passed.

Final client source `e7b4b789013bf3537fdd334ae42abd998d9714e2` passed 113 release regression tests,
signed APK/AAB build and APK signature verification:
https://github.com/Gatcheni2025/asiye_app/actions/runs/38227485416 . Its Java 21 security/emulator
workflow passed all 83 tests: https://github.com/Gatcheni2025/asiye_app/actions/runs/38227485522 .
Artifacts are `asiye-11.0.70-340-apk` and `asiye-11.0.70-340-aab`; extract their ZIPs before use.
Install the APK on passenger and driver devices, then reopen the saved booking. Physical-device
acceptance and Play publication were not performed by these CI/API checks.
