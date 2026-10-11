# Asiye 11.0.68 (338): passenger fares and saved places

Passenger Go offers/counteroffers and Work negotiation show passenger/group fares without the driver's net earnings or Asiye commission amounts. Fare limits, 20/80 accounting and server-side commercial protections are unchanged.

Home and Work shortcuts now open the existing address autocomplete, save the selected resolved address, and reuse it as a destination. Saved addresses can be edited or removed. Saving an address does not change the pickup or start a booking.

Recent places record successfully routed destination selections, newest first, with duplicates removed and a maximum of ten places. Passengers can select or remove individual entries. Empty and cleared searches restore the destination shortcuts. Cancelled or outdated Google detail responses cannot save an address into a different screen.

Places persist in account-specific local storage on this device, scoped to the current Firebase UID. They are not synced between devices; uninstalling/clearing app data removes them. Invalid data is discarded safely, storage failures are reported, and an account switch during editing prevents a save into the next account.

Validation before packaging: six new DOM/behavior tests, four Club UI tests, and the existing 98 Android release regression tests passed. JavaScript syntax and whitespace checks passed. CI performs signed APK/AAB builds and the Firebase emulator suite. Real-device address search/keyboard, route navigation and account persistence still need acceptance testing.

This release needs new APK/AAB packages because bundled passenger assets changed. The already deployed 11.0.67 Club backend remains compatible; no new Functions or database rule changes are required. No Play publication is automatic.

## Verified build results

Source `59b04a6629d534ee3514616c40fe8048cef47728` passed [Android Release](https://github.com/Gatcheni2025/asiye_app/actions/runs/38177006202): 98 release regression tests, signed APK/AAB builds, APK signature verification and artifact uploads. The matching [Firebase Security Validation](https://github.com/Gatcheni2025/asiye_app/actions/runs/38177006288) passed all 73 tests, including the new saved-place behavior checks.

Artifacts: `asiye-11.0.68-338-apk` and `asiye-11.0.68-338-aab`. Extract the artifact ZIP before installing the APK or uploading the AAB. Device acceptance and Play publication were not performed by these builds.
