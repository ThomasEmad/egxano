// Probe the local platform Postgres + report connectivity reasons.
import net from "node:net"
import { PrismaClient } from "@prisma/client"

const url = process.env.PGURL ?? ""
function probePort(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 4000 })
    s.on("connect", () => { s.destroy(); resolve("OPEN") })
    s.on("timeout", () => { s.destroy(); resolve("TIMEOUT") })
    s.on("error", (e) => resolve(`ERROR ${e.message}`))
  })
}

const m = /@([\d.]+):(\d+)\//.exec(url)
if (m) {
  const status = await probePort(m[1], Number(m[2]))
  console.log(`tcp ${m[1]}:${m[2]} →`, status)
}

if (status === "OPEN") {
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    console.log("companies:", await db.company.count())
  } catch (e) {
    const msg = String((e as Error).message)
    console.log("REASON:", msg.split("\n").slice(0, 6).join(" | ").slice(0, 500))
  }
  await db.$disconnect()
}
