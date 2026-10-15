#!/usr/bin/env bash
# Optional pipeline: Firestore call snapshots -> Pub/Sub -> BigQuery native subscription.
# Run in the existing Hachi project; does not redeploy the calling/alerting services.
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"
: "${ANALYTICS_ORG_IDS:?Set comma-separated organization IDs to export}"
REGION="${REGION:-asia-northeast1}"
DATASET="${ANALYTICS_DATASET:-hachi_analytics}"
TOPIC="${ANALYTICS_TOPIC:-hachi-call-outcomes-v1}"
REAL_DATA="${ANALYTICS_INCLUDE_REAL_DATA:-false}"
[[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]+$ && "$DATASET" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo 'Invalid project or dataset ID' >&2; exit 1; }
[[ "$TOPIC" =~ ^[a-zA-Z][a-zA-Z0-9_-]{2,229}$ && "$TOPIC" != goog* ]] || { echo 'Invalid topic ID (3–230 characters, not starting goog)' >&2; exit 1; }
[[ "$REAL_DATA" == true || "$REAL_DATA" == false ]] || { echo 'ANALYTICS_INCLUDE_REAL_DATA must be true or false' >&2; exit 1; }
[[ "$ANALYTICS_ORG_IDS" != *'|'* && "$ANALYTICS_ORG_IDS" != *'*'* ]] || { echo 'List specific organization IDs' >&2; exit 1; }
SERVICE=hachi-analytics
SUB="${TOPIC}-bigquery"
DLQ="${TOPIC}-dead-letter"
RUNTIME_SA="hachi-analytics@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER_SA="hachi-analytics-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."
gcloud config set project "$PROJECT_ID" >/dev/null
gcloud iam service-accounts describe "$BUILD_SA" >/dev/null
gcloud services enable pubsub.googleapis.com bigquery.googleapis.com firestore.googleapis.com run.googleapis.com cloudscheduler.googleapis.com
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$PROJECT_ID" >/dev/null

for name in hachi-analytics hachi-analytics-scheduler; do
  gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$name" --display-name="$name"
done
# Runtime reads source calls and writes export receipts. No BigQuery or provider roles are granted here.
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user --condition=None >/dev/null

echo 'Preparing BigQuery tables and reports'
if ! bq --project_id="$PROJECT_ID" show "$PROJECT_ID:$DATASET" >/dev/null 2>&1; then
  bq --project_id="$PROJECT_ID" --location="$REGION" mk --dataset "$PROJECT_ID:$DATASET"
fi
# A wrong region must fail here rather than silently placing analytics outside the intended region.
ACTUAL_REGION="$(bq --project_id="$PROJECT_ID" show --format=json "$PROJECT_ID:$DATASET" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).location))')"
[[ "$ACTUAL_REGION" == "$REGION" ]] || { echo "Dataset is in $ACTUAL_REGION, expected $REGION" >&2; exit 1; }
sed -e "s/__PROJECT__/$PROJECT_ID/g" -e "s/__DATASET__/$DATASET/g" infra/analytics/tables.sql \
  | bq --project_id="$PROJECT_ID" --location="$REGION" query --use_legacy_sql=false >/dev/null
bq --project_id="$PROJECT_ID" add-iam-policy-binding --member="serviceAccount:$PUBSUB_SA" --role=roles/bigquery.dataEditor "$PROJECT_ID:$DATASET.call_events" >/dev/null

echo 'Preparing Pub/Sub delivery and failed-message retention'
for topic in "$TOPIC" "$DLQ"; do
  if gcloud pubsub topics describe "$topic" >/dev/null 2>&1; then
    gcloud pubsub topics update "$topic" --message-storage-policy-allowed-regions="$REGION" >/dev/null
  else
    gcloud pubsub topics create "$topic" --message-storage-policy-allowed-regions="$REGION" >/dev/null
  fi
done
gcloud pubsub topics add-iam-policy-binding "$TOPIC" --member="serviceAccount:$RUNTIME_SA" --role=roles/pubsub.publisher >/dev/null
gcloud pubsub topics add-iam-policy-binding "$DLQ" --member="serviceAccount:$PUBSUB_SA" --role=roles/pubsub.publisher >/dev/null
if ! gcloud pubsub subscriptions describe "${DLQ}-inspect" >/dev/null 2>&1; then
  gcloud pubsub subscriptions create "${DLQ}-inspect" --topic="$DLQ" --message-retention-duration=7d --expiration-period=never >/dev/null
fi
SUB_FLAGS=(--bigquery-table="$PROJECT_ID:$DATASET.call_events" --use-table-schema --write-metadata
  --dead-letter-topic="$DLQ" --max-delivery-attempts=10 --message-retention-duration=7d --expiration-period=never)
if gcloud pubsub subscriptions describe "$SUB" >/dev/null 2>&1; then
  ACTUAL_TOPIC="$(gcloud pubsub subscriptions describe "$SUB" --format='value(topic)')"
  [[ "$ACTUAL_TOPIC" == "projects/$PROJECT_ID/topics/$TOPIC" ]] || { echo 'Subscription belongs to another topic' >&2; exit 1; }
  gcloud pubsub subscriptions update "$SUB" "${SUB_FLAGS[@]}" >/dev/null
else
  gcloud pubsub subscriptions create "$SUB" --topic="$TOPIC" "${SUB_FLAGS[@]}" >/dev/null
fi
gcloud pubsub subscriptions add-iam-policy-binding "$SUB" --member="serviceAccount:$PUBSUB_SA" --role=roles/pubsub.subscriber >/dev/null

echo 'Deploying repository Firestore indexes, including the call scan index'
npx --yes firebase-tools@15 deploy --project "$PROJECT_ID" --only firestore:indexes --non-interactive

echo 'Building and deploying the private analytics worker'
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/hachi/analytics:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --config=cloudbuild.yaml --service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SA" \
  --substitutions="_SERVICE=analytics,_IMAGE=$IMAGE" .
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
gcloud run deploy "$SERVICE" --image="$IMAGE" --region="$REGION" --service-account="$RUNTIME_SA" \
  --no-allow-unauthenticated --min-instances=0 --max-instances=1 --concurrency=1 --timeout=300 --memory=512Mi --cpu=1 \
  --set-env-vars="^|^PUBLIC_BASE_URL=$URL|GOOGLE_CLOUD_PROJECT=$PROJECT_ID|ANALYTICS_TOPIC=$TOPIC|ANALYTICS_INVOKER_SA=$INVOKER_SA|ANALYTICS_ORG_IDS=$ANALYTICS_ORG_IDS|ANALYTICS_INCLUDE_REAL_DATA=$REAL_DATA"
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" --member="serviceAccount:$INVOKER_SA" --role=roles/run.invoker >/dev/null
JOB_FLAGS=(--location="$REGION" --schedule='*/5 * * * *' --time-zone=Etc/UTC --uri="$URL/tasks/export"
  --http-method=POST --oidc-service-account-email="$INVOKER_SA" --oidc-token-audience="$URL" --attempt-deadline=300s)
if gcloud scheduler jobs describe hachi-analytics-export --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http hachi-analytics-export "${JOB_FLAGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http hachi-analytics-export "${JOB_FLAGS[@]}" >/dev/null
fi
echo "Analytics ready: $PROJECT_ID:$DATASET.daily_operations (real data enabled: $REAL_DATA)"
