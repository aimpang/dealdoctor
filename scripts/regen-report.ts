import { generateFullReport } from '../lib/reportGenerator'
import { prisma } from '../lib/db'

async function main() {
  const uuidPrefix = process.argv[2]
  if (!uuidPrefix) {
    console.error('usage: tsx scripts/regen-report.ts <uuid-or-prefix>')
    process.exit(1)
  }
  const row = await prisma.report.findFirst({
    where: { id: { startsWith: uuidPrefix } },
  })
  if (!row) {
    console.error('no report matched')
    process.exit(1)
  }
  console.log(`regenerating ${row.id} (${row.address})...`)
  const t0 = Date.now()
  await generateFullReport(row.id)
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
