#!/usr/bin/env bash
# Deploys the analysis worker (post-call review with Gemini) and points the voice gateway at it.
# Run deploy-voice-gateway.sh first. Safe to re-run.
# Usage: PROJECT_ID=my-project RECORDINGS_BUCKET=my-bucket ./infra/deploy-analyzer.sh
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
: "${RECORDINGS_BUCKET:?Set RECORDINGS_BUCKET to the bucket the voice gateway records calls to}"
REGION="${REGION:-asia-northeast1}"
GATEWAY_REGION="${GATEWAY_REGION:-us-central1}"
SERVICE=hachi-analyzer
REPO=hachi
QUEUE=call-analysis
JOB=hachi-analysis-sweep
RUNTIME_SA="hachi-analyzer@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="hachi-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null
source infra/lib.sh
# Where the case and dashboard links in its notifications point.
APP_BASE_URL="${APP_BASE_URL:-$(web_origin)}"

echo "==> Enabling APIs"
gcloud services enable aiplatform.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com

echo "==> Checking prerequisites"
gcloud iam service-accounts describe "$INVOKER_SA" >/dev/null 2>&1 \
  || { echo "Run infra/deploy-telephony.sh first." >&2; exit 1; }

echo "==> Service account"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create hachi-analyzer --display-name "Hachi analysis worker (Cloud Run runtime)"
for role in roles/datastore.user roles/cloudtasks.enqueuer roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role "$role" --condition=None >/dev/null
done
# Speech timing and hesitations are measured from the call recording.
gcloud storage buckets add-iam-policy-binding "gs://${RECORDINGS_BUCKET}" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectViewer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountUser >/dev/null

echo "==> Analysis queue"
QUEUE_FLAGS=(--location "$REGION" --max-dispatches-per-second 5 --max-concurrent-dispatches 10
  --max-attempts 10 --min-backoff 10s --max-backoff 120s --max-doublings 4)
if gcloud tasks queues describe "$QUEUE" --location "$REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$QUEUE" "${QUEUE_FLAGS[@]}" >/dev/null
else
  gcloud tasks queues create "$QUEUE" "${QUEUE_FLAGS[@]}"
fi

echo "==> Building image"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/analyzer:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --config cloudbuild.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --substitutions "_SERVICE=analyzer,_IMAGE=${IMAGE}" .

echo "==> Deploying Cloud Run"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
NOTIFY_ENV=""
if gcloud run services describe hachi-notifier --region "$REGION" >/dev/null 2>&1; then
  NOTIFY_ENV=",NOTIFIER_BASE_URL=https://hachi-notifier-${PROJECT_NUMBER}.${REGION}.run.app,NOTIFY_QUEUE=notifications"
fi
# Only Cloud Tasks and Cloud Scheduler call this service, so it is private (IAM invoker only);
# the app checks the OIDC token as well. Gemini is called with the runtime service account.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --no-allow-unauthenticated --min-instances 0 --max-instances 5 --cpu 1 --memory 1Gi \
  --concurrency 8 --timeout 180 --cpu-boost \
  --set-env-vars "PUBLIC_BASE_URL=${URL},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GEMINI_LOCATION=global,GEMINI_MODEL=gemini-3.8-flash,STAFF_LOCALE=en,TASKS_LOCATION=${REGION},ANALYSIS_QUEUE=${QUEUE},TASKS_INVOKER_SA=${INVOKER_SA},TASK_CALLER_EMAILS=${INVOKER_SA},APP_BASE_URL=${APP_BASE_URL}${NOTIFY_ENV}"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker >/dev/null

echo "==> Cloud Scheduler sweep (every 10 minutes)"
JOB_FLAGS=(--location "$REGION" --schedule "*/10 * * * *" --time-zone Etc/UTC --uri "${URL}/tasks/sweep"
  --http-method POST --oidc-service-account-email "$INVOKER_SA" --oidc-token-audience "$URL" --attempt-deadline 180s)
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${JOB_FLAGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" "${JOB_FLAGS[@]}"
fi

if gcloud run services describe hachi-voice-gateway --region "$GATEWAY_REGION" >/dev/null 2>&1; then
  echo "==> Pointing the voice gateway at the analyzer"
  gcloud run services update hachi-voice-gateway --region "$GATEWAY_REGION" \
    --update-env-vars "ANALYZER_BASE_URL=${URL},ANALYSIS_QUEUE=${QUEUE}" >/dev/null
fi

echo "==> Health check"
curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${URL}/health" && echo
echo "Deployed: ${URL}"
