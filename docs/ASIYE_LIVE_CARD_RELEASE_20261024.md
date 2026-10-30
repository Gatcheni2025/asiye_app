# Asiye production status — updated 27 October 2026

Verified banking is now required before drivers receive or accept any new Cash or Card booking. The backend, rules and web update are published. Signed build 352 includes the bank prompt, safe trip cleanup and the retained driver OTP repair.

| Area | Current status |
| --- | --- |
| Production backend | [Verified 27 October](https://github.com/Gatcheni2025/asiye_app/actions/runs/40546662325/attempts/2): 44/44 immutable function sources matched |
| Production rules and callback | Banking requirement rules matched; exact payment return matched |
| Production web | 44/44 checked files matched; 108 Hosting files with ten unrelated files preserved |
| Paystack credential | Selected consumers bind authenticated LIVE secret version 2 |
| Wallet | Funding endpoints remain retired; balances and financial history preserved |
| Driver banking | Same-owner verified LIVE bank required before any new Go, Club or Parcel booking |
| Signed apps | Android 11.0.82 (352) and iOS 46522.0.10 (96026), both successful |
| LIVE checkout | OFF; latest inspection found zero payout profiles and missing launch-evidence references |

## What the driver does

1. Open the driver app, then **Menu → Banking details**, or tap the dashboard's **Banking details** card.
2. Choose the supported South African bank and enter the account-holder name, account number, account type and verification document.
3. Tap **Verify banking details**. Pending verification is shown honestly; it is not a success message.
4. Use **Check verification again** until **Your bank is verified** appears. The verified account is shown only by bank name and its final four digits.
5. Return to the dashboard and **Go Online**. Missing or pending bank verification keeps all new bookings paused.

The signed-in driver's actual profile is resolved before any banking request, so switching accounts cannot reuse another driver's saved ID. The server still requires driver/vehicle approval, verifies bank ownership with Paystack and creates each payout destination once. Bank/ID details are entered privately in the app; do not send them through chat.

Card payments retain **80% to the driver's own Paystack subaccount / 20% to Asiye**. Asiye bears processing fees from its share. Paystack controls settlement timing.

## What remains before public launch

- Verify at least one actual approved driver's LIVE bank/subaccount through this flow. The [fresh post-publication inspection](https://github.com/Gatcheni2025/asiye_app/actions/runs/40552519485) on 27 October at **19:39 SAST** found zero configured payout profiles.
- Confirm the Paystack Dashboard's **Live Mode** webhook is saved as:
  https://us-central1-asiye-80386.cloudfunctions.net/paystackWebhook
- The callback supplied by checkout is:
  https://us-central1-asiye-80386.cloudfunctions.net/paystackPaymentReturn
- Record the owner's release instruction and actual validation evidence in the server-only launch record, enable new checkout with a conditional write/readback, then verify one authorized LIVE booking with separate driver/passenger accounts before public distribution.
- On the new installed Android/iOS packages, verify payment return, pickup PIN, completion and rating save/reopen. Upload to internal Play/TestFlight before public store release.

These are concrete remaining checks; successful CI does not establish an actual payment, refund or bank settlement. No new general permission is needed for the already requested release work.

## Current signed apps and booking acceptance

| Signed download | Version |
| --- | --- |
| [Android APK + AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246/artifacts/12753058855) | 11.0.82 (352) |
| [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246/artifacts/12753269840) | 46522.0.10 (96026) |

The [signed build](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246) passed Flutter analysis, native OTP/routing tests, all 234 handler/rule/browser regressions, signatures and all 32 reviewed bundled assets. Android API 36/16 KB checks and actual iOS SDK 26.5/minimum 15.5 passed. TestFlight upload and public store publication were not performed.

The driver must complete provider bank verification before going online for new bookings. Existing trips remain finishable; cleanup resumes queues/offers only after banking is ready. The earlier OTP repair preserves the Driver role and original Google/Apple UID through verification and Resend.

On the installed new apps, still verify real phone/reCAPTCHA return, banking, payment return, pickup PIN, completion and rating save/reopen with the actual driver/passenger accounts. Automated provider and identity tests use simulated data. See [RELEASE_352.md](RELEASE_352.md).

## Latest production verification

[Publication attempt 2](https://github.com/Gatcheni2025/asiye_app/actions/runs/40546662325/attempts/2) completed at **19:34 SAST** on 27 October: function source MATCH=44/44, rules MATCH, web MATCH=44/44, exact callback MATCH and checkout OFF. It resumed only the remaining seven source updates; 37 matching functions were skipped.

Source `7850f3306405d26b82e38a305a13c6905097f277`; runtime `0652f29e2f34191faa34938f3a8e4ddc8775d7fe25e09902c99456bd98aa4ec9`. Hosting `fb02bec96914799f` contains 108 files, with ten unrelated files preserved. [Readback artifact](https://github.com/Gatcheni2025/asiye_app/actions/runs/40546662325/artifacts/12755625851) ZIP SHA-256 `291440fcf86d0c7d3299f0918d951232753e1952e4906bef70f280722257a164` was independently verified.

The [independent preflight](https://github.com/Gatcheni2025/asiye_app/actions/runs/40552519485) passed at **19:39 SAST** with LIVE credentials authenticated, matching rules/public files/callback and **0 payout profiles**. Checkout stays OFF. No actual bank settlement, LIVE charge/refund or physical-device acceptance is certified by this release.

[Current machine-readable evidence](release-evidence/driver-bank-gate-20261027.json) · [Sanitized publication fields](release-evidence/driver-bank-gate-hosting-20261027.json)

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

[RELEASE_349.md](RELEASE_349.md) records the earlier banking candidate. Build 352 includes the banking flow and the OTP repair, and supersedes earlier candidates for mandatory banking and safe trip cleanup. Earlier 347/348 packages do not contain the banking menu.
