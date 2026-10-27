# Asiye 11.0.81 (351) / iOS 46522.0.9 — verified banking before bookings

Drivers must link and verify their own Paystack bank account before receiving any new Cash or Card booking. Enrollment bank details and a public status label cannot substitute for the server-owned, verified settlement record. Production requires a LIVE link for the same driver UID, valid subaccount code and 20% Asiye commission.

Go dispatch, busy-driver queues and Club selection filter unavailable banking before sending offers. Acceptance and counter endpoints check banking again, including stale notifications and secure Parcel acceptance. Database rules prevent direct legacy assignment or going online without verification, and drivers cannot forge payout status. Existing assigned trips, cancellation, pickup PIN and completion remain available.

The driver dashboard checks banking after restoring an existing trip and before starting new offers. Go Online takes an unverified driver to Banking details; pending verification honestly keeps new bookings paused. Bank verification stays reachable without needing an existing bank link. A verified driver can return to the dashboard and go online.

The existing OTP repair remains included. This native WebView asset update needs the new signed app; older installed apps receive server enforcement but cannot acquire the new bundled prompt through Hosting.

Validation checkpoint: all 232 exported-handler/database-rule/browser regressions passed locally, including bank gating, fresh dispatch after verification, linked-account ownership, provider revocation, existing-trip continuation and Card split/payment confirmation. The new signed packages and deployment remain pending at this checkpoint. LIVE checkout remains gated separately. Existing verified legacy bank records without an environment stamp must be refreshed through Banking details so the server can revalidate them with Paystack.

## Release progress — 27 October 2026

The [351 candidate pipeline](https://github.com/Gatcheni2025/asiye_app/actions/runs/40542382615) has passed its full payment/booking/Firebase validation job; signed Android and iOS packaging is in progress. Candidate source: `87863ed1178e89dc8bb1f9cd923809f74b166527`. The [controlled production promotion](https://github.com/Gatcheni2025/asiye_app/actions/runs/40542898770) is in progress from `7a8a81ebd4c7567e03e5afdb6cb81d082e58bf19`, with runtime `b4cb1ac8fc507f09826d9dbb2d0d2ac8e46d080541e43d9c2ea8660b4326c9ef`. Checkout activation is excluded from this publication.

The broader historical root test sweep exposed 12 older failures in enrollment, release-327/328 expectations, chat DOM fixtures and map DOM fixtures. All 12 also fail on the unchanged pre-banking source `907b3a1ac398caeb96c2fb0f4efd5050d60e6804`; they were not rewritten for this change. The required release/security suites and all new banking tests pass. The vehicle-dispatch fixture was updated to include a genuinely verified private banking record, retaining its existing vehicle-category checks.
