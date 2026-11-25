#!/usr/bin/env bash
# Pansari Express - deploy from Google Cloud Shell (https://shell.cloud.google.com).
# Cloud Shell is already signed in as you, so no login prompts. Run:
#   git clone https://github.com/kritikakhandelwal1199-commits/pansari-express.git && cd pansari-express
#   bash scripts/deploy-cloudshell.sh <firebase-project-id> [+91owner-phone]
# Before: the project exists, is on Blaze, and Storage has been started in the console.
# Safe to re-run. Generated secrets live in ~/.pansari-<project>.env (keep private).
# The Cloudflare edge worker (walk-in QR) is deployed separately; set EDGE_URL and re-run to wire it in.
set -euo pipefail
PROJECT="${1:?usage: deploy-cloudshell.sh <project-id> [owner-phone]}"
PHONE="${2:-+918696131859}"
REGION=asia-south1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
STATE="$HOME/.pansari-$PROJECT.env"
say() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

say "Installing packages"
npm ci --no-audit --no-fund
npm run build -w @pansari/shared
npm run build -w @pansari/adapters
FB="npx --no-install firebase"
gcloud config set project "$PROJECT" >/dev/null
printf '{\n  "projects": { "default": "%s" }\n}\n' "$PROJECT" > .firebaserc

say "Turning on the Google APIs the app needs"
gcloud services enable firestore.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com secretmanager.googleapis.com \
  firebasestorage.googleapis.com identitytoolkit.googleapis.com pubsub.googleapis.com --project "$PROJECT"

say "Firestore database ($REGION)"
if ! gcloud firestore databases describe --database='(default)' --project "$PROJECT" >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native --project "$PROJECT"
fi

say "Secrets"
if [ ! -f "$STATE" ]; then
  gen() { head -c 36 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
  { echo "QR_KEY=$(gen)"; echo "EDGE_SECRET=$(gen)"; echo "IRP_KEY=$(gen)"; } > "$STATE"; chmod 600 "$STATE"
fi
# shellcheck disable=SC1090
source "$STATE"
QR_JSON="{\"k1\":\"$QR_KEY\"}"
if [ -z "${SECRETS_SET:-}" ]; then
  printf '%s' "$QR_JSON" | $FB functions:secrets:set QR_HMAC_KEYS --data-file - --project "$PROJECT" --force
  printf '%s' "$EDGE_SECRET" | $FB functions:secrets:set EDGE_SHARED_SECRET --data-file - --project "$PROJECT" --force
  echo "SECRETS_SET=1" >> "$STATE"
fi
mkdir -p functions/deploy
cat > functions/deploy/.env <<EOF
BOOTSTRAP_PHONE=$PHONE
PAYMENTS_MODE=mock
MOCK_IRP_KEY=$IRP_KEY
ENFORCE_APP_CHECK=false
EOF

say "Web app config"
if [ -z "${WEB_APP_ID:-}" ]; then
  WEB_APP_ID=$($FB apps:list WEB --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result||[];const a=r.find(x=>x.displayName==="Pansari Web");process.stdout.write(a?a.appId:"")})')
  if [ -z "$WEB_APP_ID" ]; then
    WEB_APP_ID=$($FB apps:create WEB 'Pansari Web' --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).result.appId))')
  fi
  echo "WEB_APP_ID=$WEB_APP_ID" >> "$STATE"
fi
CFG=$($FB apps:sdkconfig WEB "$WEB_APP_ID" --project "$PROJECT" --json)
cfg() { printf '%s' "$CFG" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).result;const c=r.sdkConfig||r;process.stdout.write(String(c['$1']||''))})"; }
API_KEY=$(cfg apiKey); AUTH_DOMAIN=$(cfg authDomain); BUCKET=$(cfg storageBucket); APP_ID=$(cfg appId)
[ -n "$API_KEY" ] || { echo "Could not read the web config"; exit 1; }
[ -n "$BUCKET" ] || BUCKET="$PROJECT.firebasestorage.app"
EDGE="${EDGE_URL:-}"

cat > apps/web/.env.production <<EOF
NEXT_PUBLIC_DATA_MODE=firebase
NEXT_PUBLIC_FIREBASE_API_KEY=$API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID=$PROJECT
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$BUCKET
NEXT_PUBLIC_FIREBASE_APP_ID=$APP_ID
NEXT_PUBLIC_FUNCTIONS_REGION=$REGION
NEXT_PUBLIC_USE_EMULATORS=false
NEXT_PUBLIC_EDGE_URL=$EDGE
EOF
cat > apps/mobile/.env <<EOF
EXPO_PUBLIC_DATA_MODE=firebase
EXPO_PUBLIC_FIREBASE_API_KEY=$API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=$AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID=$PROJECT
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=$BUCKET
EXPO_PUBLIC_FIREBASE_APP_ID=$APP_ID
EXPO_PUBLIC_FUNCTIONS_REGION=$REGION
EXPO_PUBLIC_EDGE_URL=$EDGE
EXPO_PUBLIC_WEB_URL=https://$PROJECT.web.app
EOF

say "Building the website"
NEXT_TELEMETRY_DISABLED=1 npm run build -w @pansari/web

say "Deploying rules, indexes, storage rules, functions and website"
$FB deploy --only firestore,storage,functions,hosting --project "$PROJECT" --force --non-interactive

say "Done"
echo "Website : https://$PROJECT.web.app"
echo "Next    : open https://$PROJECT.web.app/login, sign in with $PHONE, press 'First-time setup'."
