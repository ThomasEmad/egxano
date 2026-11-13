#!/usr/bin/env bash
# Benchmark NIM models on a production-sized (~40KB) grounded report prompt.
# Usage: NV_KEY=... bash scripts/nim-bench.sh
set -u
KEY="${NV_KEY:?}"
FILLER="$(printf 'lorem ipsum dolor sit amet consectetur adipiscing elit %.0s' {1..100})"
FILLER="${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER} ${FILLER}"
for M in nvidia/nemotron-3.5-lightning-30b-a3b nvidia/nemotron-3.5-bolt-e4b nvidia/nemotron-3-nano-omni-30b-a3b-reasoning; do
  T0=$(date +%s%3N)
  OUT=$(curl -sS -m 90 https://integrate.api.nvidia.com/v1/chat/completions \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$M\",\"messages\":[{\"role\":\"system\",\"content\":\"You are an equity analyst. Write the requested analysis in Arabic markdown.\"},{\"role\":\"user\",\"content\":\"$FILLER\\n\\nBased on the data above, write a concise investment analysis (~400 words) in Arabic with sections: ملخص، نقاط القوة، نقاط الضعف، التقييم، الموقف النهائي.\"}],\"max_tokens\":1400,\"temperature\":0.5,\"stream\":false,\"chat_template_kwargs\":{\"enable_thinking\":false}}" | head -c 4000)
  T1=$(date +%s%3N)
  WORDS=$(echo "$OUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const c=j.choices?.[0]?.message?.content||'';console.log('words='+(c.split(/\s+/).length)+' chars='+c.length)}catch(e){console.log('PARSE-FAIL: '+d.slice(0,150))}})")
  echo "$M :: $((T1-T0))ms :: $WORDS"
done
