# Asiye 11.0.77 (347): Go offer delivery

Android: **11.0.77 (347)**. iOS: **46522.0.5**, with a fresh Apple build number.
Source branch: `fix/paystack-subaccounts-cash-card-no-wallet`.

Go offers start at **65% of the route reference**, rounded up to a whole rand.
The existing 95% ceiling and 90% recommendation remain. For a R100 reference,
the passenger starts at R65, can offer R65–R95, and the driver receives the chosen
amount without a requirement to meet R90. The driver accepts, declines or counters;
the passenger must accept a counter before payment. The 80/20 allocation remains.

Authenticated offer submission now sends driver notifications on the server.
The passenger does not need a second request to make a successfully submitted
offer visible. Driver notifications include the actual offer and recommendation.
A notification outage preserves the server-owned booking, reports zero confirmed
driver deliveries and allows the existing search retry to try the same offer again.
Retries preserve driver declines and pending counters. Dispatch cannot revive a
cancelled request or overwrite an intervening fare decision.

Passenger slider and numeric bounds refresh when the route changes. An invalid
visible input cannot silently submit the previous valid amount.

Validation: **157 booking/payment/authentication checks and 154 Firebase security,
exported-handler and UI checks passed locally**. The eight new regressions cover
client/server floor agreement, automatic Cash/Card dispatch at 65%, delivery
outages, unvalidated/cancelled dispatch, route/input bounds, saved booking recovery
search retries and recovery after a lost submission response. The broader legacy test directory has eight existing failures,
reproduced unchanged on the 346 source; the supported release checks pass.

The dedicated deployment workflow updates only seven Go endpoints:
`submitGoFareOffer`, `dispatchGoRideRequest`, `counterGoFare`, `acceptGoFareOffer`,
`acceptGoFareCounter`, `declineGoFareOffer` and `declineGoFareCounter`.
It runs security checks first, then verifies real endpoint/rule access with
temporary accounts at isolated coordinates. The validation prepares no payment
and removes its temporary records and accounts.

The mobile build workflow produces signed APK/AAB/IPA files and waits for Apple
TestFlight processing. Public store publication and live Card activation remain
separate from these candidate builds. The remaining Parcel, payment deployment,
provider acceptance and Wallet reconciliation work is tracked in
`docs/PAYSTACK_TECHNICAL_ACCEPTANCE_20261017.md`.
