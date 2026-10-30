# Asiye 11.0.76 (346) release candidate

Source branch: `fix/paystack-subaccounts-cash-card-no-wallet`.
Includes the complete reviewed backend at `b5bebae9a80b0568d0439b98788665cfe26f1304`.

| Platform | Version | Output |
| --- | --- | --- |
| Android | `11.0.76`, versionCode `346` | Existing release-signed APK and AAB |
| iOS | `46522.0.4`, fresh Apple build number | Existing App Store-signed IPA and TestFlight upload |

The release workflow validates source ancestry, JavaScript, 303 booking/payment/authentication/Firebase checks and phone layouts before building. It verifies Android signing, the Firebase certificate, package and APK/AAB version, plus the signed IPA bundle/version/export-compliance fields. Apple upload waits for TestFlight processing before the iOS job succeeds.

This candidate retains driver-controlled Go offers and recommended counters, live passenger updates, matching-only booking cancellation cleanup and offline-before-signout driver presence. The backend source also includes direct Paystack driver subaccounts, the 80/20 allocation, disabled new Wallet funding/bookings, private server-issued Parcel PINs, authenticated trip actions, a default-off live Card approval gate and provider-verified refund reservations/reconciliation.

APK/AAB/IPA artifacts do not deploy Firebase functions or database rules. The last read-only infrastructure check found seven missing secure production endpoints, different production rules, zero Paystack TEST subaccounts and absent isolated staging configuration. Follow `docs/PAYSTACK_TECHNICAL_ACCEPTANCE_20261017.md` for matching backend rollout and real provider/device acceptance before public store rollout or live Card activation.

No production Firebase deployment, App Store public submission, Play production upload or live payment activation is performed by the candidate build workflow. Existing customer Wallet records remain available for reconciliation.
