#!/usr/bin/env bash
# Update AI env on the EGXANO Vercel project (lightning-first chain + AI Gateway fallback).
set -euo pipefail
TOKEN="$(cat /home/z/my-project/scripts/.vtoken)"
PID="prj_cY9krexWUlK0dAB2M0aXq3u2VXEG"
TEAM="team_rjjCm6Zg6Vndzbq4H3PQKIoM"
API="https://api.vercel.com/v10/projects/$PID/env"

upsert() { # key value
  local code
  code=$(curl -sS -o /tmp/envresp.json -w "%{http_code}" -X POST \
    "$API?upsert=true&teamId=$TEAM" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"key\":\"$1\",\"value\":\"$2\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}")
  echo "$1 -> HTTP $code $(head -c 120 /tmp/envresp.json)"
}

upsert AI_MODELS "nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/nemotron-3.5-bolt-e4b"
upsert AI_MODEL "nvidia/nemotron-3.5-lightning-30b-a3b"
upsert AI_MODEL_FALLBACK "nvidia/nemotron-3.5-bolt-e4b"
upsert AI_REPORT_MAX_WORDS "500"
upsert AI_PROVIDERS "pollinations,vercel-gateway"
upsert AI_PROVIDER_VERCEL_GATEWAY_BASE_URL "https://ai-gateway.vercel.sh/v1"
upsert AI_PROVIDER_VERCEL_GATEWAY_API_KEY "$(cat /home/z/my-project/scripts/.gateway_key)"
upsert AI_PROVIDER_VERCEL_GATEWAY_MODELS "google/gemini-3-flash,openai/gpt-4.1-mini-fast"
echo "---- verify keys ----"
curl -sS "$API?teamId=$TEAM" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
envs = json.load(sys.stdin).get('envs', [])
for e in sorted(envs, key=lambda x: x['key']):
    if 'AI' in e['key'] or 'GATEWAY' in e['key']:
        print(e['key'], '|', ','.join(e.get('target', [])))
"
