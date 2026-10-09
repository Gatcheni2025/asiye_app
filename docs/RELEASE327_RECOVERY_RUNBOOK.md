# Asiye 11.0.57 (327) · enrollment, profile, wallet and booking recovery

## 9 October follow-up · 11.0.58 (328) registration fix

**Reason:** The prior 327 function deployment fixed media upload, but the
passenger form still failed on OAuth/custom-token identities with no OTP-verified
phone attached to the Firebase Auth account. Driver documents uploaded, but the
final direct WebView Realtime Database write was denied. These are separate
issues from Firebase Storage upload.

### Scoped Firebase deployment

Use the reviewed **release/11.0.57-admin-support-327** branch. Node.js 22,
Firebase CLI authentication and authorized project access are required.

```powershell
cd C:\Users\PC\Desktop\coding\asiye_app_phase5
git fetch origin
git pull --ff-only origin release/11.0.57-admin-support-327
git rev-parse --short HEAD
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
npx firebase-tools deploy --project asiye-80386 --only "functions:uploadProfileImageProxy,functions:uploadDriverEnrollmentDocument,functions:submitDriverEnrollmentSecure"
npx firebase-tools deploy --project asiye-80386 --only hosting
```

The new `submitDriverEnrollmentSecure` validates Firebase Auth phone ownership,
all five uploaded document objects, references and bank account format, then
creates an immutable **pending** enrollment via Admin SDK transaction. It never
approves, activates or switches a driver online. **Do not deploy database
security rules to work around permission_denied.** The current hosted
`/driver-v2/enrollment.html` can also be updated via Hosting; however, the
Flutter app currently calls `loadFlutterAsset`, so install a signed **11.0.58
(328)** APK to receive bundled JS changes. Hosting-only is not enough for
installed WebView assets.

For passenger Google/Apple logins, Firebase Authentication does not treat an
entered number as verified. If the signed-in UID has no Firebase Auth phone,
the page must return to the SMS OTP step; only then should a passenger save
the scanned photo. **Do not let users claim someone else's existing commuter
record by phone text or email.**

Acceptance: (1) verify OTP, full name, face picture and successful passenger
profile save with reachable photo; (2) driver reviews 7 steps and receives
**Pending admin approval**; (3) reject a driver identity without phone Auth or
with another UID's uploaded documents; (4) confirm wallet, card and ride
checkout remain unchanged. A green CI build is not proof that these live flows
work.

---


This fixes the source code on `release/11.0.57-admin-support-327`. It does NOT change the deployed Firebase backend or previously installed APK until it is released.

## Why the old build fails

- `profile.ensureRequired()` opened a face-scan upload *inside* the ride creation path. Card selection was incorrectly reported as an image-upload failure before Paystack initialized.
- `uploadProfileImageProxy` handed out Firebase Storage URLs without checking HTTP access. The new code verifies the saved object, token, and downloadable URL before updating the user profile; on sign-in a broken/404 URL sends the passenger back to the proper face-scan screen.
- Wallet topups and wallet holds relied on `admin.app().options.credential.getAccessToken()`, which isn't guaranteed when the Admin SDK is initialized with default credentials on Cloud Functions. Wallet changes now use **Realtime Database server transactions**, preserving exactly-once payment application.
- Driver enrollment attempted Firebase Web Storage `put()` operations despite `firebase.json` not deploying Storage rules; the old example rule also omitted `address`. Driver enrollment now uploads media through authenticated `uploadDriverEnrollmentDocument` (Admin SDK), verifies document bytes and ownership, and uploads ID, face scan, vehicle, driver licence and address evidence.
- Native driver's licence, ID and address cameras now use the same in-app rear-camera shutter/auto-return used by vehicle pictures.
- Residential address has Mapbox v6 autocomplete scoped to South Africa, with manual entry if offline. Driver banks have common South African universal branch codes automatically filled; bank details remain subject to Paystack payout verification.

## Deploy the reviewed release, not old main

**Preconditions:** manually review PR #13, pass CI, complete a staged Paystack transaction, and use credentials for Firebase project `asiye-80386`. Preserve existing production Firebase configuration and secrets. The new media uploader deliberately avoids changing Storage rules.

From the reviewed release branch with Node/Firebase CLI installed:

```powershell
git fetch origin
git switch release/11.0.57-admin-support-327
git pull
cd functions
npm ci
cd ..
npx firebase-tools deploy --project asiye-80386 --only "functions:uploadProfileImageProxy,functions:uploadDriverEnrollmentDocument,functions:initializePaystackWalletTopup,functions:verifyPaystackWalletTopup,functions:paystackWebhook,functions:prepareTripPayment,functions:verifyTripCardPayment,functions:settleTripPayment,functions:releaseTripPayment" --non-interactive
npx firebase-tools deploy --project asiye-80386 --only "database,hosting" --non-interactive
```

**IMPORTANT**: this functions list includes sensitive payment code. Do not deploy against Paystack live keys until staging verifies references, refunds, wallet credit idempotency and bank transfer payout state. If additional functions changed on the release branch require deployment, review them first. Hosting deployment must be coordinated with native app hosting/domain configuration so the WebView loads updated scripts.

For vehicle payout features from earlier in PR #13, the reviewed additional functions include `configureDriverCardPayout` and `disburseCompletedCardTrips`. They trigger real money transfers if deployed with live Paystack credentials; **deploy only after separate Paystack sandbox and finance approval**.

If the Firebase functions return HTTP 404 after pushing this code, **they are not deployed**. Do not mark tests as passed merely because a GitHub commit exists.

## Staging acceptance

1. Sign in by phone OTP with a new passenger. Give name, capture face, submit. The storage URL MUST return HTTP 200 and the current commuter profile must contain the same URL, `faceScanCompleted:true`.
2. Close/reopen and sign in. A saved valid photo shows in the avatar. An invalid/404 URL is never accepted; the passenger is offered rescan.
3. Request Asiye Go with Cash, Wallet, and Card separately. Profile capture does not launch during payment. Card opens Paystack; PIN/driver dispatch remain gated until Paystack confirms.
4. Test Asiye Club and parcel card flows similarly. No ride should silently fail after uploading a photo.
5. Successful Paystack **wallet topup**: verify the reference server-side, credit once, reverify without double credit, return to the app and check updated balance and stored payment marker. Test concurrent topup and wallet ride hold.
6. New driver: seven steps; front-camera live selfie, rear-camera ID, car, licence and address proof. Confirm each captured image preview appears. After upload, admin sees all five and the driver sees **Pending approval**, not a restarted form.
7. Residential address autocomplete searches South African results, allows selection and manual entry. Bank selection fills correct six-digit code (including leading zeros) and the driver validates final bank details.
8. Run signed Android APK/AAB on actual device. Confirm camera permissions, photo downloads, image update in both profiles, wallet balance, live booking and app logout.

## Operational warning

Identity documents, proof of address and bank information are sensitive. Limit administrative access, avoid logging contents or exposing Storage download tokens outside approved admin review, and review the production document retention and POPIA requirements before rollout.
