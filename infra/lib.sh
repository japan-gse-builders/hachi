# Shared helpers for the deploy scripts. Source after `gcloud config set project`.

# Prints an env var from an already deployed Cloud Run service, or nothing.
deployed_env() {
  local service=$1 region=$2 name=$3
  gcloud run services describe "$service" --region "$region" --format=json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{const e=JSON.parse(s).spec.template.spec.containers[0].env??[];process.stdout.write(e.find((x)=>x.name===process.argv[1])?.value??"")}catch{}})' "$name"
}

# The origin staff and families open: the first Hosting site in firebase.json. The links in
# notifications and the origins the API accepts are derived from it, so they follow the web app
# wherever it is deployed instead of defaulting to the project's own site (named after the project
# ID). The second site in firebase.json only redirects here. Run from the repository root.
web_origin() {
  local site
  site="$(node -e 'process.stdout.write([].concat(require("./firebase.json").hosting)[0]?.site ?? "")')"
  [[ -n "$site" ]] || { echo "firebase.json: the first hosting entry has no \"site\"" >&2; exit 1; }
  printf 'https://%s.web.app' "$site"
}

# Every Hosting site in firebase.json, comma-separated, for the API's allowed origins. The redirecting
# sites serve no app, but a page loaded there before they began redirecting keeps running and
# calling the API until it is reloaded; refusing it shows staff "Failed to fetch" on every screen.
web_origins() {
  node -e 'process.stdout.write([].concat(require("./firebase.json").hosting).filter((h)=>h.site).flatMap((h)=>[`https://${h.site}.web.app`,`https://${h.site}.firebaseapp.com`]).join(","))'
}

# Twilio numbers are not kept in the repository: take them from the environment, else keep what
# the service already runs with, else stop.
twilio_number() {
  local var=$1 service=$2 region=$3 value
  value="${!var:-$(deployed_env "$service" "$region" "$var")}"
  [[ -n "$value" ]] || { echo "Set $var to your Twilio number (E.164)" >&2; exit 1; }
  printf '%s' "$value"
}
