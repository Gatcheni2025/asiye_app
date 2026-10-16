# Asiye Go driver decisions — test release 345

A low positive passenger offer reaches eligible nearby drivers. The former
65% minimum is now advice, alongside the 90% recommended fare. The existing
95% ceiling and the server-calculated 80/20 split remain in place.

Drivers accept, decline or send a counter. Go request popups do not time out
into a decline. Counter-offers stay open for a decision. Passengers see counters
and driver declines through the live request listener, and can accept the
displayed counter, keep their offer or cancel their request.

Driver declines are authenticated server actions scoped to the notified driver
and offer round. A decline leaves the passenger request active for other drivers.
Duplicate submissions preserve existing decisions; changed offers can reach a
driver again. Acceptance checks the fare and revision shown to the user, and
competing decisions are applied atomically. No card charge starts during negotiation.

Validation covers low offer delivery and direct acceptance, optional counters
after two rounds, driver-only rejection, duplicate offers, counter withdrawal,
simultaneous decisions, live passenger updates, cancellation, unauthorized writes
and deletions, and existing booking, Parcel, authentication and payment regressions.

This remains on the Paystack review branch. The mobile binaries need the matching
reviewed Firebase functions and database rules. Updated endpoints are
`submitGoFareOffer`, `counterGoFare`, `acceptGoFareOffer`, `acceptGoFareCounter`,
`declineGoFareOffer`, `declineGoFareCounter` and `dispatchGoRideRequest`.
The test release workflow builds Android 11.0.75 (345) and iOS beta 46522.0.3;
it does not deploy Firebase or publish a public store release.
