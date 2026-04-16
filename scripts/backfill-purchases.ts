import {
  PurchaseKind,
  PurchasePlan,
  PurchaseSource,
  PurchaseStatus,
} from '@prisma/client'
import { PrismaClient } from '@prisma/client'

interface BackfillSummary {
  linkedReports: number
  createdReportPurchases: number
  createdFivePackPurchases: number
  createdUnlimitedPurchases: number
  skippedPaidReportsWithoutCustomer: number
}

const COMMIT_FLAG = '--commit'
const DRY_RUN_FLAG = '--dry-run'
const FIVE_PACK_BACKFILL_SUFFIX = '_5pack'
const UNLIMITED_BACKFILL_SUFFIX = '_unlimited'
const BACKFILL_PREFIX = 'backfill_'
const SINGLE_PURCHASE_INITIAL_CREDITS = 1
const SINGLE_PURCHASE_REMAINING_CREDITS = 0

const databaseClient = new PrismaClient()

const createBackfillOrderId = (customerId: string, suffix: string) =>
  `${BACKFILL_PREFIX}${customerId}${suffix}`

const isCommitMode = process.argv.includes(COMMIT_FLAG)

if (!isCommitMode && !process.argv.includes(DRY_RUN_FLAG)) {
  console.log('Running in dry-run mode. Pass --commit to write changes.')
}

const summary: BackfillSummary = {
  linkedReports: 0,
  createdReportPurchases: 0,
  createdFivePackPurchases: 0,
  createdUnlimitedPurchases: 0,
  skippedPaidReportsWithoutCustomer: 0,
}

const main = async () => {
  const paidReports = await databaseClient.report.findMany({
    where: {
      paid: true,
      paymentOrderId: { not: null },
      purchaseId: null,
    },
    select: {
      id: true,
      customerId: true,
      paymentOrderId: true,
      paidAt: true,
      createdAt: true,
    },
  })

  const legacyFivePackCustomers = await databaseClient.customer.findMany({
    where: {
      reportsRemaining: { gt: 0 },
    },
    select: {
      id: true,
      reportsRemaining: true,
      createdAt: true,
    },
  })

  const legacyUnlimitedCustomers = await databaseClient.customer.findMany({
    where: {
      unlimitedUntil: { not: null },
    },
    select: {
      id: true,
      unlimitedUntil: true,
      createdAt: true,
    },
  })

  for (const paidReport of paidReports) {
    if (!paidReport.customerId || !paidReport.paymentOrderId) {
      summary.skippedPaidReportsWithoutCustomer += 1
      continue
    }

    const existingPurchase = await databaseClient.purchase.findUnique({
      where: { providerOrderId: paidReport.paymentOrderId },
      select: { id: true },
    })

    if (existingPurchase) {
      summary.linkedReports += 1
      if (isCommitMode) {
        await databaseClient.report.update({
          where: { id: paidReport.id },
          data: { purchaseId: existingPurchase.id },
        })
      }
      continue
    }

    summary.createdReportPurchases += 1
    if (isCommitMode) {
      const createdPurchase = await databaseClient.purchase.create({
        data: {
          customerId: paidReport.customerId,
          source: PurchaseSource.backfill_migration,
          plan: PurchasePlan.single,
          purchaseKind: PurchaseKind.one_time,
          status: PurchaseStatus.active,
          providerOrderId: paidReport.paymentOrderId,
          initialCredits: SINGLE_PURCHASE_INITIAL_CREDITS,
          remainingCredits: SINGLE_PURCHASE_REMAINING_CREDITS,
          purchasedAt: paidReport.paidAt ?? paidReport.createdAt,
        },
        select: { id: true },
      })

      await databaseClient.report.update({
        where: { id: paidReport.id },
        data: { purchaseId: createdPurchase.id },
      })
    }
  }

  for (const legacyFivePackCustomer of legacyFivePackCustomers) {
    const syntheticOrderId = createBackfillOrderId(
      legacyFivePackCustomer.id,
      FIVE_PACK_BACKFILL_SUFFIX
    )
    const existingPurchase = await databaseClient.purchase.findUnique({
      where: { providerOrderId: syntheticOrderId },
      select: { id: true },
    })

    if (existingPurchase) {
      continue
    }

    summary.createdFivePackPurchases += 1
    if (isCommitMode) {
      await databaseClient.purchase.create({
        data: {
          customerId: legacyFivePackCustomer.id,
          source: PurchaseSource.backfill_migration,
          plan: PurchasePlan.five_pack,
          purchaseKind: PurchaseKind.one_time,
          status: PurchaseStatus.active,
          providerOrderId: syntheticOrderId,
          initialCredits: legacyFivePackCustomer.reportsRemaining,
          remainingCredits: legacyFivePackCustomer.reportsRemaining,
          purchasedAt: legacyFivePackCustomer.createdAt,
        },
      })
    }
  }

  for (const legacyUnlimitedCustomer of legacyUnlimitedCustomers) {
    if (!legacyUnlimitedCustomer.unlimitedUntil) {
      continue
    }

    const syntheticSubscriptionId = createBackfillOrderId(
      legacyUnlimitedCustomer.id,
      UNLIMITED_BACKFILL_SUFFIX
    )
    const existingPurchase = await databaseClient.purchase.findUnique({
      where: { providerSubscriptionId: syntheticSubscriptionId },
      select: { id: true },
    })

    if (existingPurchase) {
      continue
    }

    summary.createdUnlimitedPurchases += 1
    if (isCommitMode) {
      await databaseClient.purchase.create({
        data: {
          customerId: legacyUnlimitedCustomer.id,
          source: PurchaseSource.backfill_migration,
          plan: PurchasePlan.unlimited,
          purchaseKind: PurchaseKind.subscription,
          status: PurchaseStatus.active,
          providerSubscriptionId: syntheticSubscriptionId,
          unlimitedUntil: legacyUnlimitedCustomer.unlimitedUntil,
          purchasedAt: legacyUnlimitedCustomer.createdAt,
        },
      })
    }
  }

  console.table(summary)

  if (!isCommitMode) {
    console.log('Dry run only. Re-run with --commit to write changes.')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await databaseClient.$disconnect()
  })
