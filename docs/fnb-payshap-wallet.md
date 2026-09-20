# Asiye Wallet — FNB PayShap Request-to-Pay

## Purpose

Asiye passengers can add money to their Asiye Wallet by creating a PayShap Request-to-Pay. The app creates the request through an Asiye-owned HTTPS backend, the passenger approves the request in their banking app, and the Asiye backend credits the wallet only after the payment is confirmed.

The client never stores FNB credentials and never increments wallet balances.

## Client flow

1. Passenger opens **Wallet**.
2. Passenger enters a ZAR amount and taps **Request payment**.
3. The WebView obtains the signed-in passenger's Firebase ID token.
4. The client calls `POST /api/wallet/payshap/requests` with:
   ```json
   {
     "amount": 100.00,
     "currency": "ZAR"
   }
   ```
5. The Asiye backend verifies the Firebase ID token and resolves the passenger profile itself.
6. The backend creates an internal top-up record and submits a Payment Request to FNB using the FNB-provided Integration Channel contract.
7. The client polls `GET /api/wallet/payshap/requests/{id}` for display status only.
8. Independently of the client, the backend reconciles the FNB request until it reaches a final state.
9. When FNB confirms payment, the backend atomically posts a wallet ledger credit exactly once and updates the passenger wallet balance.
10. The existing Firebase realtime listener refreshes the wallet UI automatically.

## Asiye API contract

### Create payment request

`POST /api/wallet/payshap/requests`

Authentication:

`Authorization: Bearer <Firebase ID token>`

Request:

```json
{
  "amount": 100.00,
  "currency": "ZAR"
}
```

Successful response:

```json
{
  "id": "topup_internal_id",
  "status": "pending",
  "reference": "ASIYE-...",
  "expiresAt": "2026-09-20T18:45:00+02:00"
}
```

The client must not send an authoritative wallet owner, balance, payer phone number, bank request ID, or credit status. The server derives and validates identity.

### Get payment request

`GET /api/wallet/payshap/requests/{id}`

Successful response:

```json
{
  "id": "topup_internal_id",
  "status": "credited",
  "amount": 100.00,
  "currency": "ZAR",
  "reference": "ASIYE-...",
  "creditedAt": "2026-09-20T18:22:13+02:00",
  "balance": 245.00
}
```

Recommended Asiye-facing statuses:

- `pending`
- `processing`
- `paid`
- `credited`
- `failed`
- `rejected`
- `cancelled`
- `expired`

The FNB adapter maps FNB's actual status values to these internal states.

## Required backend controls

### Authentication

Verify every Firebase ID token server-side. Resolve `authUid -> commuter` on the server. A request ID may only be viewed by its owner or an authorised Asiye administrator.

### Money representation

Convert the amount to integer cents immediately, for example R100.25 -> 10025. Do not use floating-point arithmetic for ledger accounting.

### Idempotent wallet credit

A bank payment must never be able to credit the wallet twice.

Use a database transaction/lock with a unique constraint covering the internal top-up and the bank payment/request identifier. Within one transaction:

1. Lock the top-up record.
2. Confirm it has not already been credited.
3. Confirm bank state is a successful paid state.
4. Insert an immutable wallet ledger credit.
5. Update the materialised wallet balance.
6. Mark the top-up `credited` with a timestamp.
7. Commit.

Repeated callbacks, polling results, worker retries, app refreshes, or duplicate bank notifications must return the already-credited result without adding money again.

### Reconciliation worker

Automatic crediting cannot depend on the phone remaining open.

Run a server-side worker that periodically checks all non-final FNB payment requests through the FNB-supported query/status mechanism. If the FNB contract supplied to Asiye includes a callback/webhook mechanism, use it for fast updates but still keep reconciliation as the recovery path.

### Reversals

Never delete ledger entries. If a settled payment can later be reversed under the contracted bank flow, add a separate reversal/debit ledger transaction with its own idempotency key and audit trail.

### Secrets

Keep all FNB credentials in the server secret manager/environment only. Typical configuration categories are:

```text
FNB_CLIENT_ID
FNB_CLIENT_SECRET
FNB_TOKEN_URL
FNB_PAYMENT_REQUEST_URL
FNB_PAYMENT_QUERY_URL
FNB_SIGNING_PRIVATE_KEY / certificate reference (if required by the supplied contract)
FNB_ENVIRONMENT=sandbox|production
```

The exact token URLs, Payment Request endpoints, scopes, headers, signing requirements, request/response fields, and status values must come from the OpenAPI/Swagger and credentials issued to Asiye by FNB/RMB Integration Channel. Do not infer or hard-code undocumented bank fields.

## Suggested data model

```text
wallet_topups
  id
  commuter_id
  amount_cents
  currency
  internal_reference
  bank_request_id
  bank_status
  asiye_status
  created_at
  updated_at
  paid_at
  credited_at
  expires_at
  last_bank_response_hash

wallet_ledger
  id
  commuter_id
  topup_id
  type = credit | debit | reversal
  amount_cents
  currency
  balance_after_cents
  idempotency_key UNIQUE
  created_at
  metadata_json
```

## Client configuration

The packaged Flutter/WebView build reads:

```js
ASIYE_CONFIG.payshap = {
  apiBase: 'https://YOUR-ASIYE-PAYMENT-BACKEND',
  createRequestPath: '/api/wallet/payshap/requests',
  requestStatusPath: '/api/wallet/payshap/requests',
  pollIntervalMs: 3000
};
```

For a normal hosted web build, leaving `apiBase` blank uses the current HTTPS origin. A local Flutter asset/WebView build requires an explicit HTTPS backend URL.

The backend CORS policy should allow only the actual Asiye web/app origins used in production. Authorization is still mandatory for every request.

## FNB onboarding checklist

Before enabling the button in production, obtain from FNB/RMB:

- Integration Channel access for **Payment Request**.
- Sandbox/UAT and production credentials.
- The current Payment Request OpenAPI/Swagger.
- Exact OAuth/token configuration.
- Required certificates/signing setup, if applicable.
- Payer identifier rules supported by the contracted API.
- Request expiry rules and final status list.
- Query/reconciliation API details.
- Any callback/event mechanism included in the contract.
- Production endpoint URLs and rate limits.

Once these are supplied, only the server-side FNB adapter should need bank-specific changes; the Flutter/WebView wallet contract remains stable.
