# Asiye 11.0.82 (352) / iOS 46522.0.10 — verified banking before bookings

Drivers must link and verify their own Paystack bank account before receiving any new Cash or Card booking. Enrollment bank details and a public status label cannot substitute for the server-owned, verified settlement record. Production requires a LIVE link for the same driver UID, valid subaccount code and 20% Asiye commission.

Go dispatch, busy-driver queues and Club selection filter unavailable banking before sending offers. Acceptance and counter endpoints check banking again, including stale notifications and secure Parcel acceptance. Database rules prevent direct legacy assignment or going online without verification, and drivers cannot forge payout status. Existing assigned trips, cancellation, pickup PIN and completion remain available.

The driver dashboard checks banking after restoring an existing trip and before starting new offers. Go Online takes an unverified driver to Banking details; pending verification honestly keeps new bookings paused. Bank verification stays reachable without needing an existing bank link. A verified driver can return to the dashboard and go online.

The existing OTP repair remains included. This native WebView asset update needs the new signed app; older installed apps receive server enforcement but cannot acquire the new bundled prompt through Hosting.

Validation checkpoint: all 234 exported-handler/database-rule/browser regressions passed locally, including bank gating, fresh dispatch after verification, linked-account ownership, provider revocation, existing-trip continuation and Card split/payment confirmation. The new signed packages and deployment remain pending at this checkpoint. LIVE checkout remains gated separately. Existing verified legacy bank records without an environment stamp must be refreshed through Banking details so the server can revalidate them with Paystack.


The trip-release screen also refreshes banking after clearing the completed trip, before promoting a queue or resuming broadcasting. A driver with unavailable banking stays offline and returns to the dashboard; a verified online driver resumes the request listener. Neither driver is left on a completed-trip screen by a rejected broadcast write. This is the final candidate, superseding 351 before public distribution.
