# Passenger social signup, booking photo and driver OTP

This policy supersedes earlier instructions to require a passenger phone OTP and face picture during signup.

- Passenger: Google or Apple → passenger home. No phone field or SMS. A name and live profile picture are collected when creating the first Go, Club or Parcel booking (including joining an existing Club pool).
- Driver: Google or Apple → link a mobile number using SMS OTP to that same Firebase UID → existing approval status or registration. Returning drivers with a linked phone skip OTP. A phone already attached to another UID never causes an automatic account merge.
- Photo: open camera → **Take picture** → preview → **Save picture & continue booking**. Save stays disabled while the camera is opening or showing live video. A failed save keeps the captured picture for retry; cancellation creates no booking. The camera stops after capture or cancellation.
- Completion: `uploadProfileImageProxy` verifies ownership, persists Storage bytes, probes the download URL, then atomically saves the name, URL and server-owned `bookingFaceAuthUid` / `bookingFaceSavedAt`. Passenger phone is not required. The client reads back completion. These fields confirm a saved picture, not biometric identity or liveness.
- Enforcement: new Go drafts require server-owned picture completion in RTDB rules. Go fare submission, Club create/join and Parcel creation independently check completion before locking, dispatching or preparing payment. Clients cannot forge or remove the completion fields. Existing in-progress trips can continue. Existing accounts without the new server marker take one picture at their next new booking.

## Deploy only to the existing staging project

The GitHub Hosting deployer previously returned HTTP 403. Use the human administrator session that successfully deployed staging in Cloud Shell. This patch changes seven existing endpoints, rules and Hosting; the older Hosting-only helper is insufficient.

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_auth_booking_flow.cjs
```

The script checks the branch, clean tracked source (or the exact generated staging entrypoint left by the earlier deployment), staging project ID and number, public staging SDK and existing TEST key without printing credentials. The 37-function payment baseline omitted the two driver enrollment endpoints; this patch explicitly includes them, bringing expected staging inventory to 39. It deploys only the seven named endpoints from an isolated copy, then rules and Hosting, and runs the read-only audit. It does not change IAM, Auth providers, production, store releases or payment transactions. Do not paste Firebase debug logs or tokens into chat.

## Staging acceptance still required

1. Fresh browser session: each passenger provider enters home with no phone or camera prompt.
2. First Go booking: capture, preview, upload; booking resumes with saved name/photo. Cancel and retry do not create trips. Reload and book again without another capture. Repeat the gate for Club create/join and Parcel with an unverified profile.
3. Driver: each social provider leads to phone OTP only when the account lacks a linked number. Same UID before/after OTP; returning verified drivers retain their approval/enrollment state. Test an incorrect OTP and number already linked to another account.
4. New APK/IPA required for bundled assets. Existing installed binaries retain the old flow; Hosting does not update them. Native staging Firebase configurations and device acceptance remain separate release blockers.

Go/Club/Parcel physical journeys, Paystack TEST checkout and 80/20 allocation, merchant acceptance and public release approval are not implied by source or emulator tests.
