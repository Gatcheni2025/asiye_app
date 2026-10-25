# Asiye 11.0.79 (349) / iOS 46522.0.7

This candidate adds driver bank verification directly to the driver dashboard and main menu. Account also links to the same banking screen.

The driver can select a supported bank, provide their own account/identity details, submit verification and reopen the screen to check pending/verified status. The page resolves the currently authenticated driver's actual profile instead of trusting a driver ID left in local storage. Only an explicit server-verified result displays success. Existing server ownership, approval, bank-validation and duplicate-subaccount controls remain enforced.

The signed-package checker now compares 32 selected production assets, including the banking HTML, JavaScript, CSS and driver dashboard styling, inside the actual APK/AAB/IPA. New signed candidates are required because these assets are bundled in native apps. Existing Android 348 / iOS 46522.0.6 (95626) packages were successfully built on 24 October but predate this navigation update.

The candidate workflow retains established release signatures, production Firebase configuration, Android API 36/16 KB checks and iOS SDK 26+ / minimum iOS 15.5 checks. Fastlane selects a fresh unused iOS build number. TestFlight upload remains disabled by default; this does not publish either public store.

The production backend/rules remain unchanged from the verified 24 October rollout. The scoped Hosting UI publication completed with 0 functions redeployed and 44/44 public files matching. LIVE checkout remains off until actual driver payout/provider setup is verified. See [production status](ASIYE_LIVE_CARD_RELEASE_20261024.md).

Before public distribution, use an approved driver on the installed candidate: open Menu → Banking details, submit privately, reopen and confirm the masked verified account. Then verify an authorized LIVE fare with distinct passenger/driver accounts, payment return/restart, PIN, trip completion and saved ratings. CI uses simulated identity/provider HTTP and does not claim actual bank verification or settlement.

## Completed signed builds

[Build 40173938689](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689) succeeded from source `42602fa9737c354c2ffcaa3b871b3415735e3636`.

- [Android APK and AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689/artifacts/12591173925): **11.0.79 (349)**, production configuration, established signing identity, API 36, 16 KB packaging and all 20 native libraries passed.
- [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40173938689/artifacts/12591827692): **46522.0.7 (95726)**, signed, actual SDK **26.5**, minimum iOS **15.5**, production configuration.

All **32 selected bundled assets** matched the source in APK/AAB/IPA. Android ZIP SHA-256: `09ed6139e7fbc3a7ddbfe0f13de2fee331c28672ab669c67814888250ec51dcc`. iOS ZIP SHA-256: `7e55c03b5e059398a73a76ed402beaa5f830d937bf3de6dd49e75bbe0d418782`. These hashes refer to the Actions artifact ZIPs, not the individual binaries inside.

All **218** exported-handler/rules/UI tests passed. The separate banking layout run checked 320/360/390 px without horizontal overflow and exercised one submission, pending verification and masked verified status. Real bank/provider/device acceptance remains distinct from simulated tests. TestFlight upload was disabled and neither public store has been published.
