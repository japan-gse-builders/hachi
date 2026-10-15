#!/usr/bin/env bash
# Code-only redeploy: builds fresh images and rolls them out to services that already exist,
# keeping their env vars, service accounts and IAM as they are. Targets build and roll out in
# parallel, which is safe because nothing here touches IAM (the full scripts conflict when run
# together). After changing env vars, IAM or other infra, use the full infra/deploy-<service>.sh.
# Usage: PROJECT_ID=my-project ./infra/deploy-code.sh analyzer api web
#   targets: analytics analyzer api notifier telephony voice-gateway web
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project ID}"
REPO=hachi
REPO_REGION="${REPO_REGION:-asia-northeast1}"
BUILD_SA="hachi-build@${PROJECT_ID}.iam.gserviceaccount.com"
LOGS="${LOGS:-/tmp/hachi-deploy}"

cd "$(dirname "$0")/.."

region_of() {
  case $1 in
    voice-gateway) echo "${GATEWAY_REGION:-us-central1}" ;;
    analytics | analyzer | api | notifier | telephony) echo "${REGION:-asia-northeast1}" ;;
    *) return 1 ;;
  esac
}

(($#)) || { echo "Usage: $0 <analytics|analyzer|api|notifier|telephony|voice-gateway|web>..." >&2; exit 1; }
for t in "$@"; do
  [[ $t == web ]] || region_of "$t" >/dev/null || { echo "Unknown target: $t" >&2; exit 1; }
done

deploy_service() {
  local svc=$1 region image url
  region=$(region_of "$svc")
  gcloud run services describe "hachi-$svc" --project "$PROJECT_ID" --region "$region" >/dev/null 2>&1 \
    || { echo "hachi-$svc is not deployed yet; run infra/deploy-$svc.sh first" >&2; return 1; }
  image="${REPO_REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${svc}:$(date +%Y%m%d-%H%M%S)"
  gcloud builds submit --project "$PROJECT_ID" --config cloudbuild.yaml \
    --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}" \
    --substitutions "_SERVICE=${svc},_IMAGE=${image}" .
  gcloud run services update "hachi-$svc" --project "$PROJECT_ID" --region "$region" --image "$image"
  url=$(gcloud run services describe "hachi-$svc" --project "$PROJECT_ID" --region "$region" --format 'value(status.url)')
  # Private services need an identity token; public ones answer without it.
  curl -fsS "${url}/health" >/dev/null 2>&1 \
    || curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${url}/health" >/dev/null
  echo "Deployed: ${url} (${image##*:})"
}

deploy_web() {
  (cd apps/web && npm run build)
  npx -y firebase-tools@latest deploy --only hosting --project "$PROJECT_ID" --non-interactive
}

mkdir -p "$LOGS"
pids=()
for t in "$@"; do
  if [[ $t == web ]]; then deploy_web >"$LOGS/$t.log" 2>&1 &
  else deploy_service "$t" >"$LOGS/$t.log" 2>&1 &
  fi
  pids+=($!)
  echo "started $t (log: $LOGS/$t.log)"
done

failed=0
i=0
for t in "$@"; do
  if wait "${pids[$i]}"; then
    echo "ok      $t  $(tail -n 1 "$LOGS/$t.log")"
  else
    echo "FAILED  $t  (log: $LOGS/$t.log)"
    tail -n 15 "$LOGS/$t.log"
    failed=1
  fi
  i=$((i + 1))
done
exit "$failed"
