# Asiye mobile release lineages — payment migration
Verified on 2026-10-15 against GitHub Actions and public Apple App Store.

## Android
- User-confirmed release build: **11.0.71 (341)**.
- GitHub Actions: https://github.com/Gatcheni2025/asiye_app/actions/runs/38239996199
- Exact source commit: `1646a9a9e4c4fa4145331316887ec3b04dbb3db1`.
- Signed APK and AAB were built successfully. **Google Play public versionCode 341 has not been independently verified through Play Console**; Play public page does not show version codes.
- Flutter pubspec version: `11.0.71+341`, Android Gradle uses `flutter.versionCode` and `flutter.versionName`.

## iOS
- Successful signed IPA and actual upload: https://github.com/Gatcheni2025/asiye_app/actions/runs/38260469171
- Source commit: `2b6c424a463c7225ee264ac77aae45f5a2c94759`.
- This iOS binary was **built from the same Flutter source version `11.0.71+341`**.
- iOS App Store marketing version: `46522.0.0` (Apple build number `93124`).
- Public Apple App Store currently lists `46522.0.0`; this is not the same display scheme as Android's `11.0.71`.
- Apple publicly advertises "Zero Percent Commission"; **the App Store description must be corrected** to the actual Asiye commission policy before marketing the new Paystack 20% platform model.

## Payment development branch
- `fix/paystack-subaccounts-cash-card-no-wallet`
- Draft PR: https://github.com/Gatcheni2025/asiye_app/pull/19
- The branch is descended from BOTH exact build commits, and from the latest associated iOS-release fixes. This is checked in CI by `scripts/verify_payment_release_341_lineage.sh`.
- Source `11.0.71+341` in this review branch is **a lineage marker, not a new published build**. Do not deploy it over published Android 341 or Apple 93124.

## Before next store builds
1. Complete and test driver-first Paystack booking, Work pooled passenger split, Parcel, cash and existing-customer balance settlement and driver approval.
2. Confirm current Play Console Production versionCode AND App Store Connect latest build. Public metadata may lag.
3. Select a **new Android** version greater than 341; proposed `11.0.72+342` only after QA. Update `pubspec.yaml`, Android release notes, and automated ancestry/version guard in a reviewed release bump.
4. Select a **new Apple** build number greater than 93124, with approved App Store Connect marketing version and updated iOS workflow confirmation. Do not reuse Apple build 93124; Apple's marketing version currently differs from Flutter's name.
5. Create Android signed AAB and APK, iOS signed IPA and run real-device pilot/sandbox transaction tests. Do not publish financial changes from draft without Paystack approval and reconciled customer balances.
