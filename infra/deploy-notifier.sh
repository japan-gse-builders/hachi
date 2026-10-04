#!/usr/bin/env bash
# Deploys the notification worker (SMS / email / push / voice alerts from the outbox).
# Run deploy-telephony.sh first (it serves the Twilio delivery-status webhook). Safe to re-run.
# Usage: PROJECT_ID=my-project ./infra/deploy-notifier.sh
# Email is optional: create the secret `sendgrid-api-key` and set EMAIL_FROM to a verified sender.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
REGION="${REGION:-asia-northeast1}"
GATEWAY_REGION="${GATEWAY_REGION:-us-central1}"
SERVICE=hachi-notifier
REPO=hachi
QUEUE=notifications
JOB=hachi-notify-sweep
SMS_FROM="${TWILIO_SMS_FROM:-+19787559139}"
VOICE_FROM="${TWILIO_VOICE_FROM:-+18664289155}"
RUNTIME_SA="hachi-notifier@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="hachi-tasks@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"
SECRETS=(twilio-account-sid twilio-api-key-sid twilio-api-key-secret)

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs"
gcloud services enable fcm.googleapis.com

echo "==> Checking prerequisites"
for s in "${SECRETS[@]}"; do
  gcloud secrets describe "$s" >/dev/null 2>&1 || { echo "Missing Secret Manager secret: $s" >&2; exit 1; }
done
gcloud iam service-accounts describe "$INVOKER_SA" >/dev/null 2>&1 \
  || { echo "Run infra/deploy-telephony.sh first." >&2; exit 1; }
EMAIL_SECRET=""
EMAIL_ENV=""
if gcloud secrets describe sendgrid-api-key >/dev/null 2>&1; then
  : "${EMAIL_FROM:?sendgrid-api-key exists; set EMAIL_FROM to the verified sender address}"
  SECRETS+=(sendgrid-api-key)
  EMAIL_SECRET=",SENDGRID_API_KEY=sendgrid-api-key:latest"
  EMAIL_ENV=",EMAIL_FROM=${EMAIL_FROM}"
else
  echo "    (no sendgrid-api-key secret: email notifications will be skipped)"
fi

echo "==> Service account"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create hachi-notifier --display-name "Hachi notification worker (Cloud Run runtime)"
for role in roles/datastore.user roles/cloudtasks.enqueuer roles/firebasecloudmessaging.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role "$role" --condition=None >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountUser >/dev/null
for s in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "==> Notification queue"
QUEUE_FLAGS=(--location "$REGION" --max-dispatches-per-second 10 --max-concurrent-dispatches 20
  --max-attempts 20 --min-backoff 5s --max-backoff 60s --max-doublings 3)
if gcloud tasks queues describe "$QUEUE" --location "$REGION" >/dev/null 2>&1; then
  gcloud tasks queues update "$QUEUE" "${QUEUE_FLAGS[@]}" >/dev/null
else
  gcloud tasks queues create "$QUEUE" "${QUEUE_FLAGS[@]}"
fi

echo "==> Building image"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/notifier:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --config cloudbuild.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
  --substitutions "_SERVICE=notifier,_IMAGE=${IMAGE}" .

echo "==> Deploying Cloud Run"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
# Twilio delivery reports (SMS delivered/undelivered, alert call answered/no-answer) go to the public
# telephony service, which verifies X-Twilio-Signature with the auth token it already holds.
STATUS_CALLBACK_BASE_URL="${STATUS_CALLBACK_BASE_URL:-https://hachi-telephony-${PROJECT_NUMBER}.${REGION}.run.app}"
# Only Cloud Tasks and Cloud Scheduler call this service, so it is private (IAM invoker only);
# the app checks the OIDC token as well.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --no-allow-unauthenticated --min-instances 1 --max-instances 5 --cpu 1 --memory 512Mi \
  --concurrency 40 --timeout 60 --cpu-boost \
  --set-env-vars "PUBLIC_BASE_URL=${URL},TWILIO_SMS_FROM=${SMS_FROM},TWILIO_VOICE_FROM=${VOICE_FROM},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},TASKS_LOCATION=${REGION},NOTIFY_QUEUE=${QUEUE},TASKS_INVOKER_SA=${INVOKER_SA},TASK_CALLER_EMAILS=${INVOKER_SA},SMS_ALLOWED_PREFIXES=+81,STATUS_CALLBACK_BASE_URL=${STATUS_CALLBACK_BASE_URL}${EMAIL_ENV}" \
  --set-secrets "TWILIO_ACCOUNT_SID=twilio-account-sid:latest,TWILIO_API_KEY_SID=twilio-api-key-sid:latest,TWILIO_API_KEY_SECRET=twilio-api-key-secret:latest${EMAIL_SECRET}"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker >/dev/null

echo "==> Cloud Scheduler sweep (every minute)"
JOB_FLAGS=(--location "$REGION" --schedule "* * * * *" --time-zone Etc/UTC --uri "${URL}/tasks/sweep"
  --http-method POST --oidc-service-account-email "$INVOKER_SA" --oidc-token-audience "$URL" --attempt-deadline 60s)
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${JOB_FLAGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http "$JOB" "${JOB_FLAGS[@]}"
fi

if gcloud run services describe hachi-voice-gateway --region "$GATEWAY_REGION" >/dev/null 2>&1; then
  echo "==> Pointing the voice gateway at the notifier"
  gcloud run services update hachi-voice-gateway --region "$GATEWAY_REGION" \
    --update-env-vars "NOTIFIER_BASE_URL=${URL},NOTIFY_QUEUE=${QUEUE}" >/dev/null
fi

echo "==> Health check"
curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${URL}/health" && echo
echo "Deployed: ${URL}"
