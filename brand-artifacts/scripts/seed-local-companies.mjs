import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
let n = 0;
for (let page = 1; page <= 8; page++) {
  const res = await fetch(`https://meza-ashy.vercel.app/api/v1/companies?pageSize=50&page=${page}`);
  const json = await res.json();
  const rows = json.companies ?? [];
  if (!rows.length) break;
  for (const c of rows) {
    await db.company.upsert({
      where: { ticker: c.ticker },
      create: { id: c.id, ticker: c.ticker, isin: c.isin ?? null, nameEn: c.nameEn, nameAr: c.nameAr ?? null, sector: c.sector, industry: c.industry ?? null, listingStatus: c.listingStatus ?? "LISTED", isActive: true, isDemoData: false },
      update: { nameEn: c.nameEn, nameAr: c.nameAr ?? null, sector: c.sector, industry: c.industry ?? null },
    });
    n++;
  }
  if (page >= (json.totalPages ?? 1)) break;
}
console.log("seeded/updated companies:", n);
await db.$disconnect();
