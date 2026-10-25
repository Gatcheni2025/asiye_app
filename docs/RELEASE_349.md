# Asiye 11.0.79 (349) / iOS 46522.0.7

This candidate adds driver bank verification directly to the driver dashboard and main menu. Account also links to the same banking screen.

The driver can select a supported bank, provide their own account/identity details, submit verification and reopen the screen to check pending/verified status. The page resolves the currently authenticated driver's actual profile instead of trusting a driver ID left in local storage. Only an explicit server-verified result displays success. Existing server ownership, approval, bank-validation and duplicate-subaccount controls remain enforced.

The signed-package checker now compares 32 selected production assets, including the banking HTML, JavaScript, CSS and driver dashboard styling, inside the actual APK/AAB/IPA. New signed candidates are required because these assets are bundled in native apps. Existing Android 348 / iOS 46522.0.6 (95626) packages were successfully built on 24 October but predate this navigation update.

The candidate workflow retains established release signatures, production Firebase configuration, Android API 36/16 KB checks and iOS SDK 26+ / minimum iOS 15.5 checks. Fastlane selects a fresh unused iOS build number. TestFlight upload remains disabled by default; this does not publish either public store.

The production backend/rules remain unchanged from the verified 24 October rollout. Only scoped Hosting UI publication is requested for this banking update. LIVE checkout remains off until actual driver payout/provider setup is verified. See [production status](ASIYE_LIVE_CARD_RELEASE_20261024.md).

Before public distribution, use an approved driver on the installed candidate: open Menu → Banking details, submit privately, reopen and confirm the masked verified account. Then verify an authorized LIVE fare with distinct passenger/driver accounts, payment return/restart, PIN, trip completion and saved ratings. CI uses simulated identity/provider HTTP and does not claim actual bank verification or settlement.
