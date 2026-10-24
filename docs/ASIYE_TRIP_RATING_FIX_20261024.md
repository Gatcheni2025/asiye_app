# Completed-trip passenger rating repair

Status: source correction prepared; targeted staging deployment and real rating acceptance pending.

The operator confirmed early completion works with a different passenger login. The 24 October driver screenshot shows `completed` and the Cash completion screen, followed by **Could not save the rating.** The rating button called a missing `submitPassengerRating` method. Its async handler also accessed `event.currentTarget` after awaiting, and active-trip cleanup clears the controller's request ID.

The correction implements the missing method and uses the captured completed-trip reference. The existing `goTripActionSecure` endpoint accepts the authenticated `ratePassenger` action; no endpoint is added. It verifies the completed trip, assigned driver's ownership, the correct passenger (or completed Club member), a distinct passenger identity and an integer score of 1–5. Ratings persist in a server-owned JSON scalar on the completed trip. The same score retries idempotently; changing an existing vote, rating another booking or modifying/deleting the record through the client is rejected. Ratings do not write passenger profiles, aggregate averages, earnings, payment ledgers or active booking locks.

The button waits for a confirmed server response, shows saved state, and retains stars for retry after an error. Club requires an explicit passenger selection when more than one member remains unrated. Saved state renders when reopening the trip. Driver Trip history now offers **Rate passenger** on completed passenger rides, so the existing completed Cash trip can be rated after refresh. Opening/closing a historical rating does not stop navigation or release a newer booking.

## Targeted staging apply

After the source/security checks pass, run in the existing human-authenticated staging Cloud Shell:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_trip_ratings.cjs --apply
```

This deploys only the existing `goTripActionSecure` endpoint, requires ACTIVE immutable source proof `STAGING_TRIP_RATING_SOURCE: MATCH=1/1`, then publishes the protective RTDB rule and reviewed web assets. The existing 43-function inventory remains unchanged. The helper pins `asiye-paystack-staging` / `1000800408896`, keeps Paystack TEST, preserves private diagnostic logs and runs full inventory/rules/46-file Hosting readback. It neither changes IAM nor submits a rating, creates a trip, charges, refunds or touches production.

After partial Functions success, use the same helper with `--resume-after-functions`; source proof is mandatory before rules/Hosting. `--check` performs only source proof. The earlier three-function early-end source checkpoint remains historical; this rating repair updates only the one endpoint that handles ratings.

## Acceptance on the ride already completed

Refresh the driver app, open **Trip history**, expand the completed Cash ride and select **Rate passenger**. Choose stars and submit. Expect **Passenger rating saved** and **Passenger rating submitted**. Reopen the same trip and confirm it remains submitted. Do not make another booking or repeat a payment for this check. Check retry after a simulated network failure and separate Club member selection in controlled tests. The previous Card TEST payment/refund remains a separate provider check.
