# Asiye production status — updated 25 October 2026

The backend rollout and driver banking publication are complete. The driver OTP return repair is now included in signed build 350, and its shared bridge is published. Installing the new app is required for the native routing fix; another function deployment is unnecessary.

| Area | Current status |
| --- | --- |
| Production backend | [Verified on 24 October](https://github.com/Gatcheni2025/asiye_app/actions/runs/40111382791): 44/44 immutable function sources matched |
| Production rules and callback | Reviewed rules matched; exact payment-return HTML returned HTTP 200 |
| Production web | [Latest OTP bridge publication](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202049798): 44/44 files matched; 0 functions redeployed; merchant pages preserved |
| Paystack credential | All nine selected consumers bind authenticated LIVE secret version 2 |
| Wallet | Funding endpoints retired; balances and financial history preserved |
| Driver banking | Published on 25 October; dashboard/menu and banking verification screen match production |
| New signed apps | Signed Android 11.0.80 (350) and iOS 46522.0.8 (95826) built successfully; links below |
| Driver phone OTP | Stale passenger routing, linked-account resend and recovery repaired; actual device/SMS check pending |
| LIVE checkout | OFF until real driver banking and provider setup are verified |

## What the driver does

1. Open the driver app, then **Menu → Banking details**, or tap the dashboard's **Banking details** card.
2. Choose the supported South African bank and enter the account-holder name, account number, account type and verification document.
3. Tap **Verify banking details**. Pending verification is shown honestly; it is not a success message.
4. Use **Check verification again** until **Your bank is verified** appears. The verified account is shown only by bank name and its final four digits.

The signed-in driver's actual profile is resolved before any banking request, so switching accounts cannot reuse another driver's saved ID. The server still requires driver/vehicle approval, verifies bank ownership with Paystack and creates each payout destination once. Bank/ID details are entered privately in the app; do not send them through chat.

Card payments retain **80% to the driver's own Paystack subaccount / 20% to Asiye**. Asiye bears processing fees from its share. Paystack controls settlement timing.

## What remains before public launch

- Verify at least one actual approved driver's LIVE bank/subaccount through this flow. The fresh inspection on 25 October at 13:56 SAST found zero configured profiles; that was a setup requirement, not a missing function.
- Confirm the Paystack Dashboard's **Live Mode** webhook is saved as:
  https://us-central1-asiye-80386.cloudfunctions.net/paystackWebhook
- The callback supplied by checkout is:
  https://us-central1-asiye-80386.cloudfunctions.net/paystackPaymentReturn
- Record the owner's release instruction and actual validation evidence in the server-only launch record, enable new checkout with a conditional write/readback, then verify one authorized LIVE booking with separate driver/passenger accounts before public distribution.
- On the new installed Android/iOS packages, verify payment return, pickup PIN, completion and rating save/reopen. Upload to internal Play/TestFlight before public store release.

These are concrete remaining checks; successful CI does not establish an actual payment, refund or bank settlement. No new general permission is needed for the already requested release work.

## Current signed apps and driver OTP acceptance

| Signed download | Version |
| --- | --- |
| [Android APK + AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355/artifacts/12602975221) | 11.0.80 (350) |
| [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355/artifacts/12601504646) | 46522.0.8 (95826) |

The [signed build](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355) passed Flutter analysis, native routing/phone-account-link tests, 218 exported-handler/rules/UI tests, package signatures and all 32 reviewed bundled assets. Android API 36/16 KB packaging and iOS SDK 26.5/minimum 15.5 passed. TestFlight upload and public store publication were not performed.

Driver phone verification now keeps the selected Driver role separate from an old passenger session, binds Resend to the same original Google/Apple account, and retains recovery until the driver WebView accepts the authenticated UID. Existing approval and OTP requirements remain enforced.

The [read-only phone configuration inspection](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202142858), 25 October at **16:25 SAST**, confirmed phone authentication enabled, South African SMS allowed, the Firebase return domain authorized and both release signing fingerprints registered. Nine configured Firebase test numbers use their configured code and receive no real SMS ([Firebase documentation](https://firebase.google.com/docs/auth/flutter/phone-auth#testing)); the affected number has not been identified as test or normal. No SMS was sent and no auth configuration was changed by the diagnostic.

Install the new app and verify Driver → Google/Apple → phone → OTP/Resend → same driver account, including return from Firebase verification. Actual carrier SMS and physical-device recovery still require this acceptance check. See [RELEASE_350.md](RELEASE_350.md) and [the current evidence record](release-evidence/driver-otp-20261025.json).

## Latest production Hosting evidence

[OTP bridge Hosting-only run 40202049798](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202049798) completed at **16:29 SAST** on 25 October: function source MATCH=44/44, rules MATCH, web MATCH=44/44, exact callback MATCH, **0 functions redeployed**, and checkout OFF. Source `42df207da8039d16120b41103ba2a2f16404cc09`; runtime `a5ef66e679551fe4a1166f35f07fb5d2bb2d0fe02ce93c88d81c8da4337c073a`. Hosting `c314b37354492b43` contains 108 files, with 10 unrelated files preserved. The scoped publication changed only the allowed shared authentication bridge; backend and rules already matched.

The [readback artifact](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202049798/artifacts/12602297098) was independently verified with ZIP SHA-256 `35a3f419d0183f9f49d06dda322ce5fa8cdb9c7be6249dd5a686d7ad9a6cb1e0`. [Sanitized release fields](release-evidence/driver-otp-hosting-20261025.json) contain no private backup location. This publication did not enable LIVE checkout or certify actual provider/device acceptance.

## Earlier banking and backend evidence

The [25 October Hosting-only publication](https://github.com/Gatcheni2025/asiye_app/actions/runs/40174005357) completed: **0 functions redeployed**, immutable source MATCH=44/44, rules MATCH, web MATCH=44/44, exact callback and checkout OFF. The scope is 42 app functions plus two retired Wallet-funding handlers. Runtime digest `d4c13961b5623168d7d6c5e2f673d8bfdc17af4dcd91b4db0bdd4dba85ab515f`; Hosting version `d5000fa60dffef6a`, 108 files with 10 existing unrelated files preserved.

The [fresh independent preflight](https://github.com/Gatcheni2025/asiye_app/actions/runs/40174500054), rerun 25 October at **13:56 SAST**, confirms matching production rules/public files/callback, authenticated LIVE credentials, **0 driver payout profiles** and checkout OFF. Passing the infrastructure inspection does not claim a verified driver: the report explicitly says banking setup is required.

All **218** exported-handler/rules/UI tests passed. [Banking phone checks](https://github.com/Gatcheni2025/asiye_app/actions/runs/40174500020) passed at 320/360/390 px for entry, pending and masked verified status, using simulated provider/identity data.

The [signed mobile build](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689) passed signatures and all 32 selected bundled production assets in the APK, AAB and IPA. Android API 36/16 KB packaging and all 20 native libraries passed. The actual IPA uses SDK `iphoneos26.5`, minimum iOS 15.5.

| Signed download | Version |
| --- | --- |
| [Android APK + AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689/artifacts/12591173925) | 11.0.79 (349) |
| [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689/artifacts/12591827692) | 46522.0.7 (95726) |

TestFlight upload and public store publication were not performed. Artifact ZIP hashes and build source are retained in [the evidence record](release-evidence/production-banking-20261025.json).


The 24 October [production readback ZIP](https://github.com/Gatcheni2025/asiye_app/actions/runs/40111382791/artifacts/12566479927) was independently verified with SHA-256 `616614b0c5fa532505e521974b4316e671ad9f8abed1acb8b524eee7b0fb8c7c`. Its source is `e509fb897eea3dfda333e7f265ce1197cade85d5`; runtime digest `dd0a54a8d853b6b5e8ec9903d1f9ba4b0f794da790b454a492507ff50276154e`. It preserved private rollback backups. The full exported-handler/rules/UI suite passed 208 tests before that rollout.

The 25 October banking update changes only the listed driver/shared UI assets. Its Hosting-only operation refuses any backend/rules/native-code or unrelated UI change, requires all deployed functions and bindings already to match, preserves the existing Hosting file map and keeps checkout off. It does not rebuild functions.

[RELEASE_349.md](RELEASE_349.md) records the earlier banking candidate. Build 350 includes that banking flow and supersedes 349 for driver OTP routing/recovery. Earlier 347/348 packages do not contain the banking menu.
