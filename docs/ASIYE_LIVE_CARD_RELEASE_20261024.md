# Asiye production status — updated 25 October 2026

The backend rollout is complete. Do not repeat the 44-function deployment to add the banking screen.

| Area | Current status |
| --- | --- |
| Production backend | [Verified on 24 October](https://github.com/Gatcheni2025/asiye_app/actions/runs/40111382791): 44/44 immutable function sources matched |
| Production rules and callback | Reviewed rules matched; exact payment-return HTML returned HTTP 200 |
| Production web at that checkpoint | 43/43 checked files matched; homepage and policy pages preserved |
| Paystack credential | All nine selected consumers bind authenticated LIVE secret version 2 |
| Wallet | Funding endpoints retired; balances and financial history preserved |
| Driver banking | Published on 25 October; dashboard/menu and banking verification screen match production |
| New signed apps | Signed Android 11.0.79 (349) and iOS 46522.0.7 (95726) built successfully; links below |
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

## Release evidence

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

See [RELEASE_349.md](RELEASE_349.md) for the new signed candidate scope. Earlier 347/348 packages remain historical candidates and do not contain the new banking menu.
