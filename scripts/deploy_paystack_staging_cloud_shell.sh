#!/usr/bin/env bash
# One-time, owner-authorized Asiye Paystack TEST deployment.
# Execute in Google Cloud Shell from a clean clone of the review branch.
# No production Firebase writes, no live Paystack keys, and no role grants by this script.
set -euo pipefail
umask 077

readonly STAGING_PROJECT="asiye-paystack-staging"
readonly STAGING_NUMBER="1000800408896"
readonly PROD_PROJECT="asiye-80386"
readonly REVIEW_BRANCH="fix/paystack-subaccounts-cash-card-no-wallet"
readonly STAGING_DATABASE_URL="https://asiye-paystack-staging-default-rtdb.firebaseio.com"

fail() { printf 'BLOCKED: %s\n' "$1" >&2; exit 1; }
for tool in gcloud git node npm jq curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "Install $tool in Cloud Shell first."
done
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]] || fail "Node.js 20 or newer is required."
[[ "$(gcloud config get-value project 2>/dev/null)" == "$STAGING_PROJECT" ]] ||
  fail "Choose staging explicitly: gcloud config set project asiye-paystack-staging"
[[ "$(gcloud projects describe "$STAGING_PROJECT" --format='value(projectNumber)')" == "$STAGING_NUMBER" ]] ||
  fail "Staging project number mismatch. No deployment allowed."
[[ "$(git branch --show-current)" == "$REVIEW_BRANCH" ]] ||
  fail "Checkout the isolated Paystack review branch before deploying."
[[ "$(git rev-parse --show-toplevel)" == "$PWD" ]] ||
  fail "Run from the Asiye repository root."
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  fail "Working tree has tracked edits; use a fresh clone."
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
[[ -n "$ACTIVE_ACCOUNT" && "$ACTIVE_ACCOUNT" != *gserviceaccount.com ]] ||
  fail "Authenticate Cloud Shell as an authorized HUMAN staging administrator, not the GitHub service account."
[[ -f functions/package.json && -f scripts/paystack_function_manifest.json ]] ||
  fail "Wrong checkout: reviewed Firebase backend files are missing."
node -e 'const p=require("./functions/package.json"); if(p.main!=="index.js") process.exit(1);'
[[ "$STAGING_PROJECT" != "$PROD_PROJECT" ]] || fail "Production project forbidden."

printf '\nTarget: %s (number %s)\n' "$STAGING_PROJECT" "$STAGING_NUMBER"
printf 'Review commit: %s\n' "$(git rev-parse --short HEAD)"
printf 'Live Paystack processing must remain DISABLED. TEST key only.\n'
read -r -p "Type DEPLOY-STAGING to authorize isolated Firebase Functions and Hosting writes: " ACK
[[ "$ACK" == "DEPLOY-STAGING" ]] || fail "Cancelled before changes."

# Do not request or print a key. Verify the Secret Manager key already staged
# by the guarded GitHub workflow is TEST-only, using the local admin identity.
SECRET_CHECK="$(gcloud secrets versions access latest --secret=PAYSTACK_SECRET_KEY --project "$STAGING_PROJECT" 2>/dev/null)" ||
  fail "Cannot read the existing staging Paystack TEST secret. Fix this privately."
[[ "$SECRET_CHECK" =~ ^sk_test_[A-Za-z0-9]+$ ]] ||
  fail "Staging Paystack secret is not a TEST key. No deployment attempted."
unset SECRET_CHECK

# Install an exact CLI version in a local ignored tool directory, never globally.
CLI_ROOT="$PWD/.asiye-staging-cli"
mkdir -p "$CLI_ROOT"
npm --prefix "$CLI_ROOT" install --no-audit --no-fund --no-save firebase-tools@15.34.0
readonly FIREBASE="$CLI_ROOT/node_modules/.bin/firebase"
[[ -x "$FIREBASE" ]] || fail "Pinned Firebase CLI installation failed."
npm --prefix functions install --no-audit --no-fund
# Firebase CLI needs a signed-in human. If not signed in, follow the printed
# login command outside this script and then run the script again.
"$FIREBASE" projects:list --json >/dev/null 2>&1 ||
  fail "Firebase CLI not logged in. Run: $FIREBASE login --no-localhost ; then retry this script."

# Obtain PUBLIC staging Web SDK identifiers via Firebase Management API;
# never paste API keys or account credentials into the terminal/chat.
ACCESS_TOKEN="$(gcloud auth print-access-token)"
APP_LIST="$(curl --fail --silent --show-error --header "Authorization: Bearer $ACCESS_TOKEN" \
 "https://firebase.googleapis.com/v1beta1/projects/$STAGING_PROJECT/webApps")" ||
  fail "Unable to list staging Firebase Web apps."
APP_NAME="$(printf '%s' "$APP_LIST" | jq -r '.apps[0].name // empty')"
[[ "$APP_NAME" == projects/$STAGING_PROJECT/webApps/* ]] ||
  fail "No isolated staging Firebase WEB app found."
APP_SUFFIX="$(printf '%s' "$APP_NAME" | cut -d / -f 4)"
[[ "$APP_SUFFIX" == 1:$STAGING_NUMBER:web:* ]] ||
  fail "Staging Firebase WEB app ID does not match the staging project number."
SDK_JSON="$(curl --fail --silent --show-error --header "Authorization: Bearer $ACCESS_TOKEN" \
 "https://firebase.googleapis.com/v1beta1/$APP_NAME/config")" ||
  fail "Unable to fetch staging Firebase WEB SDK configuration."
unset ACCESS_TOKEN APP_LIST

export STAGING_PROJECT
export GITHUB_REF_NAME="$REVIEW_BRANCH"
export FIREBASE_CONFIG="$(printf '%s' "$SDK_JSON" | jq --compact-output \
 --arg project "$STAGING_PROJECT" --arg db "$STAGING_DATABASE_URL" \
 '. + {projectId:$project,databaseURL:$db,authDomain:($project+".firebaseapp.com")}')" ||
  fail "Cannot parse staging Web SDK configuration."
export FIREBASE_STAGING_WEB_CONFIG="$FIREBASE_CONFIG"
export FIREBASE_STAGING_PROJECT="$STAGING_PROJECT"
unset SDK_JSON
node -e 'const {requireStagingConfig}=require("./scripts/build_staging_web_preview.cjs");requireStagingConfig(JSON.parse(process.env.FIREBASE_CONFIG),process.env.STAGING_PROJECT)'
node scripts/build_staging_web_preview.cjs
node scripts/prepare_staging_function_scope.cjs

SELECTOR="$(node -e 'process.stdout.write(require("./scripts/paystack_function_manifest.json").map(n=>"functions:"+n).join(","))')"
[[ -n "$SELECTOR" ]] || fail "Empty reviewed Functions selection."
LOG_FILE="$(mktemp "$HOME/asiye-staging-functions.XXXXXX.log")"
chmod 600 "$LOG_FILE"
printf 'Deploying reviewed staging Functions only. Private log: %s\n' "$LOG_FILE"
if ! "$FIREBASE" deploy --project "$STAGING_PROJECT" --only "$SELECTOR" \
  --non-interactive --debug > "$LOG_FILE" 2>&1; then
  node scripts/summarize_staging_deploy_error.cjs "$LOG_FILE" "Cloud Functions" || true
  printf '\nSTOP: Staging Functions deployment failed. Private log remains only in your Cloud Shell.\n' >&2
  printf 'Do not post the raw log, as it may contain tokens or private metadata.\n' >&2
  exit 1
fi
rm -f "$LOG_FILE" firebase-debug.log
printf 'Staging Functions CLI deploy succeeded. Deploying isolated WEB-only preview...\n'
"$FIREBASE" deploy --project "$STAGING_PROJECT" --config firebase.staging.generated.json \
  --only hosting --non-interactive
printf '\nSTAGING DEPLOYMENT FINISHED. Verify actual functions and full TEST card journey before launch.\n'
printf 'Staging URL: https://asiye-paystack-staging.web.app/passenger-v2/index.html\n'
printf 'Production project and live Card mode were NOT activated by this script.\n'
