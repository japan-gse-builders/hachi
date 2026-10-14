#!/usr/bin/env bash
# Creates (or updates) everything the outbound call pipeline needs and deploys it.
# Safe to re-run. Usage: PROJECT_ID=my-project TWILIO_VOICE_FROM=+1... ./infra/deploy-telephony.sh
# (TWILIO_VOICE_FROM can be omitted on re-deploys; the running service's value is kept)
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
REGION="${REGION:-asia-northeast1}"
SERVICE=hachi-telephony
REPO=hachi
QUEUE=outbound-calls
JOB=hachi-dispatch
RUNTIME_SA="hachi-telephony@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="hachi-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"
SECRETS=(twilio-account-sid twilio-auth-token twilio-api-key-sid twilio-api-key-secret)

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null
source infra/lib.sh
VOICE_FROM="$(twilio_number TWILIO_VOICE_FROM "$SERVICE" "$REGION")"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudtasks.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  firestore.googleapis.com iamcredentials.googleapis.com

echo "==> Checking prerequisites"
for s in "${SECRETS[@]}"; do
  gcloud secrets describe "$s" >/dev/null 2>&1 || { echo "Missing Secret Manager secret: $s" >&2; exit 1; }
done
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 \
  || { echo "Create a Firestore database (Native mode, ${REGION}) first." >&2; exit 1; }

echo "==> Service accounts"
ensure_sa() {
  gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$1" --display-name "$2"
}
ensure_sa hachi-telephony "Hachi telephony (Cloud Run runtime)"
ensure_sa hachi-tasks "Hachi Cloud Tasks / Scheduler invoker"
ensure_sa hachi-build "Hachi Cloud Build"

grant_project() {
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$1" --role "$2" --condition=None >/dev/null
}
grant_project "$RUNTIME_SA" roles/datastore.user
grant_project "$RUNTIME_SA" roles/cloudtasks.enqueuer
grant_project "$BUILD_SA" roles/artifactregistry.writer
grant_project "$BUILD_SA" roles/logging.logWriter
grant_project "$BUILD_SA" roles/storage.objectViewer
# Lets the service create tasks that carry an OIDC token for the invoker account.
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountUser >/dev/null
for s in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "==> Artifact Registry"
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --location "$REGION" --repository-format docker

echo "==> Cloud Tasks queue"
# Twilio's default outbound rate is 1 call per second.
QUEUE_FLAGS=(--location "$REGION" --max-dispatches-per-second 1 --max-concurrent-dispatches 10
  --max-attempts 10 --min-backoff 10s --max-backoff 60s --max-doublings 3)
if gcloud tasks queues describe "$QUEUE" --location "$REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$QUEUE" "${QUEUE_FLAGS[@]}" >/dev/null
else
  gcloud tasks queues create "$QUEUE" "${QUEUE_FLAGS[@]}"
fi

echo "==> Building image"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/telephony:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --config cloudbuild.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --substitutions "_SERVICE=telephony,_IMAGE=${IMAGE}" .

echo "==> Deploying Cloud Run"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
# --set-env-vars replaces every variable, so keep the conversation enabled once the gateway exists.
STREAM_ENV=""
if gcloud run services describe hachi-voice-gateway --region "${GATEWAY_REGION:-us-central1}" >/dev/null 2>&1; then
  STREAM_ENV=",VOICE_STREAM_URL=wss://hachi-voice-gateway-${PROJECT_NUMBER}.${GATEWAY_REGION:-us-central1}.run.app/twilio/stream"
fi
# The gateway reads the same two, and a cooldown set on one service only means one of them is
# testing the fault against a window the other is not honouring. Set both or neither.
BREAKER_ENV=""
[[ -n "${GATEWAY_COOLDOWN_SEC:-}" ]] && BREAKER_ENV=",GATEWAY_COOLDOWN_SEC=${GATEWAY_COOLDOWN_SEC}"
[[ -n "${GATEWAY_TRANSIENT_FAILURES:-}" ]] && BREAKER_ENV="${BREAKER_ENV},GATEWAY_TRANSIENT_FAILURES=${GATEWAY_TRANSIENT_FAILURES}"
# Public ingress is required for Twilio webhooks; /tasks/* checks Google OIDC tokens and
# /twilio/* checks Twilio signatures inside the app.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --allow-unauthenticated --min-instances 1 --max-instances 10 --cpu 1 --memory 512Mi \
  --concurrency 80 --timeout 60 --cpu-boost \
  --set-env-vars "PUBLIC_BASE_URL=${URL},TWILIO_VOICE_FROM=${VOICE_FROM},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},TASKS_LOCATION=${REGION},CALL_QUEUE=${QUEUE},TASKS_INVOKER_SA=${INVOKER_SA},TASK_CALLER_EMAILS=${INVOKER_SA}${STREAM_ENV}${BREAKER_ENV}" \
  --set-secrets "TWILIO_ACCOUNT_SID=twilio-account-sid:latest,TWILIO_AUTH_TOKEN=twilio-auth-token:latest,TWILIO_API_KEY_SID=twilio-api-key-sid:latest,TWILIO_API_KEY_SECRET=twilio-api-key-secret:latest"

echo "==> Cloud Scheduler (every minute)"
JOB_FLAGS=(--location "$REGION" --schedule "* * * * *" --time-zone Etc/UTC --uri "${URL}/tasks/dispatch"
  --http-method POST --oidc-service-account-email "$INVOKER_SA" --oidc-token-audience "$URL" --attempt-deadline 60s)
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${JOB_FLAGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" "${JOB_FLAGS[@]}"
fi

echo "==> Health check"
curl -fsS "${URL}/health" && echo
echo "Deployed: ${URL}"
