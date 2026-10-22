# Staging admin login and driver approvals

The passenger dashboard and a submitted driver application were demonstrated on staging on 22 October. The next acceptance step is an authorized reviewer approving the driver.

## Changes

- Canonical admin login: `/admin/`, with Google, Apple and existing email/password sign-in.
- A named Firebase app and session persistence keep admin authentication separate from passenger and driver sessions.
- Firebase popup/iframe origins are explicitly permitted by the admin content security policy.
- Signing in does not grant reviewer rights. A denied account stays signed in, shows its email/UID, and can **Check access again** after owner provisioning.
- Staging reviewers see only Driver approvals and Documents. The server checks `enrollmentReviewer` or existing full-admin authorization before listing driver applications or approving/rejecting them. Financial admin APIs still require full admin rights.
- Two staging Gen2 callable APIs are added: `adminEnrollmentConsole` and `reviewDriverEnrollmentSecure`. The existing production Gen1 `reviewDriverEnrollment` entrypoint is preserved.
- Legacy `admin-login.html` and `create-admin.html` lead to the secure console. Public clients can no longer create the first `/admins/{uid}` record. Reviewer provisioning happens only through privileged Google Cloud credentials.
- Expected staging inventory increases from 39 to 41 Functions; hosted parity includes admin assets.

## Deploy from the existing human Cloud Shell session

```bash
cd ~/asiye-staging-review
git pull --ff-only origin fix/paystack-subaccounts-cash-card-no-wallet
node scripts/deploy_staging_driver_admin.cjs
```

This checks the review branch, staging project and number, deploys protected database rules, the two reviewer Functions from an isolated reviewed archive, verifies their immutable source, then deploys Hosting and runs readback. It does not grant a reviewer role automatically. Cleanup-policy-only errors are handled after successful function operations and independent source verification; `--resume-after-functions` resumes an interrupted deployment.

Open https://asiye-paystack-staging.web.app/admin/ and sign in with the intended reviewer's Google/Apple account.

If access is not assigned, provision one exact account using the existing authorized Cloud Shell identity:

```bash
# Same Google email as the human signed into Cloud Shell:
node scripts/grant_staging_driver_reviewer.cjs --self
```

For a different account, including an Apple relay email, use its exact email displayed by admin login:

```bash
node scripts/grant_staging_driver_reviewer.cjs --email 'EXACT_REVIEWER_EMAIL'
```

The selected Firebase account must already exist, have a verified email and be enabled. The helper preserves existing claims and adds only `enrollmentReviewer: true`; it does not set full-admin flags, alter passwords, grant IAM roles or approve a driver. No tokens or keys are printed.

Return to Admin and click **Check access again**. Open **Driver approvals → View details**, review the five documents, then **Approve driver**. The reviewer confirmation is explicit; no application is automatically approved during deployment or tests. On the driver's pending screen, **Check approval status** should open the approved dashboard.

## Verification

Source and browser tests cover isolated sessions, social sign-in, denied account recovery, canonical record IDs, document review and logout. Firebase emulator tests run the actual reviewer/list/approval handlers, deny ordinary users and financial operations, reject incomplete documents and prevent public admin bootstrap.

Real Google/Apple admin login, owner-selected reviewer provisioning and document approval on staging still require the user's authenticated acceptance. Production deployment and public mobile release are separate decisions.
