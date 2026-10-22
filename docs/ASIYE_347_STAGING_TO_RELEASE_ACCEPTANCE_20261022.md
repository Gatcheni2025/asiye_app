# Asiye 347 — staging to production release acceptance (22 October 2026)

**Release status: NO-GO for public stores and LIVE Card processing.** This is an evidence checklist, not a deployment authorization.

Native bridge/account-link correction, fresh candidate build controls and the
current Hosting-only update command are recorded in
[the native authentication follow-up](ASIYE_NATIVE_AUTH_READINESS_FIX_20261022.md).
The public audit now compares **17** critical files, including the shared
native bridge and booking/payment scripts. Existing 347 native candidates use
the production Firebase project and must not be mistaken for staging builds.

## Reviewed baseline and provenance

- Review branch: `fix/paystack-subaccounts-cash-card-no-wallet` / pull request **#19** (target: `fix/11.0.67-club-booking-arrival-pin-timer`, not `main`).
- Flutter version: `11.0.77+347` (Android); iOS candidate marketing version `46522.0.5`.
- Older signed APK, AAB and IPA created in GitHub Actions run **39131028973** on **18 October 2026**, source `d80dc0a7f015c66b0d0df4e17cffd38a94ac6802`. These files **predate** the passenger Google/Apple/Phone flow edits from 22 October. Rebuild on the final review commit before device release.
- Staging Firebase `asiye-paystack-staging` project no. `1000800408896`: operator-observed Cloud Functions 37/37 ACTIVE; Hosting deployment reported CLI `EXIT_0` and `HOSTING_MATCHES_LOCAL_PREVIEW`. This confirms a **web-only preview** and active resource names, **not** current backend source SHA, deployed database-rule digest, provider success, native app acceptance, or production readiness.
- Production project `asiye-80386` is **out of scope** for all current staging actions. Server Paystack LIVE activation must remain disabled.
- Repo `main` still shows `11.0.49+319`; **never** build, tag, or publish the 347 release from main by accident. Merge and release lineage must be reviewed first.

## Hard release gates (evidence required, not inferred)

| Gate | Evidence needed | Status 22 Oct |
| --- | --- | --- |
| Staging function inventory | Exactly 37 expected functions ACTIVE | **Independent PASS**, run 39752616083 (names/state only) |
| Hosting | Published passenger/driver preview digest matches local staging preview, no production config | Prior preview **PASS**; corrected shared native bridge update pending (GitHub Hosting publish HTTP 403, run 39753441553) |
| Staging database rules | Read back deployed RTDB rules; digest matches reviewed `database.rules.json` | **Independent PASS**, run 39752616083 |
| Staging backend revision | Prove function builds are from intended reviewed source, not just ACTIVE | **32/37** immutable build archives match all 25 reviewed code/package/entrypoint files; five Gen1 triggers lack recorded source generation (run 39755436840); full provenance **UNVERIFIED** |
| Passenger authentication | Google, Apple, Phone OTP; first-time one-off SMS link; returning dashboard; face/name onboarding; linked-UID preservation; already-linked number conflict | **Source tests pass; device UAT missing** |
| Driver onboarding | Face, vehicle photo/registration, ID/license/address, bank, approval, pending state, restore on restart | **Device UAT missing** |
| Go negotiated ride | Passenger offers 65–95% of reference; driver receives 65% offer even below recommendation; accept/counter/decline, pickup and complete | **Device UAT missing** |
| Club/Work | 30-minute countdown synced; driver waiting/addresses/passenger count; late/early departure negotiation; partial pool | **Device UAT missing** |
| PIN and safety share | PIN server generated after booking; driver enters at pickup **before** trip starts; sharing offered only after arrival, never blocks trip prematurely | **Device UAT missing** |
| Cash | Confirm after trip completion, not at booking/pickup; correct both-side restoration and cancellation | **Device UAT missing** |
| Paystack TEST | Verified approved test-driver `ACCT_...` subaccount, 20% main/80% driver allocation, Asiye fee bearer, real TEST checkout → webhook → callback → captured state | **Prerequisites PASS**, run 39752616083; real journey still **UNVERIFIED** |
| Payment recovery | Declined/abandoned card, missing/duplicate webhook, retry/idempotency, cancellations/partial Club, authorized refund status, subaccount mismatch | **UNVERIFIED** |
| Parcel V2 | Accept, private pickup PIN, wrong-PIN lock, payment, completed delivery/cancel, no stale bookings | **Device UAT missing** |
| Historical Wallet | No new wallet/EFT purchases; outstanding balances and old transfers reconciled and preserved | **Finance sign-off missing** |
| Android & iOS | New signed candidate; native Google/Apple/Phone/OTP/camera/location/push/deeplink tested on actual devices | **Signed rebuild PASS**, runtime 1f6cb8b, run 39752616110; Android 347, iOS 46522.0.5 (95526); 18 asset hashes match each package; native staging config and device UAT still missing |
| App store checks | Android signing/SHA, install/update, current Play Console API/16 KB page-size checks; iOS TestFlight processing and metadata/privacy declarations | Signing/SHA/metadata and Android 16 KB binary alignment **PASS**; device/Play Console checks pending; new IPA was **not uploaded** |
| Merchant/legal | Published policies, facial scan/privacy disclosures, refund policy, registered company, driver compliance; **written Paystack acceptance** | **Awaiting independent acceptance** |
| Production | Reviewed backend/rules parity, backups/rollback, dedicated release-owner approval; LIVE Card gated separately | **NOT AUTHORIZED** |

## Safe sequence — Stage 1: Web and account UAT

Use fresh **staging-only**, consented passenger and driver accounts. Do not use real production identities or bank records.

1. Passenger first visit (no current Firebase session): sign-in chooser shows Google, Apple, and phone.
2. Google/Apple successful sign-in with no verified phone: one-time phone verification. Switching methods shows all three methods only after successful Firebase sign-out. A phone credential must link to the **same UID**, not create/switch users; collision must fail without merging accounts.
3. First-time user completes phone OTP, legal/consent flow and name + face scan; only then dashboard. Returning phone/social users with a completed profile go directly to dashboard without another one-time link.
4. Google/Apple sessions must survive restart and show correct role, correct single passenger profile, no repeated profile setup.
5. Driver registers documents, awaits approval; existing approved driver returns to a fully functional driver dashboard.
6. Record **only** test case ID, result, app build/commit, time, redacted console error code and device OS; no token, phone number, face photo, key or bank data in issues.

## Safe sequence — Stage 2: Real Go, Club, Cash and Parcel journeys

Two test phones at minimum (passenger and driver), plus two additional passengers for pooled rides. Confirm explicit acceptance checkpoints:

| Case | Passenger | Driver / backend | Pass rule |
| --- | --- | --- | --- |
| GO-01 | Offer 65% reference; booking submitted | Receives exact amount & pickup/destination; can accept | No artificial 90–100% floor |
| GO-02 | Receives driver counter and accepts | Counter is visible; server finalizes one amount | No auto-charge before agreement |
| GO-03 | Cash trip | Driver arrives, PIN at pickup, completes; cash recorded after | Cash not treated as prepaid |
| GO-04 | Restart mid-trip | Both parties restore same active booking and state | Never marooned at `active booking` popup |
| CLUB-01 | Pool starts countdown immediately | Sees 30-minute clock, member count and destinations | Both sides synchronized |
| CLUB-02 | Pool incomplete at timeout | Negotiation/early departure offered | Never silently charge missing members |
| CLUB-03 | Card one member fails | Other member ledger unchanged; pickup blocked if not ready | Fail closed, no duplicate charge |
| SAFE-01 | Share only on driver arrival | PIN must be verified before start | Sharing doesn't prevent valid pickup |
| PARCEL-01 | Parcel pickup/arrival/payment | Wrong PIN rejected; correct PIN allows action | Correct server-only completion |

## Safe sequence — Stage 3: Paystack TEST (not live)

- Confirm test driver identity and the **correct** verified TEST subaccount (no copying one driver's code to another). Paystack `percentage_charge: 20` gives **20% main/80% subaccount**. Set fees to be paid by Asiye per reviewed contract; inspect actual TEST transaction split and provider verification, not only client ledger.
- Set **Test Mode webhook** to the reviewed staging function and verify signature, amount, ZAR, reference, domain, driver subaccount and idempotency; test successful/failed/duplicate/late/refund callbacks. Never set the live webhook to staging.
- Run `Paystack Technical Readiness` and `Paystack Test-Mode Card Preflight` on the reviewed branch: `check`, then `initialize`, then `verify` only for authorized TEST transactions. Card preflight is **not** equivalent to end-to-end booking completion.
- Save redacted test references privately for finance and engineering signoff; do not paste credentials or personal information into Actions input/issue descriptions.
- Keep `paymentLaunch/paystack.liveEnabled=false`. Never simulate live authorization or remove subaccount verification checks to make a test pass.

## Safe sequence — Stage 4: Mobile build and release

- Freeze the **reviewed SHA** after all source-level and staging tests pass. Confirm 347 release ancestry and current App Store Connect version/build metadata.
- The existing workflow `.github/workflows/android_paystack_review_apk.yml` supports **manual** candidate builds; leave `upload_to_testflight=no` until a separate authorized TestFlight upload decision.
- Run candidate jobs and verify attached signed APK/AAB and, as available, IPA; confirm SHA/signature, versions, Firebase project and Google/Apple native auth. Android and iOS use **bundled `assets/passenger-v2` and `assets/driver-v2` WebView files**, so the Oct 22 Hosting update does **not** update existing installed apps.
- Install **fresh and upgrade** candidates on supported Android and iOS devices. Complete UAT again with production-intended configuration and test-safe payment gating. A Play/TestFlight upload is NOT a public rollout.
- Confirm Play 16 KB native page-size support and Play target API compliance; verify iOS TestFlight processing, signing and data-collection/privacy declarations.
- Keep store rollout, production backend rollout and Paystack LIVE activation as three separate release approvals. Verify rollback of backend, RTDB rules and app rollout availability before any production rollout.

## Operational next actions

1. Run staging-only **read-only** rules/source inventory and capture sanitized results, not secrets.
2. Complete Passenger and Driver web login smoke tests with two staging test accounts.
3. Perform Cash and Go offer delivery/UAT, then Club countdown and Parcel pickup PIN.
4. Confirm designated Paystack TEST subaccount; run real TEST checkout and webhook/refund tests.
5. Create a **new** signed mobile candidate from the frozen SHA; verify fresh installation and upgrade, then TestFlight/internal Play testing.
6. Obtain Paystack's written approval, support/finance historical-wallet reconciliation and release-owner signoff **before** deciding on production deploy and activation.

### Evidence ledger (complete during acceptance)

| Test ID | Environment | Build / SHA | Device | Result | Redacted evidence | Tester | Date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | Staging WEB | | | Pending | | | |
| AUTH-02 | Staging WEB | | | Pending | | | |
| DRIVER-01 | Staging WEB | | | Pending | | | |
| GO-01 | Staging | | | Pending | | | |
| CLUB-01 | Staging | | | Pending | | | |
| PARCEL-01 | Staging | | | Pending | | | |
| CARD-TEST-01 | Paystack TEST | | | Pending | | | |
| REFUND-TEST-01 | Paystack TEST | | | Pending | | | |
| ANDROID-01 | Internal test | | | Pending | | | |
| IOS-01 | TestFlight | | | Pending | | | |

**DO NOT change LIVE payment gating, production database rules or release to app stores based on green simulated CI, web Hosting or 37 ACTIVE function names alone.**
