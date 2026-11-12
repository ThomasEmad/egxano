// Run the market-enrichment chunk loop until done (same code path as
// /api/v1/cron/market-enrich, but from the sandbox against the production DB).
import { runEnrichmentChunk } from "../src/lib/market/intelligence/service";
import { PrismaClient } from "@prisma/client";

async function main() {
  let round = 0;
  for (;;) {
    round++;
    const r = await runEnrichmentChunk(60);
    console.log(`round ${round}: processed=${r.processed} remaining=${r.remaining} done=${r.done}`);
    if (r.done) break;
    if (round > 12) {
      console.log("stopping: too many rounds");
      break;
    }
  }
  const p = new PrismaClient();
  const row = await p.setting.findUnique({ where: { key: "market_enrichment_v1" }, select: { value: true } });
  console.log("enrichment:", row?.value ?? null);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
