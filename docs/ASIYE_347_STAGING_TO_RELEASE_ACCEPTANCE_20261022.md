# Asiye — final release acceptance review, 22 October 2026

**Current decision: staging testing may continue; public mobile release and LIVE Card activation still need the evidence below.** This checklist records evidence and remaining work. It does not authorize production changes.

Reviewed runtime/source head: `b0b2899b508d2412a6e25b6a288114536bd27dfb` on `fix/paystack-subaccounts-cash-card-no-wallet`. Pull request [#19](https://github.com/Gatcheni2025/asiye_app/pull/19) is open and targets `fix/11.0.67-club-booking-arrival-pin-timer`. Production `main` still reports `11.0.49+319`; it is not the reviewed release source. The checklist update itself changes documentation only.

## Confirmed evidence

| Area | Observed result | Evidence and limits |
| --- | --- | --- |
| Latest source checks | PASS | [Source gate 39838523618](https://github.com/Gatcheni2025/asiye_app/actions/runs/39838523618), [Firebase security 39838531790](https://github.com/Gatcheni2025/asiye_app/actions/runs/39838531790), and [Paystack regressions 39838523856](https://github.com/Gatcheni2025/asiye_app/actions/runs/39838523856) all succeeded at `b0b2899`. Provider responses and browser identities in these tests are simulated. |
| Staging deployment | PASS | Operator screenshot confirms 43/43 expected functions ACTIVE, no missing/nonactive functions, deployed RTDB rules matching the review, 46/46 hosted files matching, and `STAGING_INFRASTRUCTURE_READBACK: PASS`. Project: `asiye-paystack-staging`, number `1000800408896`, region `us-central1`. |
| Selected changed function source | PASS for the 23-function Card/test-tools scope | Hosting completed only after the selected source gate passed; the helper reported updated tools and source verified. The Gen1 Club trigger uses immutable build provenance or an explicit deployed-version source download. This does not assert that all 43 functions, their dependencies, or production have identical deployed source. The general inventory audit's `DEPLOYED_FUNCTION_SOURCE_SHA: NOT_ATTESTED` line is a separate limitation. |
| Testing-admin access | User-confirmed working | The corrected role-grant script at `b0b2899` grants and reads back `stagingTripTester:true`, preserving existing roles. The operator reran it successfully and then reported that access works. End-to-end cancellation and provider linkage must be recorded separately. |
| Cash | User-confirmed working | Keep this result. Repeat a short device regression on the final candidate: PIN at pickup, cash collection after completion, and trip restoration. |
| Public policy pages | Accessible | Direct HTTPS checks returned HTTP 200 for Terms, Privacy, Refund/Cancellation, Company/Contact and Driver Requirements. Published text describes direct driver subaccount settlement, 80/20 allocation, Asiye fee bearing, facial-photo handling and discontinued Wallet funding. Availability/content review does not equal Paystack's written merchant activation approval. |
| Paystack TEST prerequisites | Provider check passed | [Technical readiness run 39824510128](https://github.com/Gatcheni2025/asiye_app/actions/runs/39824510128), checked 22 October at 19:39 SAST, confirmed the configured TEST subaccount exists, is active and verified, with 20% Asiye / 80% driver. Its report explicitly leaves the actual Card journey and bank settlement unverified. |

The user's latest confirmation follows the testing-admin access repair. Do not treat it as evidence that Card checkout, split allocation, refunds, Club/Parcel or native device tests have all passed.

## Current application contract

These requirements supersede earlier passenger phone-at-signup instructions in historical documents.

- Passenger: Google or Apple sign-in opens the dashboard without requiring a phone number. Collect and save the name and live profile photo at the first booking, including Club joining and Parcel. A failed upload retains the capture for retry and creates no booking. The server owns completion markers; a saved photo is not proof of biometric identity or liveness.
- Driver: Google or Apple first, then link the driver's own phone by OTP to the same UID. Returning verified drivers keep their enrollment/approval state. A phone collision does not merge accounts.
- Optional trusted-contact details support **Add later** and must not trap the user before the dashboard.
- Supported vehicles are Sedan and Hatchback. Minibus and SUV are excluded from registration, approval and booking eligibility.
- Go: 65% minimum fare offer, driver accepts/declines/counters, and the final agreed fare is authoritative.
- Card: agreed fare and assigned, verified driver subaccount precede checkout. Verify payment server-side before starting driver pickup navigation. Paystack splits at the transaction; internal `held` status is not escrow or a promise to delay bank settlement until arrival.
- Cash is collected after the trip. A server-generated PIN is entered by the driver at pickup before departure. Sharing becomes available after driver arrival and does not block valid pickup or departure.
- Testing-admin cancellation preserves financial records and releases only matching trip locks. Cancelling a Card trip does not itself prove a provider refund.

## Remaining release gates

| Priority | Gate | Acceptance needed |
| --- | --- | --- |
| 1 | Real Paystack TEST booking | Two distinct staging passenger/approved-driver accounts. Agree the fare, link/check the correct verified TEST subaccount, complete one real provider TEST checkout, verify the exact amount/ZAR/reference/driver subaccount and authenticated webhook, inspect the provider's gross 80/20 allocation and Asiye fee bearer, and observe automatic pickup navigation only after server confirmation. No real bank settlement is inferred from TEST mode. |
| 2 | Payment recovery and test cancellation | Declined/abandoned checkout must not start pickup. Retry and duplicate/late webhook delivery must not duplicate charges or move the ledger backward. Cancel a selected staging test trip and confirm both apps release their matching locks, allowing a new booking. Check an eligible TEST refund and its provider status separately from cancellation. |
| 3 | Full Go, Club/Work and Parcel acceptance | Use distinct accounts/devices. Verify 65% offer delivery, accept/counter/decline, arrival, pickup PIN, completion, restart restoration, driver map and notifications. Club: immediate synchronized 30-minute countdown, member count, timeout/early-departure negotiation and one payer failing. Parcel: accept, private pickup PIN, wrong-PIN rejection/lockout, payment, delivery and cancellation. Record cases rather than inferring them from deployment or simulated tests. |
| 4 | Fresh mobile configuration and signed candidates | Existing candidate is stale and production-configured. Prepare registered native staging configuration plus matching bundled WebView assets, native auth exchange, OAuth/signing and push setup before claiming native staging acceptance. Freeze the tested runtime SHA; create fresh signed APK/AAB/IPA, verify package source/assets, use the next unused Android versionCode and fresh iOS build number, and test fresh installation plus upgrade on real Android/iOS devices. |
| 5 | Production backend/rules alignment | Review and approve a controlled promotion of the accepted backend and rules, with backups and rollback. Latest independent report lists six missing/inactive reviewed endpoints and a different deployed rules digest. Read back production source/config/rules after the authorized promotion. Keep LIVE Card disabled through deployment and smoke testing. |
| 6 | Merchant, finance and store acceptance | Obtain Paystack's final written acceptance of the published documents and activation conditions; reconcile historical Wallet balances/EFTs/refunds without deleting ledgers; confirm support/refund ownership. Run internal Play/TestFlight acceptance, verify store versions, target SDK/native binary checks, permissions, privacy/account-deletion disclosures and store processing. Release-owner approval is required for public rollout; LIVE Card approval is a separate decision. |

## Production findings: not fixed by staging deployment

The downloaded artifact `asiye-paystack-technical-readiness` from run **39824510128** reports production `asiye-80386` missing or not ACTIVE:

- `configureDriverCardPayout`
- `createParcelRequestSecure`
- `acceptParcelRequestSecure`
- `cancelParcelBookingSecure`
- `getParcelPickupPinSecure`
- `parcelTripActionSecure`

The report successfully read different rule hashes, so this is a confirmed rules difference rather than an assumed IAM problem:

- Production: `195fc06e9b49f37aabf990ebc0de0c24020b5f9dfc15df05c61b56c655a4bf8a`
- Reviewed/staging: `138b410f8a00bd9e75e319a6c04e993155bfd6703f5bf167579489a094546886`

Production deployed source revision was not attested. No production deployment, IAM change, payment transaction or LIVE activation was performed during this review. The earlier report's staging count of 42 is historical; the later operator audit confirms the current 43-function staging inventory.

Do not run the historical **Final App Readiness Gate** as a harmless staging check. `.github/workflows/final_app_readiness.yml` authenticates to production and calls `production-trip-validation.js`. Use the current source gate and isolated staging test tools for acceptance.

## Mobile build findings

The latest signed candidate independently identified in the reviewed workflow history is [run 39752616110](https://github.com/Gatcheni2025/asiye_app/actions/runs/39752616110), started **22 October 2026 at 11:04 SAST**, from `1f6cb8b68da5338898b4bd22f4674d0cb8115678`:

| Artifact | Existing candidate | Limitation |
| --- | --- | --- |
| Android APK/AAB | 11.0.77 (347), signed artifacts created at approximately 11:14 SAST | Predates the latest signup/photo, driver-map, vehicle-policy, Card pickup and testing-admin fixes. Firebase project is production `asiye-80386`. |
| iOS IPA | 46522.0.5 (95526), signed candidate | Same earlier source; recorded `testflight_uploaded=false`; not a staging-native build. |

This corrects the older assumption that the only signed artifacts were from 18 October. Today's signed files still predate the current runtime. Hosting updates do not replace packaged WebView files in installed apps.

Use `.github/workflows/android_paystack_review_apk.yml` as the reviewed build lineage. Its default/manual `upload_to_testflight=no` builds without uploading. It currently pins Android 347 and production Firebase, so version/configuration preparation remains necessary. The separate `ios_release.yml` still targets the older 341 repair lineage and must not be used for this release.

Current store checks to apply to the fresh final binary:

- Android: inspect actual target API and Play Console acceptance. Google's current guidance requires API 36 from August 2026. Verify native 16 KB ELF/ZIP alignment and test in a 16 KB environment. Earlier candidate alignment evidence does not certify the next binary. References: [target API guidance](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability), [16 KB guide](https://developer.android.com/guide/practices/page-sizes).
- iOS: App Store Connect uploads require Xcode 26+ and an iOS 26+ SDK; iOS/iPadOS deployment targets must be 13+. Check the fresh IPA's actual SDK/signing, privacy manifests, updated age-rating responses and TestFlight processing. Reference: [Apple requirements](https://developer.apple.com/news/upcoming-requirements/).
- Native UAT: Google/Apple, driver OTP and same-UID linking, first-booking photo capture/upload/retry, location/map, foreground/background notifications, payment return/deep link, restart restoration, permissions and account-deletion access.

## Published merchant-review links

- https://asiye.cloud/terms-of-service.html
- https://asiye.cloud/privacy-policy.html
- https://asiye.cloud/refund-cancellation-policy.html
- https://asiye.cloud/contact.html
- https://asiye.cloud/driver-compliance.html

The public homepage also links to these pages and describes Cash/Card, direct 80/20 subaccounts, provider fees and discontinued Wallet funding. Paystack's acceptance of the proposed model in earlier correspondence is not the same as final written activation approval.

## Evidence register

Retain only redacted test IDs/references, environment, runtime SHA, platform/build, result, tester and date. Do not put tokens, keys, bank numbers, phone numbers or face photos in GitHub.

| Test | Current evidence | Remaining result to record |
| --- | --- | --- |
| ADMIN-ACCESS | User-confirmed working after the `b0b2899` role repair | None for access; cancellation/linkage are separate cases |
| CASH-GO | User-confirmed working | Final device-candidate regression |
| AUTH-PASSENGER | Source/browser coverage passes; earlier Google/Apple staging success reported | Fresh and returning accounts, first-booking photo, final Android/iOS candidates |
| AUTH-DRIVER | Source/emulator coverage passes | Google/Apple then same-UID OTP and approval restore on final devices |
| GO-FARE-PIN-RESTORE | Source/emulator coverage passes | Complete observed two-account journey |
| CLUB-TIMER-PAYMENT | Source/emulator coverage passes | Pool/countdown/timeout/partial-payment device evidence |
| PARCEL-PIN-COMPLETE | Source/emulator coverage passes | Observed pickup/payment/delivery/cancellation |
| CARD-TEST-SPLIT | Provider TEST prerequisites pass | Real checkout, exact agreed fare, correct driver split, webhook and pickup |
| CARD-RECOVERY | Automated failure/idempotency cases pass | Decline/abandon/retry and observed provider TEST refund |
| ADMIN-CANCEL | Automated role/transaction/browser cases pass | Selected trip cancelled and both apps unlocked |
| ANDROID-FINAL / IOS-FINAL | Earlier signed candidates exist | Correct configuration, fresh source, install/upgrade and internal distribution |
| PRODUCTION-PARITY | Missing endpoints and different rules documented | Approved promotion, readback, rollback proof and smoke test |
| MERCHANT-FINANCE | Required pages accessible; no final activation evidence reviewed | Written Paystack acceptance and legacy-funds reconciliation |

**Next acceptance run:** complete one real staging Paystack TEST Go booking from fare agreement through verified 80/20 allocation, driver pickup navigation, pickup PIN and completion. Record cancellation/refund recovery separately. Then close Club/Parcel and native device gates before scheduling production promotion and public publication.
