# Asiye 11.0.57 (327) — Driver enrollment release checks

This release candidate must **not** be published until staging and one real Android device pass the following tests. Backend is Firebase project `asiye-80386`.

## Correct enrollment lifecycle

1. Sign in with Firebase phone OTP. The registered phone number is prefilled, read-only, and used in the enrollment record. An OAuth-only session without a verified phone cannot enroll.
2. A driver with no enrollment or verified legacy driver profile is allowed to complete the seven steps: verified phone and name; native live face scan and ID; native rear-camera car photo and vehicle type/make/model/colour/year/registration/seats; driver's licence, residential address and proof of address; three references; banking; review and submit.
3. The form uploads five objects to Firebase Storage under `driverEnrollments/{authUid}/{submissionId}/{selfie|identity|car|licence|address}`, then creates `driverEnrollments/{authUid}` *once*. A separate best-effort `taxis/{authUid}` seed leaves the profile offline. The admin review Function creates/updates the verified taxi profile if that seed failed.
4. A saved pending enrollment always renders the **Pending approval** screen with a status refresh, reference and **Log out** action. It cannot be recreated by reloading the app or a second OTP login.
5. Admin > **New Driver Approvals** shows all five files and submitted vehicle details, then calls `reviewDriverEnrollment`. Admin approval version 2 is accepted by the shared enrollment gate; on approval driver can enter the app, subject to vehicle and safety checks. Rejected/suspended users cannot re-enroll themselves.

## Backend and deployment

- Review PR #13 and run Android Release, Asiye 327 Admin and Support Checks, and Firebase Security Validation on its final head commit.
- Deploy the updated **Realtime Database rules** from `database.rules.json`. The old production version-1 schema rejects new version-2 registrations. Version-2 rules require Firebase Auth's verified `phone_number` claim to match the submitted phone and all five document paths, including address confirmation.
- Deploy changed Firebase Functions selectively, notably `reviewDriverEnrollment` (and the release's `adminManagePlatform` updates). **Do not deploy an unrelated or older set of payment functions.**
- Deploy the updated driver `enrollment.html`, `enrollment-gate.js`, `enrollment.js`, `login.js`, `enrollment.css` and admin panel. Keep release native camera sources in the signed app.
- **Verify existing Firebase Storage rules in the Firebase Console.** The repo's `firebase.json` does not currently manage Storage rules. Ensure a verified driver can CREATE (not overwrite another person's files) JPG/PNG/WebP/PDF up to 10 MB under the path above. A safe *example to merge into the existing production rules*, **not** an entire replacement ruleset, is:

```
match /driverEnrollments/{uid}/{submission}/{kind} {
  allow create: if request.auth != null
    && request.auth.uid == uid
    && kind in ['selfie','identity','car','licence','address']
    && request.resource.size > 0
    && request.resource.size <= 10 * 1024 * 1024
    && request.resource.contentType.matches('image/jpeg|image/png|image/webp|application/pdf');
  allow read: if request.auth != null && request.auth.uid == uid;
  allow update, delete: if false;
}
```

  Integrate this carefully into the existing `service firebase.storage` rules and preserve existing profile/trip upload permissions; never replace production rules blindly. Admin obtains reviewed download links through authenticated `adminFetchData` (and controls must not expose these links publicly).

## Staging acceptance

- New OTP-verified driver completes every step with five real files, reaches **Pending approval** and has no booking/dashboard access.
- Force-close/relaunch Android, sign in with the same number, press **Check approval**: pending screen remains, no re-upload/re-registration.
- Pending driver can **Log out** and sign in as a different driver.
- Admin can open selfie, car image, ID, licence and proof of address; missing docs or unverified phone prevent approval.
- Admin approves a valid driver; driver status changes to approved and enters the dashboard, without repeating OTP/enrollment unless genuinely signed out.
- Admin rejects a test driver with a reason; they see a final review outcome, not a blank enrollment form.
- Test existing verified legacy driver login, image upload permissions, and driver/passenger support chat to prevent regressions.

Do not call the release published until CI passes, signed APK/AAB are created, and staging/device acceptance is recorded.
