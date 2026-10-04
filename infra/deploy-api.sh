#!/usr/bin/env bash
# Deploys the staff/family API. Browsers call it with a Firebase ID token, so Cloud Run
# itself allows unauthenticated requests and the app checks the token.
# Usage: PROJECT_ID=my-project RECORDINGS_BUCKET=my-bucket ./infra/deploy-api.sh
# Set IMAGE to redeploy an image that is already built.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
: "${RECORDINGS_BUCKET:?Set RECORDINGS_BUCKET to the Cloud Storage bucket for call recordings}"
REGION="${REGION:-asia-northeast1}"
SERVICE=hachi-api
REPO=hachi
RUNTIME_SA="hachi-api@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_ORIGINS="${WEB_ORIGINS:-http://localhost:5173,https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com}"

cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Service account"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create hachi-api --display-name "Hachi API (Cloud Run runtime)"
for role in roles/datastore.user roles/firebaseauth.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role "$role" --condition=None >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://${RECORDINGS_BUCKET}" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectViewer >/dev/null
# Signed URLs without a key file.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/iam.serviceAccountTokenCreator >/dev/null

echo "==> Building image"
if [[ -n "${IMAGE:-}" ]]; then
  echo "Using existing image ${IMAGE}"
else
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/api:$(date +%Y%m%d-%H%M%S)"
  gcloud builds submit --config cloudbuild.yaml --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
    --substitutions "_SERVICE=api,_IMAGE=${IMAGE}" .
fi

echo "==> Deploying Cloud Run"
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$RUNTIME_SA" \
  --allow-unauthenticated --min-instances 0 --max-instances 5 --cpu 1 --memory 512Mi \
  --timeout 60 \
  --set-env-vars "^@^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@RECORDINGS_BUCKET=${RECORDINGS_BUCKET}@WEB_ORIGINS=${WEB_ORIGINS}"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
echo "==> Health check"
curl -fsS "${URL}/health" && echo
echo "Deployed: ${URL}"
