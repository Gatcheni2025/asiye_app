# Asiye 347 — native OTP correction and candidate rebuild

## Corrected behavior

The installed app's shared auth bridge did not implement the passenger's new
one-time Google/Apple phone-link flow. It read `passengerPhoneInput` while the
visible input was `socialPhoneInput`. Flutter then signed out the social user
and authenticated the phone owner instead of linking the OTP credential.

The bridge now sends the original social UID and the correct phone input to
Flutter. Both automatic SMS verification and manual OTP confirmation use
`linkWithCredential` on that UID. Credential collisions and changed sessions
fail without falling back to another account. Resend and Activity/reCAPTCHA
recovery retain linking intent. Retrying an already verified OTP retries the
session handoff. Choosing another sign-in method waits for native sign-out
before resetting the WebView session.

The candidate workflow builds signed APK, AAB and IPA artifacts on this review
branch. Push events and the default manual run do **not** upload to TestFlight.
Only a manual run with `upload_to_testflight=yes` selects the gated beta lane.
Each package must contain all 18 reviewed auth/booking/payment WebView files
byte-for-byte from its source commit, in addition to existing signing checks.

## Observed evidence and limits

- Before these edits, all seven independently downloaded staging login and
  shared-auth files matched review head `5a8a92d6c5ca707f1e47a0a0dcf3e547dc3f424e`.
- The updated candidate's JavaScript release regressions pass: **180/180**.
- Public Hosting comparison against the corrected source found **16/17**
  files matching. `native-auth-session.js` needs the Hosting-only update below.
- Native Dart account-link and collision tests are required in the signed
  Android build job. A green JavaScript suite is not native-device acceptance.
- Native candidates still use Firebase **asiye-80386**, including the native
  auth exchange. They are explicitly labelled **not staging-capable**. Do not
  use them to claim staging payment/booking acceptance. Separate registered
  staging Android/iOS Firebase configs and OAuth/signing setup remain needed
  for a native staging candidate; a web config alone cannot supply these.
- The read-only GitHub prerequisites run **39752616083** independently confirms
  all **37 staging functions ACTIVE**, no missing endpoints, and RTDB rules
  matching the reviewed source. The designated TEST driver subaccount is active,
  verified, and configured for 20% Asiye / 80% driver. No checkout was created.
- That workflow fails on the separate production check: production is missing
  `configureDriverCardPayout` and all five secure Parcel endpoints, and its
  deployed RTDB rules differ. This does not block isolated staging acceptance.
- Source hashes do not attest deployed backend implementation. No real Paystack
  charge, webhook, refund or bank settlement has been certified by source tests
  or the prerequisites check. No staging test-account sessions are available.

## Automated Hosting-only update

`staging_auth_hosting_only.yml` uses the existing isolated staging service
account and public SDK variables. Before deployment it verifies the runtime
matches reviewed commit `1f6cb8b`, authenticates only to the pinned staging
project, and runs the auth/deployment guard tests. It selects `--only hosting`
and independently reads back all 17 files plus RTDB rules afterwards. It never
deploys functions/rules or supplies Paystack keys. Check its result before using
the Cloud Shell fallback; do not repeat a successful deployment.

The first run, **39753441553**, passed the source, preview, identity and
37-function preflight. Publishing Hosting was blocked by **HTTP 403** for the
GitHub staging service account. No IAM changes were attempted. Use the existing
human-authenticated Cloud Shell session for the Hosting-only fallback below;
do not grant Cloud Functions/runtime roles to resolve a Hosting write failure.

The separate `staging_function_source_readback.yml` workflow reads immutable
Cloud Functions build-archive generations and compares the 23 reviewed
JavaScript files, package metadata and generated staging entrypoint. It never
deploys or prints archive contents, environment files, tokens or customer data.
It reports code differences and source-read permissions separately; dependency
resolution and the managed runtime are outside this code comparison.

Readback run **39755436840** verifies **32/37** deployed functions against all
25 reviewed code/package/entrypoint files. It found **zero mismatches**. The
five Gen1 triggers below expose a successful build ID but no recorded immutable
source generation; the audit leaves their deployed-source proof unresolved
instead of treating a current mutable archive as the original build input:

- `releaseCancelledGoTripPayment`
- `releaseCancelledClubPassengerPayment`
- `disburseCompletedCardTrips`
- `synchronizeClubBooking`
- `refreshClubPaymentReadinessAfterSafetyShare`

This is a provenance gap, not evidence that these handlers differ. No backend
redeployment was made to force the audit green.

## Cloud Shell fallback: update only the corrected shared auth asset

Use the existing isolated staging checkout and validated preview configuration:

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/rebuild_staging_auth_preview.cjs
node scripts/deploy_paystack_staging_hosting_only.cjs --deploy
node scripts/audit_347_staging_readonly.cjs
```

The deploy helper validates the project, staging preview, review ancestry,
limited auth changes and 37 active functions, then prompts for
`DEPLOY-STAGING-HOSTING`. It deploys **Hosting only**. Cloud Functions, RTDB
rules, IAM, live keys and production resources are not changed. Hosting
already matching the reviewed preview skips deployment automatically.

Expected full audit: `STAGING_RTDB_RULES: MATCH`,
`STAGING_HOSTED_FILES: MATCH=17/17`, and
`STAGING_INFRASTRUCTURE_READBACK: PASS`. These are targets, not observed results.
If rules are blocked or mismatched, preserve the sanitized finding and diagnose
it before any rule or permission change.

For a public-file check without a Cloud Shell login or local preview:

```bash
node scripts/audit_347_staging_readonly.cjs --hosting-only
```

This public mode rewrites source in memory with the pinned staging project's
public SDK config. It reads no private database records and cannot attest
rules, function revision, payments or native acceptance.

After the full audit, complete the Cash Go journey with one approved staging
driver and one staging passenger: 65% offer delivered, driver decision,
arrival, pickup PIN before departure, trip completion, cash confirmation,
and restart restoration on both sides. Then perform Club, Parcel and the
real Paystack TEST split/webhook/refund acceptance in the main checklist.

Public store publication, production backend rollout and Paystack LIVE
activation remain unapproved and separate from signed candidate builds.

## Fresh signed candidates — independently downloaded and checked

Runtime commit: `1f6cb8b68da5338898b4bd22f4674d0cb8115678`.
All three jobs in [run 39752616110](https://github.com/Gatcheni2025/asiye_app/actions/runs/39752616110)
succeeded, including the five native account-link/collision tests. Downloaded
artifact ZIP SHA-256 digests match GitHub's metadata; all 18 required WebView
files were also independently compared inside each signed package.

| Candidate | Download | Result |
| --- | --- | --- |
| Android 11.0.77 (347), APK + AAB | [Android artifacts](https://github.com/Gatcheni2025/asiye_app/actions/runs/39752616110/artifacts/12413634770) | Existing release signing and Firebase certificate checks pass; 20 bundled 64-bit libraries in each package have at least 16 KB ELF load alignment; uncompressed APK native-library ZIP alignment also passes 16 KB |
| iOS 46522.0.5 (95526), IPA | [iOS artifact](https://github.com/Gatcheni2025/asiye_app/actions/runs/39752616110/artifacts/12414288190) | Signed IPA and metadata checks pass; `distribution=signed-candidate`, `testflight_uploaded=false` |

These are production-configured mobile candidates, not staging-native apps.
The Android source remains build 347; do not reuse a versionCode already
uploaded to Play. Choose the next unused store version after acceptance.
Binary alignment checks do not replace device tests or Play Console validation.
The IPA is App Store signed and needs an explicitly authorized TestFlight
upload for device distribution; it is not an ad-hoc install package.
