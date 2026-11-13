#!/usr/bin/env bash
# Query the production ledger quickly. Usage: bash scripts/prod-ledger.sh [minutes]
set -euo pipefail
export DATABASE_URL="$(python3 - <<'PY'
import re
src = open('/tmp/my-project/scripts/vercel_pg_env.sh').read()
m = re.search(r'DBURL="([^"]+)"', src)
print(m.group(1))
PY
)"
MINS="${1:-10}"
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const since = new Date(Date.now() - ${MINS}*60000);
  const usage = await p.aiProviderUsage.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { provider: true, ok: true, errorKind: true, latencyMs: true, model: true, createdAt: true } });
  for (const u of usage) console.log(u.createdAt.toISOString(), u.provider.padEnd(12), u.ok?'OK  ':'FAIL', u.errorKind||'', (u.model||'').padEnd(34), u.latencyMs||'');
  const evs = await p.aiAnalysisEvent.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { kind: true, details: true, createdAt: true } });
  for (const e of evs) console.log(e.createdAt.toISOString(), e.kind, (e.details||'').slice(0,130));
  const jobs = await p.aiAnalysisJob.findMany({ select: { reportKey: true, status: true, attempts: true, lastError: true, createdAt: true } });
  console.log('JOBS:', JSON.stringify(jobs.map(j=>({s:j.status,a:j.attempts,k:j.reportKey.slice(0,10),e:(j.lastError||'').slice(0,70),c:j.createdAt.toISOString().slice(5,16)}))));
  await p.\$disconnect();
})().catch(e=>{console.error('ERR', e.message?.slice(0,200)); process.exit(1)})"
