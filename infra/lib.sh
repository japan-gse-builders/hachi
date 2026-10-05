# Shared helpers for the deploy scripts. Source after `gcloud config set project`.

# Prints an env var from an already deployed Cloud Run service, or nothing.
deployed_env() {
  local service=$1 region=$2 name=$3
  gcloud run services describe "$service" --region "$region" --format=json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{const e=JSON.parse(s).spec.template.spec.containers[0].env??[];process.stdout.write(e.find((x)=>x.name===process.argv[1])?.value??"")}catch{}})' "$name"
}

# Twilio numbers are not kept in the repository: take them from the environment, else keep what
# the service already runs with, else stop.
twilio_number() {
  local var=$1 service=$2 region=$3 value
  value="${!var:-$(deployed_env "$service" "$region" "$var")}"
  [[ -n "$value" ]] || { echo "Set $var to your Twilio number (E.164)" >&2; exit 1; }
  printf '%s' "$value"
}
