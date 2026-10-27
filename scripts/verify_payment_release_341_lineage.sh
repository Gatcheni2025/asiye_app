#!/usr/bin/env bash
# Guardrail: payment work, including the Android 351 mobile builds,
# MUST descend from the actual signed Android 11.0.71 (341) build and iOS
# 46522.0.0 (93124) IPA source. These are source commits, not store approvals.
set -euo pipefail
ANDROID_341="1646a9a9e4c4fa4145331316887ec3b04dbb3db1"
IOS_93124="2b6c424a463c7225ee264ac77aae45f5a2c94759"
echo "Asiye payment review HEAD: $(git rev-parse HEAD)"
for anchor in "$ANDROID_341" "$IOS_93124"; do
  git cat-file -e "$anchor^{commit}" || {
    echo "::error::Release source anchor $anchor cannot be fetched." >&2
    exit 1
  }
  git merge-base --is-ancestor "$anchor" HEAD || {
    echo "::error::Payment work is NOT descended from release $anchor." >&2
    exit 1
  }
  echo "OK: source includes release $(git rev-parse --short "$anchor")"
done
SOURCE_VERSION="$(awk '/^version:/ {print $2}' pubspec.yaml)"
case "$SOURCE_VERSION" in
  11.0.71+341|11.0.72+342|11.0.73+343|11.0.74+344|11.0.75+345|11.0.76+346|11.0.77+347|11.0.78+348|11.0.79+349|11.0.80+350|11.0.81+351) ;;
  *)
    echo "::error::Expected reviewed source version 11.0.71+341, 11.0.72+342 11.0.73+343 11.0.74+344, 11.0.75+345 11.0.76+346 11.0.77+347 11.0.78+348 11.0.79+349 11.0.80+350 or 11.0.81+351; found $SOURCE_VERSION." >&2
    exit 1
    ;;
esac
grep -Fq "ASIYE_IOS_MARKETING_VERSION: '46522.0.0'" .github/workflows/ios_release.yml || {
  echo "::error::iOS uploaded source version 46522.0.0 is not aligned." >&2
  exit 1
}
grep -Fq 'versionCode = flutter.versionCode' android/app/build.gradle.kts || {
  echo "::error::Android versionCode must continue deriving from pubspec." >&2
  exit 1
}
echo 'PASS: lineage includes the signed 11.0.71 (341) Android source and uploaded 46522.0.0 (93124) iOS source.'
echo "Validated payment source version: $SOURCE_VERSION"
echo 'RELEASE WARNING: previous versionCodes must not be republished. Mobile artifacts and TestFlight builds do not authorize a production backend or public store rollout.'
