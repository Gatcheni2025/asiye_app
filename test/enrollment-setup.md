# Driver enrollment rollout

The camera selfie is a photograph for manual review, not biometric verification or a liveness test. Driver licence uploads accept PDF, JPG, PNG or WebP (up to 10 MB); ID/passport, vehicle, and selfie uploads accept images. Three references and banking details are mandatory. Sensitive documents are stored by private Storage path, never by public download URL or localStorage.

Before collecting real applications:

1. Merge `enrollment.rules.fragment.json` into Realtime Database rules and the match block from `enrollment.storage.rules` into Storage rules. Remove any overlapping public/parent grants. Test owner, other-user, reviewer, and anonymous access in the Firebase emulators.
2. Use a trusted Admin SDK reviewer process to inspect each application and all four uploaded files, verify references and banking details, and record an approval. A reviewer custom claim (`enrollmentReviewer`) must be assigned by a trusted administrator; the publicly writable `admins` node is deliberately not used.
3. For a new driver, provision the `taxis/{driverId}` profile with the authenticated driver's `authUid`, name, phone, vehicle registration and required vehicle/operational fields. Set `driverApprovals/{authUid}` to `{ "status": "approved", "version": 1, "reviewedAt": <server timestamp> }` only after successful review and profile provisioning. Rejection uses `status: "rejected"`. Approval writes are Admin SDK only.
4. Existing drivers are also gated; they must submit and receive version-1 approval. Arrange a rollout before enabling this for the live driver fleet.
5. Replace public writes on `taxis` and `requests` with trusted backend operations or rules requiring a current `driverApprovals/{auth.uid}` approval before online status, request acceptance, and trip start. The new browser checks alone are NOT server-side enforcement. A complete replacement cannot safely be inferred from the publicly writable multi-role legacy schema.
6. Establish document retention/deletion and rejection/resubmission procedures. Uploaded files are immutable to clients. Failed submissions can leave orphaned private uploads for an administrator to remove. A rejected applicant sees the waiting/review screen; corrections require a reviewer-managed reset.

Not deployed: database/storage rules, reviewer service, approval provisioning, and server-side trip authorization. No personal documents were uploaded during development. Test native camera permissions and PDF/image picking in the Flutter WebView, plus pending/approved/rejected flows on real accounts before release.

References use named children reference1, reference2 and reference3, matching the supplied database rules. Older array payloads are rejected by those rules. Deploy the updated enrollment page/scripts and publish the updated Storage match block to enable licence images; the supplied Realtime Database enrollment rules already accept the corrected payload.
