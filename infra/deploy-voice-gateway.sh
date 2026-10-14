#!/usr/bin/env bash
# Deploys the Voice Gateway (Twilio Media Streams <-> Gemini Live) and points telephony at it.
# Run deploy-telephony.sh first. Safe to re-run.
# Usage: PROJECT_ID=my-project RECORDINGS_BUCKET=my-bucket ./infra/deploy-voice-gateway.sh
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
: "${RECORDINGS_BUCKET:?Set RECORDINGS_BUCKET to the Cloud Storage bucket for call recordings}"
# The Gemini Live model is served from us-central1; the gateway runs next to it.
REGION="${GATEWAY_REGION:-us-central1}"
TASKS_REGION="${REGION_TELEPHONY:-asia-northeast1}"
SERVICE=hachi-voice-gateway
TELEPHONY=hachi-telephony
REPO=hachi
QUEUE=emergency-calls
RUNTIME_SA="hachi-voice@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="hachi-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null
source infra/lib.sh
# Where the case and dashboard links in emergency and no-response notifications point.
APP_BASE_URL="${APP_BASE_URL:-$(web_origin)}"

echo "==> Enabling APIs"
gcloud services enable aiplatform.googleapis.com storage.googleapis.com

echo "==> Checking prerequisites"
TELEPHONY_URL="$(gcloud run services describe "$TELEPHONY" --region "$TASKS_REGION" --format 'value(status.url)' 2>/dev/null || true)"
[[ -n "$TELEPHONY_URL" ]] || { echo "Deploy ${TELEPHONY} first (infra/deploy-telephony.sh)." >&2; exit 1; }
# Must equal the telephony PUBLIC_BASE_URL: it is the OIDC audience of the emergency tasks.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
TELEPHONY_URL="https://${TELEPHONY}-${PROJECT_NUMBER}.${TASKS_REGION}.run.app"
gcloud storage buckets describe "gs://${RECORDINGS_BUCKET}" >/dev/null \
  || { echo "Bucket gs://${RECORDINGS_BUCKET} not found." >&2; exit 1; }

echo "==> Service account"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create hachi-voice --display-name "Hachi voice gateway (Cloud Run runtime)"
for role in roles/datastore.user roles/cloudtasks.enqueuer roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role "$role" --condition=None >/dev/null
done
# Recordings: write-only, limited to this bucket.
gcloud storage buckets add-iam-policy-binding "gs://${RECORDINGS_BUCKET}" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectCreator >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountUser >/dev/null

echo "==> Emergency queue"
# Separate from outbound-calls so an emergency never waits behind the daily dial rate limit.
QUEUE_FLAGS=(--location "$TASKS_REGION" --max-dispatches-per-second 20 --max-concurrent-dispatches 20
  --max-attempts 20 --min-backoff 1s --max-backoff 10s --max-doublings 3)
if gcloud tasks queues describe "$QUEUE" --location "$TASKS_REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$QUEUE" "${QUEUE_FLAGS[@]}" >/dev/null
else
  gcloud tasks queues create "$QUEUE" "${QUEUE_FLAGS[@]}"
fi

echo "==> Building image"
IMAGE="${TASKS_REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/voice-gateway:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --config cloudbuild.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --substitutions "_SERVICE=voice-gateway,_IMAGE=${IMAGE}" .

echo "==> Deploying Cloud Run"
# --set-env-vars replaces every variable, so keep the links to the other services once they exist.
NOTIFY_ENV=""
if gcloud run services describe hachi-notifier --region "$TASKS_REGION" >/dev/null 2>&1; then
  NOTIFY_ENV=",NOTIFIER_BASE_URL=https://hachi-notifier-${PROJECT_NUMBER}.${TASKS_REGION}.run.app,NOTIFY_QUEUE=notifications"
fi
ANALYZE_ENV=""
if gcloud run services describe hachi-analyzer --region "$TASKS_REGION" >/dev/null 2>&1; then
  ANALYZE_ENV=",ANALYZER_BASE_URL=https://hachi-analyzer-${PROJECT_NUMBER}.${TASKS_REGION}.run.app,ANALYSIS_QUEUE=call-analysis"
fi
# The forced-drop test hook (docs/VERIFY_LIVE_AND_LEDGER.md) has to come through here, because
# --set-env-vars replaces the whole environment: a hook set by hand would be erased by the next
# deploy, and — more usefully — a hook set here is erased by the next deploy that does not ask for
# it. There is no state to remember to clean up.
# Both services read the breaker and have to agree on its cooldown: telephony honours it before
# dialing, the gateway tests against it. Passed through only when set, so the shared default lives
# in one place (parseGatewayPolicy) instead of being copied into two shell scripts that can drift.
BREAKER_ENV=""
[[ -n "${GATEWAY_COOLDOWN_SEC:-}" ]] && BREAKER_ENV=",GATEWAY_COOLDOWN_SEC=${GATEWAY_COOLDOWN_SEC}"
[[ -n "${GATEWAY_TRANSIENT_FAILURES:-}" ]] && BREAKER_ENV="${BREAKER_ENV},GATEWAY_TRANSIENT_FAILURES=${GATEWAY_TRANSIENT_FAILURES}"
DROP_ENV=""
if [[ -n "${FORCE_LIVE_DROP:-}" ]]; then
  DROP_ENV=",FORCE_LIVE_DROP=${FORCE_LIVE_DROP}"
  echo "!!  FORCE_LIVE_DROP=${FORCE_LIVE_DROP}"
  echo "!!  The next call to that resident will have its Gemini Live socket closed on purpose."
  echo "!!  No other resident is affected. Re-run this script without the variable to clear it."
fi
# Opt-in turn detection and the issue #15 no-response schedule. Colon separators do not
# collide with gcloud's comma-separated environment list. Unset VAD fields retain model defaults.
TURN_ENV=""
for name in LIVE_SILENCE_MS LIVE_END_OF_SPEECH_SENSITIVITY SILENCE_PROMPT_INTERVALS_SEC SILENCE_PROMPT_SEC SILENCE_PROMPTS; do
  value="${!name:-}"
  if [[ -n "$value" ]]; then TURN_ENV+=",${name}=${value}"; fi
done
# Twilio cannot send Google credentials, so ingress is public; each stream must present the
# per-call token stored in Firestore. CPU stays allocated because audio flows over an open
# WebSocket between requests; the timeout bounds a single call.
# The Gemini region and model are set explicitly rather than left to the code's defaults, so that
# which model is being called in which region is answerable from `gcloud run services describe`.
# They are not the same for every service: the analyzer calls flash on "global".
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --allow-unauthenticated --min-instances 1 --max-instances 10 --cpu 1 --memory 1Gi \
  --concurrency 20 --timeout 3600 --no-cpu-throttling --cpu-boost \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GEMINI_LOCATION=${GEMINI_LOCATION:-$REGION},GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.8-live},RECORDINGS_BUCKET=${RECORDINGS_BUCKET},TELEPHONY_BASE_URL=${TELEPHONY_URL},TASKS_LOCATION=${TASKS_REGION},EMERGENCY_QUEUE=${QUEUE},TASKS_INVOKER_SA=${INVOKER_SA},APP_BASE_URL=${APP_BASE_URL}${NOTIFY_ENV}${ANALYZE_ENV}${BREAKER_ENV}${DROP_ENV}${TURN_ENV}"

GATEWAY_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
echo "==> Health check"
curl -fsS "${GATEWAY_URL}/health" && echo

echo "==> Pointing telephony at the gateway"
gcloud run services update "$TELEPHONY" --region "$TASKS_REGION" \
  --update-env-vars "VOICE_STREAM_URL=wss://${GATEWAY_URL#https://}/twilio/stream" >/dev/null
echo "Deployed: ${GATEWAY_URL}"
