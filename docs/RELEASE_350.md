# Asiye 11.0.80 (350) / iOS 46522.0.8 — driver OTP repair

This candidate fixes driver phone verification returning to the passenger flow. Native authentication now stores the selected sign-in role independently of the previous account's profile. A stale passenger localStorage session cannot overwrite driver intent. A fresh, UID-bound driver OTP attempt restores the driver login screen, including a reCAPTCHA return before codeSent has supplied a verification ID.

The native Resend code action retains the original Google/Apple UID. It cannot silently become a separate phone-account sign-in. Verification and callbacks reject changed accounts and mismatching roles. A recreated WebView can finish the same native driver's verified session; recovery state is cleared only after the driver WebView accepts the authenticated UID. Firebase errors remain on the driver phone screen.

The existing driver approval, phone verification, banking verification and Cash/Card controls remain enforced. No backend/rules, key, financial record, charge or payment launch change is included. The Hosting update selects only the shared native-auth bridge; the native routing repair requires these new signed packages and is not delivered to older installed apps by Hosting.

Validation includes native Dart routing/recovery and phone-account-link tests, JavaScript driver/passenger/OTP regressions, signed-package asset parity and the existing backend/rules security suite. Actual carrier SMS delivery and a physical-device reCAPTCHA return still need the operator's check after installing the candidate. TestFlight/public-store upload remains disabled.

After installation: choose Driver, sign in with Google/Apple, request the driver OTP, return from Firebase verification, enter the code or use Resend once, and verify that the same driver's enrollment/dashboard opens. Then check Menu → Banking details. Keep SMS codes and account/identity details private.
