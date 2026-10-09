# Asiye Operations Console — /admin

New, independent administrator interface with restricted Firebase access.

## Files

- `assets/admin/index.html` — the separate admin login and operations page
- `assets/admin/console.css` — responsive dashboard styling
- `assets/admin/console.js` — management tables, approvals, audit and support
- `functions/admin-operations.js` — server-audited invitations and refund *cases*, never payment transfers
- `functions/index.js` — existing admin APIs, new `adminOperations`, approved read resources and stricter administrator scope
- `firebase.json` — Firebase Hosting mapping for `/admin`, private/no-store response headers

## Capabilities

Overview, driver enrollment approvals and documents, driver/passenger profiles,
ride and parcel bookings, passenger wallet balances, wallet payments and manual
EFT reconciliation, driver card payout records, payout requests, refund cases,
support conversations, user pre-registration invitations and audit records.

Data fetching is through existing `adminWhoAmI` / `adminFetchData` callable
functions; privileged changes require server-side `adminManagePlatform`,
`reviewDriverEnrollment` or `adminOperations`.
The admin API returns **up to 500 recent items per resource**. Counts and sums
are *not* platform lifetime totals or an audited financial reconciliation.

Financial safeguards: refund cases **do not** execute Paystack or bank refunds;
payout approval **does not** transfer funds. Wallet changes and EFT credits
act on live balances and require explicit confirmation and audit notes.
Invitation creation **does not** create or verify an Auth user; the user must
complete their own Firebase SMS OTP and enrollment.

All account access is gated by Firebase Auth and `requireAsiyeAdmin`, checking
full admin claims or `admins/{uid}` records. `enrollmentReviewer` alone is
no longer a full-platform admin: that role remains allowed **only** on the
separate `reviewDriverEnrollment` callable. Never create admins from a
public onboarding page or grant unrestricted RTDB admin permissions.

## Firebase Hosting deployment (review before production)

Use the exact reviewed Git branch; don't accidentally deploy old main.
Firebase CLI, project credentials and Node.js 22 are required.

```powershell
cd C:\Users\PC\Desktop\coding\asiye_app_phase5
git fetch origin
git pull --ff-only origin release/11.0.57-admin-support-327
git status -sb

node --check assets/admin/console.js
node --check functions/admin-operations.js
node --test test/admin-portal.test.cjs
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"

npx firebase-tools deploy --project asiye-80386 --only "functions:adminWhoAmI,functions:adminFetchData,functions:adminManagePlatform,functions:reviewDriverEnrollment,functions:adminOperations"
npx firebase-tools deploy --project asiye-80386 --only hosting
```

The Firebase Hosting route is `https://asiye-80386.web.app/admin`
(or `/admin/`). It will be `https://asiye.cloud/admin` **only if
asiye.cloud serves this Firebase Hosting site or the new folder is also
uploaded onto the actual asiye.cloud website host**.

### If asiye.cloud is hosted on a separate server (cPanel / FileZilla)

Create the directory `public_html/admin/` on **the web host that actually
serves asiye.cloud** and upload these three files from the Git checkout:

1. `assets/admin/index.html` -> `public_html/admin/index.html`
2. `assets/admin/console.css` -> `public_html/admin/console.css`
3. `assets/admin/console.js` -> `public_html/admin/console.js`

Do not upload `functions/index.js`, Firebase Admin SDK credentials, RTDB
data, bank statements or service-account secrets to the public web root.
The browser pages call the previously deployed Cloud Functions securely.
You still must deploy the backend changes separately in Firebase.
On Apache-style hosts, directory index usually routes `/admin/` to
`/admin/index.html`; test exact `/admin` redirect on that host.

**Do not repoint asiye.cloud's DNS to Firebase blindly**, which would
replace or break the current marketing homepage if it is hosted elsewhere.

## Security and quality gates

1. Signed-out visitor is presented with login only; no privileged data in static HTML.
2. Passenger, driver and `enrollmentReviewer`-only accounts are denied the
   operations API. Only configured full admins can view/modify it.
3. Valid admin sees the live dashboard. The recent-record cap is disclosed.
4. Enrollments list all five documents and a valid admin can review them.
5. Driver approval is written through the callable backend and audited.
6. Support reply creates an admin message and notification.
7. A refund case is recorded without changing a wallet or sending money.
8. A registration invitation remains pending until user verifies phone by OTP.
9. A wallet adjustment is tested with an authorized, reversible staging
   amount; confirm server audit and wallet ledger before live use.
10. Set up MFA for administrator accounts and review POPIA retention/access
    for ID scans, address evidence, financial data and chat transcripts.

Do not claim `asiye.cloud/admin` is live until that host serves the new
folder and an authorized admin login passes real-device testing.
