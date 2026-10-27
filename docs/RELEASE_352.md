# Asiye 11.0.82 (352) / iOS 46522.0.10 — verified banking before bookings

**Published and verified on 27 October 2026 at 19:34 SAST.** Drivers must verify and link their own Paystack bank before receiving or accepting any new Cash or Card Go, Club or Parcel booking.

Go dispatch, busy-driver queues and Club selection exclude missing, pending, wrong-owner and wrong-environment settlement records before sending offers. Acceptance and counter endpoints recheck banking, including stale notifications. Production requires the same authenticated driver's verified LIVE subaccount, valid account code, account suffix and 20% Asiye commission. Enrollment bank details and a public status label cannot substitute for that private verification.

Database rules prevent forged banking readiness, unbanked online activation and direct legacy booking claims. Bank setup remains accessible without an existing bank link, avoiding an enrollment loop. Existing assigned trips can finish. Trip cleanup clears the old trip before checking whether to promote a queue or resume offers: a driver without ready banking stays offline; a verified online driver resumes the request listener.

## Driver steps

1. Install the new signed app, then sign in with the approved driver account.
2. Open **Menu → Banking details**.
3. Enter the driver's own bank and verification details privately, then tap **Verify banking details**.
4. Use **Check verification again** until **Your bank is verified** appears. Pending verification keeps new bookings paused.
5. Return to the dashboard and **Go Online**.

Existing verified links without an environment stamp must refresh in Banking details so the server can revalidate them with Paystack. The prior driver OTP routing/account-link repair remains included. Older installed apps receive server enforcement; the new bundled prompt and trip-cleanup behavior require this signed app.

## Signed downloads

| Download | Version | Artifact ZIP SHA-256 |
| --- | --- | --- |
| [Android APK + AAB](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246/artifacts/12753058855) | 11.0.82 (352) | `d42f3b16c101bca96ec6b64fb7a0f5d431e9e184b7b7445274fe11917f718133` |
| [iOS IPA](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246/artifacts/12753269840) | 46522.0.10 (96026) | `2203e09d2f7fba6464dbf70d9b746a14e22b0c0b4bd965420002483cd120d3fc` |

[Signed build 40544591246](https://github.com/Gatcheni2025/asiye_app/actions/runs/40544591246) completed from `041b880e31dd9dcf7ef6d9b2ff906d8cbe50b880`. Flutter analysis, native OTP/routing tests, package signatures and all 32 reviewed WebView assets passed. Android API 36 and all 20 reviewed 64-bit native libraries passed 16 KB checks. The IPA uses actual SDK `iphoneos26.5`, minimum iOS 15.5. TestFlight upload and public store publication were not performed. Build 352 supersedes 351 before public distribution.

## Production proof

[Controlled publication, successful attempt 2](https://github.com/Gatcheni2025/asiye_app/actions/runs/40546662325/attempts/2) verified **44/44 immutable function sources**, matching database rules, **44/44 checked public files**, the exact payment callback and retired Wallet-funding responses. The successful resume updated only the remaining seven functions; 37 already matching functions were skipped. Two-function batches avoided the earlier update/startup bursts. No launch activation, charge or refund was performed.

- Production source: `7850f3306405d26b82e38a305a13c6905097f277`.
- Frozen runtime: `0652f29e2f34191faa34938f3a8e4ddc8775d7fe25e09902c99456bd98aa4ec9`.
- Hosting version: `sites/asiye-80386/versions/fb02bec96914799f`; 108 files, including ten preserved unrelated files.
- LIVE secret bindings: version 2; checkout remains **OFF**.
- [Publication readback](https://github.com/Gatcheni2025/asiye_app/actions/runs/40546662325/artifacts/12755625851): ZIP SHA-256 `291440fcf86d0c7d3299f0918d951232753e1952e4906bef70f280722257a164`, independently downloaded and verified. Private rollback locations were omitted from the saved evidence.

The [independent read-only preflight](https://github.com/Gatcheni2025/asiye_app/actions/runs/40552519485) passed at **19:39 SAST**. It confirms 42/42 application functions ACTIVE (the two retired funding handlers are separately verified in the publication), matching rules/public files/callback, authenticated LIVE credentials, **zero driver payout profiles**, checkout OFF and missing launch-evidence references. A real approved driver must complete banking in the app before passengers can match under this rule. Actual bank/provider/device payment acceptance and settlement remain outstanding.

## Validation limits

All **234** exported-handler/database-rule/browser regressions passed, including owner/environment enforcement, stale-offer rejection, verification followed by a dispatch retry, provider revocation, both trip-completion availability cases and exact split/payment-confirmation behavior. Required release CI passed.

The wider historical root sweep is 379 passed / 12 failed. All 12 failures reproduce on the unchanged pre-banking baseline `907b3a1ac398caeb96c2fb0f4efd5050d60e6804`: older enrollment and release-327/328 expectations plus chat/map DOM fixtures. These tests were not weakened for this change.

[Machine-readable evidence](release-evidence/driver-bank-gate-20261027.json) · [Sanitized publication fields](release-evidence/driver-bank-gate-hosting-20261027.json)
