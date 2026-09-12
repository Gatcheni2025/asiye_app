## Firebase chat access

Merge `rules.tripChats` from `trip-chat.rules.fragment.json` into the existing Realtime Database rules before deploying chat. Do not replace the rest of the database rules. Parent/root grants must not allow unrelated users to read or write this subtree, because child rules cannot revoke parent grants.

Conversations live at `tripChats/{requestId}/{passengerId}`. The assigned driver's `requests/{requestId}/driverAuthUid` and the passenger's Firebase UID (or `commuters/{passengerId}/authUid`) authorize access. These identity mappings and request membership must be protected from changes by unrelated users. Club passengers receive separate conversations.

The rules allow authenticated participants to read history and append messages, enforce sender identity, restrict text to 1–1000 characters, and prohibit edits/deletes. Existing production rules and identity mapping protections were not available here, so this fragment has not been deployed or emulator-validated.

Before release, test with separate driver/passenger sign-ins: send in both directions, reopen history, change Club recipients, reject a third user's reads/writes, reject forged sender IDs, and verify offline/denied sends retain the draft. Current chat updates while the dialog is open; unread notifications are not implemented.
