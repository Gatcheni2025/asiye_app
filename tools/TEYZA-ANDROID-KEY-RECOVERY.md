# Recover the original Teyza Android upload key

The existing Play listing is `com.asiyedriver.asiye`. Its required upload-certificate SHA-256 is:

```
E5:58:B6:90:44:75:77:F9:C7:35:26:64:74:72:87:09:8A:68:11:DD:7F:0A:8F:AC:39:C6:68:9C:17:E6:26:08
```

Run the existing manual workflow from this dedicated branch:

```powershell
gh workflow run teyza-signing-transfer.yml --repo Gatcheni2025/asiye_app --ref fix/teyza-legacy-android-key
```

The recovery checks `KEYSTORE_BASE64` and `ANDROID_KEYSTORE_BASE64`, using the existing source passwords. It enumerates private-key entries, requires the exact public fingerprint above, and signs and verifies a disposable file before saving any target settings. It does not generate a replacement key. Unreadable or nonmatching backups cannot be copied. If no usable match exists, the job fails without changing Teyza settings.

A verified match is copied directly to `Gatcheni2025/Business-lift` using the existing signing-transfer token, falling back to `GH_PAT`. Only these Android secrets are restored: `TEYZA_ANDROID_STORE_PASSWORD`, `TEYZA_ANDROID_KEY_PASSWORD`, `TEYZA_ANDROID_KEY_ALIAS`, `TEYZA_ANDROID_KEYSTORE_BASE64`. The public variable `TEYZA_PLAY_UPLOAD_CERT_SHA256` is set to the pinned fingerprint. Source signing secrets and iOS settings are unchanged. A network failure during the separate GitHub writes requires rerunning the recovery to complete the settings.

The `teyza-legacy-android-public` artifact contains only the public certificate (`teyza-upload.cer` and `teyza-upload.pem`) and a public fingerprint/status report. Private key material is not exported in artifacts or logs.

After the run succeeds, download and extract that public artifact to a separate folder. From the desktop folder containing `CONNECT-PLAY-PACKAGE.ps1`, run it with the recovered certificate's full path:

```powershell
.\CONNECT-PLAY-PACKAGE.ps1 -CertificatePath "$env:USERPROFILE\Downloads\teyza-legacy-android-public\teyza-upload.cer"
```

Enter the same Play upload fingerprint and the app-signing SHA-1 and SHA-256 from the **existing Teyza listing**. This connects Firebase/Google authentication to the correct package and certificate. After that helper succeeds, build Android:

```powershell
gh workflow run teyza-mobile-release.yml --repo Gatcheni2025/Business-lift --ref fix/teyza-existing-play-package -f signed_release=true -f platforms=android
```

If no usable matching key is found, recover another original backup or request a Play **upload-key reset** using the existing Teyza upload certificate. Do not change the Play app-signing key or create another listing. Reset approval is a separate Play Console action and is not performed by this workflow.

The default-branch Apple job is retained and restricted to `main`. The Android recovery job runs only on `fix/teyza-legacy-android-key`; it does not build or publish an app.

