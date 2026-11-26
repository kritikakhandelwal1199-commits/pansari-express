#!/usr/bin/env bash
# Pansari Express - deploy the Cloudflare edge worker (walk-in QR + counter checkout) from Google Cloud Shell,
# then rebuild the website so it talks to the worker. Run after scripts/deploy-cloudshell.sh:
#   bash scripts/deploy-edge-cloudshell.sh <firebase-project-id>
# Cloudflare sign-in: either `export CLOUDFLARE_API_TOKEN=...` first (token with "Edit Cloudflare Workers"),
# or run `npx wrangler login --browser=false` in edge/worker before this script (see docs/GO-LIVE.md).
# Uses the same secrets file as the Firebase deploy (~/.pansari-<project>.env), so QR keys match the functions.
set -euo pipefail
PROJECT="${1:?usage: deploy-edge-cloudshell.sh <project-id>}"
REGION=asia-south1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
STATE="$HOME/.pansari-$PROJECT.env"
say() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
[ -f "$STATE" ] || { echo "Run scripts/deploy-cloudshell.sh $PROJECT first (it makes $STATE)"; exit 1; }
# shellcheck disable=SC1090
source "$STATE"
W="npx --no-install wrangler"

say "Packages"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build -w @pansari/shared

cd edge/worker
say "Cloudflare account"
$W whoami | tail -n 5
if [ -z "${KV_ID:-}" ]; then
  say "Creating the KV namespace (replay guard)"
  OUT=$($W kv namespace create EPHEMERAL 2>&1 || true); echo "$OUT"
  KV_ID=$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$KV_ID" ]; then
    KV_ID=$($W kv namespace list | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s.slice(s.indexOf("[")));const k=a.find(x=>/EPHEMERAL/.test(x.title));process.stdout.write(k?k.id:"")})')
  fi
  [ -n "$KV_ID" ] || { echo "Could not read the KV namespace id"; exit 1; }
  echo "KV_ID=$KV_ID" >> "$STATE"
fi

NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
say "Worker config (wrangler.live.toml, project number $NUM)"
node - "$PROJECT" "$NUM" "$KV_ID" "$REGION" <<'NODE'
const fs = require('fs');
const [project, num, kv, region] = process.argv.slice(2);
let t = fs.readFileSync('wrangler.toml', 'utf8');
const set = (k, v) => { t = t.replace(new RegExp(`^${k} = .*$`, 'm'), `${k} = "${v}"`); };
set('FIREBASE_PROJECT_ID', project);
set('FIREBASE_PROJECT_NUMBER', num);
set('PUBLIC_WEB_BASE_URL', `https://${project}.web.app`);
set('FUNCTIONS_BASE_URL', `https://${region}-${project}.cloudfunctions.net`);
set('FIRESTORE_REST_BASE', 'https://firestore.googleapis.com/v1');
set('ALLOWED_ORIGINS', `https://${project}.web.app,https://${project}.firebaseapp.com`);
set('AUTH_EMULATOR', 'false');
set('id', kv); set('preview_id', kv);
fs.writeFileSync('wrangler.live.toml', t);
NODE

say "Deploying the worker"
OUT=$($W deploy -c wrangler.live.toml 2>&1) || { echo "$OUT"; echo; echo "Deploy failed - if Cloudflare asks for a workers.dev name, run: cd edge/worker && npx wrangler deploy -c wrangler.live.toml"; exit 1; }
echo "$OUT"
URL=$(printf '%s' "$OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "Could not read the workers.dev URL"; exit 1; }

say "Worker secrets (same QR key + shared secret as the functions)"
TMP=$(mktemp); chmod 600 "$TMP"
node -e 'const [q,e]=process.argv.slice(1);process.stdout.write(JSON.stringify({QR_HMAC_KEYS:JSON.stringify({k1:q}),EDGE_SHARED_SECRET:e}))' "$QR_KEY" "$EDGE_SECRET" > "$TMP"
$W secret bulk "$TMP" -c wrangler.live.toml
rm -f "$TMP"
grep -v '^EDGE_URL=' "$STATE" > "$STATE.tmp"; echo "EDGE_URL=$URL" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; chmod 600 "$STATE"
cd "$ROOT"

say "Health check"
curl -sS "$URL/health"; echo

say "Website with the worker URL"
ENVF=apps/web/.env.production
[ -f "$ENVF" ] || { echo "$ENVF missing - run scripts/deploy-cloudshell.sh $PROJECT"; exit 1; }
grep -v '^NEXT_PUBLIC_EDGE_URL=' "$ENVF" > "$ENVF.tmp"; echo "NEXT_PUBLIC_EDGE_URL=$URL" >> "$ENVF.tmp"; mv "$ENVF.tmp" "$ENVF"
[ -f apps/mobile/.env ] && { grep -v '^EXPO_PUBLIC_EDGE_URL=' apps/mobile/.env > apps/mobile/.env.tmp; echo "EXPO_PUBLIC_EDGE_URL=$URL" >> apps/mobile/.env.tmp; mv apps/mobile/.env.tmp apps/mobile/.env; }
NEXT_TELEMETRY_DISABLED=1 npm run build -w @pansari/web
npx --no-install firebase deploy --only hosting --project "$PROJECT" --force --non-interactive

say "Done"
echo "Edge worker : $URL"
echo "Website     : https://$PROJECT.web.app (now uses the worker for walk-in QR)"
