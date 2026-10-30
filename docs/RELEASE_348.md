# Asiye 11.0.78 (348) and iOS 46522.0.6 candidates

This prepares fresh signed APK/AAB/IPA files from the current review branch, including the payment-return recovery, independent early-trip-ending confirmations, completed-trip passenger ratings and history reopening. The previous 347 packages predate these fixes. Android uses candidate versionCode **348**; Fastlane selects a fresh iOS build above the latest App Store Connect build and the workflow's run/attempt floor.

The backend/web runtime fingerprint remains `dd0a54a8d853b6b5e8ec9903d1f9ba4b0f794da790b454a492507ff50276154e`. Updating native release metadata does not change the application JavaScript, backend or database rules already accepted on staging. The separate [production promotion](ASIYE_LIVE_CARD_RELEASE_20261024.md) keeps new checkout off while deployed source, LIVE key bindings, rules and public app files are verified.

The candidate workflow verifies source ancestry from the signed Android 341 and uploaded iOS lineage, payment/security regressions, final signatures, production Firebase configuration, and the actual bundled WebView assets. The package validator includes the driver completion/rating screen and shared trip-history files.

Additional final-binary checks cover Android target API 36 or newer, APK 16 KB ZIP alignment, AAB 16 KB packaging configuration and all 64-bit native library load segments. The signed IPA must use iOS SDK 26 or newer. The Runner deployment target is aligned to **iOS 15.5**, which is already the Podfile's minimum for the current native dependencies. Devices on iOS 15.0–15.4 need an OS update for this candidate.

The workflow builds signed candidates on source push. TestFlight upload remains disabled unless explicitly selected on manual dispatch; no public store publication is performed. Build success does not certify final Play/App Store processing, installed/upgrade behavior, real Card checkout/refund or bank settlement. Check the next available store version before public submission.

After build, test Google/Apple and driver OTP linking, first-booking photo/camera retry, real driver payout setup, distinct passenger/driver identities, Card return/restart, pickup PIN/navigation, Cash and Club/Parcel, and saved ratings on actual Android/iOS devices. Keep real keys, personal documents and bank details out of build reports and chat.
