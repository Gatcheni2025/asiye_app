# Asiye 11.0.80 (350) / iOS 46522.0.8 — driver OTP repair

This candidate fixes driver phone verification returning to the passenger flow. Native authentication now stores the selected sign-in role independently of the previous account's profile. A stale passenger localStorage session cannot overwrite driver intent. A fresh, UID-bound driver OTP attempt restores the driver login screen, including a reCAPTCHA return before codeSent has supplied a verification ID.

The native Resend code action retains the original Google/Apple UID. It cannot silently become a separate phone-account sign-in. Verification and callbacks reject changed accounts and mismatching roles. A recreated WebView can finish the same native driver's verified session; recovery state is cleared only after the driver WebView accepts the authenticated UID. Firebase errors remain on the driver phone screen.

The existing driver approval, phone verification, banking verification and Cash/Card controls remain enforced. No backend/rules, key, financial record, charge or payment launch change is included. The Hosting update selects only the shared native-auth bridge; the native routing repair requires these new signed packages and is not delivered to older installed apps by Hosting.

Validation includes native Dart routing/recovery and phone-account-link tests, JavaScript driver/passenger/OTP regressions, signed-package asset parity and the existing backend/rules security suite. Actual carrier SMS delivery and a physical-device reCAPTCHA return still need the operator's check after installing the candidate. TestFlight/public-store upload remains disabled.

After installation: choose Driver, sign in with Google/Apple, request the driver OTP, return from Firebase verification, enter the code or use Resend once, and verify that the same driver's enrollment/dashboard opens. Then check Menu → Banking details. Keep SMS codes and account/identity details private.

## Completed signed candidates — 25 October 2026

[Build 40201742355](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355) completed successfully from source `458e130025535b57261addea64e9a446f3c06eae`. Native Flutter analysis and routing/phone-link tests passed, as did all 218 exported-handler/rules/UI tests and the focused JavaScript auth/recovery checks. Actual signed packages passed production configuration and parity checks for all 32 reviewed bundled WebView assets.

| Signed download | Version | Artifact ZIP SHA-256 |
| --- | --- | --- |
| [Android APK + AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355/artifacts/12602975221) | 11.0.80 (350) | `16416add0ea2f2e3b6afb5d0811087ec475cdba166f912a4b431741ddff0dfaa` |
| [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40201742355/artifacts/12601504646) | 46522.0.8 (95826) | `1bb73f95ab7e807911395986a5853d85ace1c39a46c2e03cc9d2e8ec9422e6ba` |

Android uses the established release certificate, API 36 and validated 16 KB packaging; all 20 reviewed native libraries passed alignment checks. The IPA uses SDK `iphoneos26.5` and minimum iOS 15.5. TestFlight upload and public store publication were not performed.

## Production shared bridge and phone configuration

[Hosting-only run 40202049798](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202049798) completed at **16:29 SAST on 25 October** from `42df207da8039d16120b41103ba2a2f16404cc09`. The shared native-auth bridge is published. Readback confirmed 44/44 immutable function sources, matching rules, 44/44 public files and the exact callback, with **zero functions redeployed** and checkout still **OFF**. Runtime SHA-256: `a5ef66e679551fe4a1166f35f07fb5d2bb2d0fe02ce93c88d81c8da4337c073a`. Hosting version: `sites/asiye-80386/versions/c314b37354492b43`; 108 files, including 10 preserved unrelated files. The sanitized readback ZIP hash was independently verified.

[Read-only phone configuration check 40202142858](https://github.com/Gatcheni2025/asiye_app/actions/runs/40202142858), **16:25 SAST**, confirmed Firebase Phone Authentication enabled, South African SMS allowed, the Firebase return domain authorized, the expected Android app identity, and the signed release SHA-1/SHA-256 registered. No SMS was sent and no authentication configuration was changed.

There are **nine configured Firebase test phone numbers**. Firebase sends no real SMS for configured test numbers; they use the code saved in the Firebase console ([official Firebase guidance](https://firebase.google.com/docs/auth/flutter/phone-auth#testing)). We have not established whether the affected driver's number is one of them. Do not remove other test entries or expose their numbers/codes to diagnose this report.

The remaining acceptance check is on a physical device with this new signed app: Driver → Google/Apple → phone → Firebase verification → OTP/Resend → same driver's enrollment/dashboard. Check recovery after returning from verification and after the app/WebView is recreated. For a configured test number, use its configured code; for a normal number, verify actual SMS delivery. Device/carrier acceptance is not certified by CI or the configuration inspection.

Machine-readable results: [driver OTP evidence](release-evidence/driver-otp-20261025.json) and [sanitized Hosting readback](release-evidence/driver-otp-hosting-20261025.json). The earlier banking release remains historical evidence; build 350 supersedes 349 for this driver OTP repair.
