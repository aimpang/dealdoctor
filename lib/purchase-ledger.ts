import {
  PurchaseKind,
  PurchasePlan,
  PurchaseSource,
  PurchaseStatus,
  type Prisma,
} from '@prisma/client'
import { prisma } from '@/lib/db'

// Invariants:
// 1. Customer = identity.
// 2. Purchase = payment truth.
// 3. Report.purchaseId = why this report is accessible.

export interface PurchaseLedgerRecord {
  id: string
  customerId: string
  source: 'webhook' | 'backfill_migration'
  plan: 'single' | 'five_pack' | 'unlimited'
  purchaseKind: 'one_time' | 'subscription'
  status: 'active' | 'cancelled' | 'expired' | 'refunded'
  providerOrderId: string | null
  providerSubscriptionId: string | null
  initialCredits: number | null
  remainingCredits: number | null
  unlimitedUntil: Date | null
  purchasedAt: Date
  cancelledAt: Date | null
  expiredAt: Date | null
  refundedAt: Date | null
}

export interface CreatePurchaseFromOrderCreatedInput {
  customerId: string
  linkedReportId: string
  plan: 'single' | 'five_pack'
  providerEventId: string
  providerOrderId: string
  purchasedAt?: Date
  source?: 'webhook' | 'backfill_migration'
}

export interface CreateOrRefreshSubscriptionPurchaseInput {
  customerId: string
  eventName: 'subscription_created' | 'subscription_payment_success'
  providerEventId: string
  providerOrderId?: string | null
  providerSubscriptionId: string
  status: 'active' | 'cancelled'
  unlimitedUntil: Date
  purchasedAt?: Date
  source?: 'webhook' | 'backfill_migration'
}

export interface ActiveEntitlementResolution {
  customerId: string
  purchaseId: string
  plan: 'five_pack' | 'unlimited'
  remainingCredits: number | null
  status: 'active' | 'cancelled'
  unlimitedUntil: Date | null
}

export interface DebitFivePackPurchaseForReportInput {
  customerId: string
  reportId: string
}

export interface DebitFivePackPurchaseForReportResult {
  debited: boolean
  purchaseId: string | null
  remainingCredits: number | null
}

export interface RefundPurchaseByProviderOrderIdInput {
  eventCreatedAt?: Date | null
  orderTotalCents?: number | null
  providerEventId: string
  providerOrderId: string
  refundedAmountCents?: number | null
}

export interface FullRefundAppliedResult {
  outcome: 'full-refund-applied'
  purchaseId: string
  revokedReportIds: string[]
}

export interface PartialRefundManualReviewResult {
  outcome: 'partial-refund-manual-review'
  purchaseId: string
}

export interface PurchaseNotFoundResult {
  outcome: 'purchase-not-found'
}

export interface CancelSubscriptionPurchaseInput {
  cancelledAt?: Date | null
  providerEventId: string
  providerOrderId?: string | null
  providerSubscriptionId: string
}

export interface ExpireSubscriptionPurchaseInput {
  eventCreatedAt?: Date | null
  providerEventId: string
  providerOrderId?: string | null
  providerSubscriptionId: string
}

export type RefundPurchaseByProviderOrderIdResult =
  | FullRefundAppliedResult
  | PartialRefundManualReviewResult
  | PurchaseNotFoundResult

interface PurchaseEventUpsertInput {
  eventCreatedAt?: Date | null
  eventName: string
  orderTotalCents?: number | null
  payloadJson?: string | null
  providerEventId: string
  providerOrderId?: string | null
  purchaseId: string
  refundedAmountCents?: number | null
}

const SINGLE_PURCHASE_INITIAL_CREDITS = 1
const SINGLE_PURCHASE_REMAINING_CREDITS = 0
const FIVE_PACK_INITIAL_CREDITS = 5
const FIVE_PACK_INITIAL_REMAINING_CREDITS = 4
const ZERO_REMAINING_CREDITS = 0

const toPurchaseLedgerRecord = (
  purchase: {
    cancelledAt: Date | null
    customerId: string
    expiredAt: Date | null
    id: string
    initialCredits: number | null
    plan: PurchasePlan
    providerOrderId: string | null
    providerSubscriptionId: string | null
    purchasedAt: Date
    purchaseKind: PurchaseKind
    refundedAt: Date | null
    remainingCredits: number | null
    source: PurchaseSource
    status: PurchaseStatus
    unlimitedUntil: Date | null
  }
): PurchaseLedgerRecord => {
  const source =
    purchase.source === PurchaseSource.backfill_migration ? 'backfill_migration' : 'webhook'
  const plan =
    purchase.plan === PurchasePlan.five_pack ? 'five_pack' : purchase.plan === PurchasePlan.unlimited ? 'unlimited' : 'single'
  const purchaseKind =
    purchase.purchaseKind === PurchaseKind.subscription ? 'subscription' : 'one_time'
  const status =
    purchase.status === PurchaseStatus.cancelled
      ? 'cancelled'
      : purchase.status === PurchaseStatus.expired
        ? 'expired'
        : purchase.status === PurchaseStatus.refunded
          ? 'refunded'
          : 'active'

  return {
    id: purchase.id,
    customerId: purchase.customerId,
    source,
    plan,
    purchaseKind,
    status,
    providerOrderId: purchase.providerOrderId,
    providerSubscriptionId: purchase.providerSubscriptionId,
    initialCredits: purchase.initialCredits,
    remainingCredits: purchase.remainingCredits,
    unlimitedUntil: purchase.unlimitedUntil,
    purchasedAt: purchase.purchasedAt,
    cancelledAt: purchase.cancelledAt,
    expiredAt: purchase.expiredAt,
    refundedAt: purchase.refundedAt,
  }
}

const upsertPurchaseEvent = async (
  input: PurchaseEventUpsertInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
) => {
  return databaseClient.purchaseEvent.upsert({
    where: { providerEventId: input.providerEventId },
    update: {
      eventName: input.eventName,
      providerOrderId: input.providerOrderId ?? undefined,
      refundedAmountCents: input.refundedAmountCents ?? undefined,
      orderTotalCents: input.orderTotalCents ?? undefined,
      payloadJson: input.payloadJson ?? undefined,
      eventCreatedAt: input.eventCreatedAt ?? undefined,
      purchaseId: input.purchaseId,
    },
    create: {
      providerEventId: input.providerEventId,
      eventName: input.eventName,
      providerOrderId: input.providerOrderId ?? null,
      refundedAmountCents: input.refundedAmountCents ?? null,
      orderTotalCents: input.orderTotalCents ?? null,
      payloadJson: input.payloadJson ?? null,
      eventCreatedAt: input.eventCreatedAt ?? null,
      purchaseId: input.purchaseId,
    },
  })
}

export const createPurchaseFromOrderCreated = (
  input: CreatePurchaseFromOrderCreatedInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<PurchaseLedgerRecord> => {
  return (async () => {
    const purchasedAt = input.purchasedAt ?? new Date()
    const source =
      input.source === 'backfill_migration'
        ? PurchaseSource.backfill_migration
        : PurchaseSource.webhook
    const plan = input.plan === 'five_pack' ? PurchasePlan.five_pack : PurchasePlan.single
    const initialCredits =
      plan === PurchasePlan.five_pack ? FIVE_PACK_INITIAL_CREDITS : SINGLE_PURCHASE_INITIAL_CREDITS
    const remainingCredits =
      plan === PurchasePlan.five_pack
        ? FIVE_PACK_INITIAL_REMAINING_CREDITS
        : SINGLE_PURCHASE_REMAINING_CREDITS

    const purchase = await databaseClient.purchase.upsert({
      where: { providerOrderId: input.providerOrderId },
      update: {
        customerId: input.customerId,
        source,
        plan,
        purchaseKind: PurchaseKind.one_time,
        status: PurchaseStatus.active,
        initialCredits,
        remainingCredits,
      },
      create: {
        customerId: input.customerId,
        source,
        plan,
        purchaseKind: PurchaseKind.one_time,
        status: PurchaseStatus.active,
        providerOrderId: input.providerOrderId,
        initialCredits,
        remainingCredits,
        purchasedAt,
      },
    })

    await databaseClient.report.update({
      where: { id: input.linkedReportId },
      data: { purchaseId: purchase.id },
    })

    await upsertPurchaseEvent(
      {
        purchaseId: purchase.id,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId,
        eventName: 'order_created',
        eventCreatedAt: purchasedAt,
      },
      databaseClient
    )

    return toPurchaseLedgerRecord(purchase)
  })()
}

export const createOrRefreshSubscriptionPurchase = (
  input: CreateOrRefreshSubscriptionPurchaseInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<PurchaseLedgerRecord> => {
  return (async () => {
    const purchasedAt = input.purchasedAt ?? new Date()
    const source =
      input.source === 'backfill_migration'
        ? PurchaseSource.backfill_migration
        : PurchaseSource.webhook
    const status =
      input.status === 'cancelled' ? PurchaseStatus.cancelled : PurchaseStatus.active

    await databaseClient.purchase.upsert({
      where: { providerSubscriptionId: input.providerSubscriptionId },
      update: {
        customerId: input.customerId,
        source,
        providerOrderId: input.providerOrderId ?? undefined,
        plan: PurchasePlan.unlimited,
        purchaseKind: PurchaseKind.subscription,
        status,
        cancelledAt: input.status === 'cancelled' ? purchasedAt : null,
      },
      create: {
        customerId: input.customerId,
        source,
        providerOrderId: input.providerOrderId ?? null,
        providerSubscriptionId: input.providerSubscriptionId,
        plan: PurchasePlan.unlimited,
        purchaseKind: PurchaseKind.subscription,
        status,
        unlimitedUntil: input.unlimitedUntil,
        purchasedAt,
        cancelledAt: input.status === 'cancelled' ? purchasedAt : null,
      },
    })

    await databaseClient.purchase.updateMany({
      where: {
        providerSubscriptionId: input.providerSubscriptionId,
        OR: [{ unlimitedUntil: null }, { unlimitedUntil: { lt: input.unlimitedUntil } }],
      },
      data: {
        unlimitedUntil: input.unlimitedUntil,
      },
    })

    const purchase = await databaseClient.purchase.findUniqueOrThrow({
      where: { providerSubscriptionId: input.providerSubscriptionId },
    })

    await upsertPurchaseEvent(
      {
        purchaseId: purchase.id,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId ?? null,
        eventName: input.eventName,
        eventCreatedAt: purchasedAt,
      },
      databaseClient
    )

    return toPurchaseLedgerRecord(purchase)
  })()
}

export const getActiveEntitlementForCustomer = (
  customerId: string,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ActiveEntitlementResolution | null> => {
  return (async () => {
    const activeUnlimitedPurchase = await databaseClient.purchase.findFirst({
      where: {
        customerId,
        plan: PurchasePlan.unlimited,
        status: { in: [PurchaseStatus.active, PurchaseStatus.cancelled] },
        unlimitedUntil: { gt: new Date() },
      },
      orderBy: { unlimitedUntil: 'desc' },
    })

    if (activeUnlimitedPurchase) {
      return {
        customerId,
        purchaseId: activeUnlimitedPurchase.id,
        plan: 'unlimited',
        remainingCredits: activeUnlimitedPurchase.remainingCredits,
        status:
          activeUnlimitedPurchase.status === PurchaseStatus.cancelled ? 'cancelled' : 'active',
        unlimitedUntil: activeUnlimitedPurchase.unlimitedUntil,
      }
    }

    const activeFivePackPurchase = await databaseClient.purchase.findFirst({
      where: {
        customerId,
        plan: PurchasePlan.five_pack,
        status: PurchaseStatus.active,
        remainingCredits: { gt: 0 },
      },
      orderBy: { purchasedAt: 'asc' },
    })

    if (!activeFivePackPurchase) {
      return null
    }

    return {
      customerId,
      purchaseId: activeFivePackPurchase.id,
      plan: 'five_pack',
      remainingCredits: activeFivePackPurchase.remainingCredits,
      status: 'active',
      unlimitedUntil: activeFivePackPurchase.unlimitedUntil,
    }
  })()
}

export const debitFivePackPurchaseForReport = (
  input: DebitFivePackPurchaseForReportInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<DebitFivePackPurchaseForReportResult> => {
  return (async () => {
    const candidatePurchases = await databaseClient.purchase.findMany({
      where: {
        customerId: input.customerId,
        plan: PurchasePlan.five_pack,
        status: PurchaseStatus.active,
        remainingCredits: { gt: 0 },
      },
      orderBy: { purchasedAt: 'asc' },
      select: { id: true },
    })

    for (const candidatePurchase of candidatePurchases) {
      const updatedPurchaseCount = await databaseClient.purchase.updateMany({
        where: {
          id: candidatePurchase.id,
          status: PurchaseStatus.active,
          remainingCredits: { gt: 0 },
        },
        data: {
          remainingCredits: { decrement: 1 },
        },
      })

      if (updatedPurchaseCount.count === 0) {
        continue
      }

      await databaseClient.report.update({
        where: { id: input.reportId },
        data: { purchaseId: candidatePurchase.id },
      })

      const updatedPurchase = await databaseClient.purchase.findUniqueOrThrow({
        where: { id: candidatePurchase.id },
        select: { remainingCredits: true },
      })

      return {
        debited: true,
        purchaseId: candidatePurchase.id,
        remainingCredits: updatedPurchase.remainingCredits,
      }
    }

    return {
      debited: false,
      purchaseId: null,
      remainingCredits: null,
    }
  })()
}

export const refundPurchaseByProviderOrderId = (
  input: RefundPurchaseByProviderOrderIdInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<RefundPurchaseByProviderOrderIdResult> => {
  return (async () => {
    const purchase = await databaseClient.purchase.findUnique({
      where: { providerOrderId: input.providerOrderId },
      include: {
        reports: {
          select: { id: true },
        },
      },
    })

    if (!purchase) {
      return { outcome: 'purchase-not-found' }
    }

    const isFullRefund =
      typeof input.refundedAmountCents === 'number' &&
      typeof input.orderTotalCents === 'number' &&
      input.refundedAmountCents > 0 &&
      input.refundedAmountCents === input.orderTotalCents

    if (!isFullRefund) {
      await upsertPurchaseEvent(
        {
          purchaseId: purchase.id,
          providerEventId: input.providerEventId,
          providerOrderId: input.providerOrderId,
          eventName: 'order_refunded_partial',
          eventCreatedAt: input.eventCreatedAt,
          refundedAmountCents: input.refundedAmountCents ?? null,
          orderTotalCents: input.orderTotalCents ?? null,
        },
        databaseClient
      )

      return {
        outcome: 'partial-refund-manual-review',
        purchaseId: purchase.id,
      }
    }

    const refundedPurchase = await databaseClient.purchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.refunded,
        refundedAt: input.eventCreatedAt ?? new Date(),
        remainingCredits: ZERO_REMAINING_CREDITS,
        unlimitedUntil: null,
      },
      include: {
        reports: {
          select: { id: true },
        },
      },
    })

    await upsertPurchaseEvent(
      {
        purchaseId: refundedPurchase.id,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId,
        eventName: 'order_refunded',
        eventCreatedAt: input.eventCreatedAt,
        refundedAmountCents: input.refundedAmountCents ?? null,
        orderTotalCents: input.orderTotalCents ?? null,
      },
      databaseClient
    )

    return {
      outcome: 'full-refund-applied',
      purchaseId: refundedPurchase.id,
      revokedReportIds: refundedPurchase.reports.map((report) => report.id),
    }
  })()
}

export const cancelSubscriptionPurchase = (
  input: CancelSubscriptionPurchaseInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<PurchaseLedgerRecord | null> => {
  return (async () => {
    const existingPurchase = await databaseClient.purchase.findUnique({
      where: { providerSubscriptionId: input.providerSubscriptionId },
    })

    if (!existingPurchase) {
      return null
    }

    const cancelledPurchase = await databaseClient.purchase.update({
      where: { id: existingPurchase.id },
      data: {
        status: PurchaseStatus.cancelled,
        cancelledAt: input.cancelledAt ?? new Date(),
      },
    })

    await upsertPurchaseEvent(
      {
        purchaseId: cancelledPurchase.id,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId ?? null,
        eventName: 'subscription_cancelled',
        eventCreatedAt: input.cancelledAt ?? null,
      },
      databaseClient
    )

    return toPurchaseLedgerRecord(cancelledPurchase)
  })()
}

export const expireSubscriptionPurchase = (
  input: ExpireSubscriptionPurchaseInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<PurchaseLedgerRecord | null> => {
  return (async () => {
    const existingPurchase = await databaseClient.purchase.findUnique({
      where: { providerSubscriptionId: input.providerSubscriptionId },
    })

    if (!existingPurchase) {
      return null
    }

    const expiredPurchase = await databaseClient.purchase.update({
      where: { id: existingPurchase.id },
      data: {
        status: PurchaseStatus.expired,
        expiredAt: input.eventCreatedAt ?? new Date(),
        unlimitedUntil: null,
      },
    })

    await upsertPurchaseEvent(
      {
        purchaseId: expiredPurchase.id,
        providerEventId: input.providerEventId,
        providerOrderId: input.providerOrderId ?? null,
        eventName: 'subscription_expired',
        eventCreatedAt: input.eventCreatedAt ?? null,
      },
      databaseClient
    )

    return toPurchaseLedgerRecord(expiredPurchase)
  })()
}
