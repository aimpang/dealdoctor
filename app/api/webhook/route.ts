import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'
import { generateAccessToken, generateRecoveryCode } from '@/lib/entitlements'
import { sendEmail, buildPurchaseReceiptEmail } from '@/lib/email-service'
import { BASE_URL } from '@/lib/seo'
import { logger } from '@/lib/logger'
import {
  RECEIPT_CLAIM_TOKEN_TTL_DAYS,
  RECEIPT_CLAIM_TOKEN_TTL_MS,
  createClaimToken,
} from '@/lib/claim-token'
import {
  cancelSubscriptionPurchase,
  createOrRefreshSubscriptionPurchase,
  createPurchaseFromOrderCreated,
  expireSubscriptionPurchase,
  refundPurchaseByProviderOrderId,
} from '@/lib/purchase-ledger'

interface LemonSqueezyWebhookPayload {
  data?: {
    attributes?: Record<string, unknown>
    id?: string | number
  }
  meta?: {
    custom_data?: Record<string, unknown>
    event_id?: string
    event_name?: string
    webhook_id?: string
  }
}

interface CustomerIdentityRecord {
  accessToken: string
  email: string
  id: string
  lemonSqueezyCustomerId: string | null
  lemonSqueezySubscriptionId: string | null
  recoveryCode: string | null
}

interface UpdateReportPaidInput {
  customerEmail?: string
  customerId?: string | null
  paidAt?: Date
  paymentOrderId?: string | null
  purchaseId?: string | null
  uuid: string
}

const UNKNOWN_REFUND_RETRY_WINDOW_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = Buffer.from(req.headers.get('X-Signature') ?? '', 'hex')
  const expectedSignature = Buffer.from(
    crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex'),
    'hex'
  )

  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, signature)
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const payload = JSON.parse(rawBody) as LemonSqueezyWebhookPayload
  const eventName = payload.meta?.event_name
  const customData = payload.meta?.custom_data ?? {}
  const customerEmail = toOptionalString(payload.data?.attributes?.user_email)
  const providerEventId =
    payload.meta?.event_id ??
    payload.meta?.webhook_id ??
    `${eventName ?? 'unknown'}|${payload.data?.id ?? ''}|${customerEmail ?? ''}`

  try {
    await prisma.webhookEvent.create({
      data: {
        providerEventId,
        eventName: eventName ?? 'unknown',
      },
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ received: true, duplicate: true })
    }

    logger.error('webhook.dedup_insert_failed', { error })
    return NextResponse.json({ error: 'Dedup insert failed' }, { status: 500 })
  }

  try {
    switch (eventName) {
      case 'order_created':
        await handleOrderCreated(payload, customData, customerEmail, providerEventId)
        break
      case 'subscription_created':
      case 'subscription_payment_success':
        await handleSubscriptionActivated(
          payload,
          customData,
          customerEmail,
          providerEventId,
          eventName
        )
        break
      case 'subscription_cancelled':
        await handleSubscriptionCancelled(payload, customerEmail, providerEventId)
        break
      case 'subscription_expired':
        await handleSubscriptionExpired(payload, customerEmail, providerEventId)
        break
      case 'order_refunded':
        await handleOrderRefunded(payload, providerEventId)
        break
      default:
        logger.info('webhook.unhandled_event', { eventName, providerEventId })
    }
  } catch (error: any) {
    logger.error('webhook.processing_error', { error, eventName, providerEventId })
    await prisma.webhookEvent
      .deleteMany({ where: { providerEventId } })
      .catch((cleanupError) =>
        logger.error('webhook.dedup_release_failed', { providerEventId, error: cleanupError })
      )
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

const handleOrderCreated = async (
  payload: LemonSqueezyWebhookPayload,
  customData: Record<string, unknown>,
  customerEmail: string | null,
  providerEventId: string
) => {
  const uuid = toOptionalString(customData.uuid)
  const plan = normalizeCheckoutPlan(customData.plan)
  const providerOrderId = toRequiredId(payload.data?.id)
  const lemonSqueezyCustomerId = toOptionalString(payload.data?.attributes?.customer_id)
  const paidAt = extractEventCreatedAt(payload) ?? new Date()

  if (!customerEmail) {
    if (uuid) {
      await updateReportPaid({
        uuid,
        paymentOrderId: providerOrderId,
        paidAt,
      })
      queueFullReportGeneration(uuid)
    }
    return
  }

  const customer = await prisma.$transaction(async (databaseClient) => {
    const nextCustomer = await upsertCustomerIdentity(
      {
        email: customerEmail,
        lemonSqueezyCustomerId,
      },
      databaseClient
    )

    let purchaseId: string | null = null
    if (uuid && plan !== 'unlimited') {
      const purchase = await createPurchaseFromOrderCreated(
        {
          customerId: nextCustomer.id,
          linkedReportId: uuid,
          plan,
          providerEventId,
          providerOrderId,
          purchasedAt: paidAt,
        },
        databaseClient
      )
      purchaseId = purchase.id
    }

    if (uuid) {
      await updateReportPaid(
        {
          uuid,
          customerId: nextCustomer.id,
          customerEmail,
          paymentOrderId: providerOrderId,
          purchaseId,
          paidAt,
        },
        databaseClient
      )
    }

    return nextCustomer
  })

  if (uuid) {
    queueFullReportGeneration(uuid)
  }

  await sendReceiptEmail({
    customer,
    email: customerEmail,
    plan: plan === 'five_pack' ? '5pack' : plan,
    uuid,
  })
}

const handleSubscriptionActivated = async (
  payload: LemonSqueezyWebhookPayload,
  customData: Record<string, unknown>,
  customerEmail: string | null,
  providerEventId: string,
  eventName: 'subscription_created' | 'subscription_payment_success'
) => {
  if (!customerEmail) {
    return
  }

  const uuid = toOptionalString(customData.uuid)
  const providerOrderId =
    toOptionalString(payload.data?.attributes?.order_id) ?? toOptionalString(payload.data?.id)
  const providerSubscriptionId =
    toOptionalString(payload.data?.attributes?.subscription_id) ??
    toOptionalString(payload.data?.id)
  const lemonSqueezyCustomerId = toOptionalString(payload.data?.attributes?.customer_id)
  const unlimitedUntil = extractRenewalDate(payload)

  if (!providerSubscriptionId || !unlimitedUntil) {
    logger.warn('webhook.subscription_missing_identity', {
      providerEventId,
      providerOrderId,
      providerSubscriptionId,
    })
    return
  }

  await prisma.$transaction(async (databaseClient) => {
    const customer = await upsertCustomerIdentity(
      {
        email: customerEmail,
        lemonSqueezyCustomerId,
        lemonSqueezySubscriptionId: providerSubscriptionId,
      },
      databaseClient
    )

    const purchase = await createOrRefreshSubscriptionPurchase(
      {
        customerId: customer.id,
        eventName,
        providerEventId,
        providerOrderId,
        providerSubscriptionId,
        status: 'active',
        unlimitedUntil,
        purchasedAt: extractEventCreatedAt(payload) ?? new Date(),
      },
      databaseClient
    )

    if (uuid) {
      await updateReportPaid(
        {
          uuid,
          customerId: customer.id,
          customerEmail,
          paymentOrderId: providerOrderId ?? providerSubscriptionId,
          purchaseId: purchase.id,
          paidAt: extractEventCreatedAt(payload) ?? new Date(),
        },
        databaseClient
      )
    }
  })

  if (uuid) {
    queueFullReportGeneration(uuid)
  }
}

const handleSubscriptionCancelled = async (
  payload: LemonSqueezyWebhookPayload,
  customerEmail: string | null,
  providerEventId: string
) => {
  const providerSubscriptionId =
    toOptionalString(payload.data?.attributes?.subscription_id) ??
    toOptionalString(payload.data?.id)

  if (!providerSubscriptionId) {
    logger.warn('webhook.subscription_cancelled_missing_subscription', { providerEventId })
    return
  }

  await prisma.$transaction(async (databaseClient) => {
    await cancelSubscriptionPurchase(
      {
        providerEventId,
        providerOrderId: toOptionalString(payload.data?.attributes?.order_id),
        providerSubscriptionId,
        cancelledAt: extractEventCreatedAt(payload),
      },
      databaseClient
    )

    if (customerEmail) {
      await databaseClient.customer.updateMany({
        where: { email: customerEmail },
        data: { subscriptionStatus: 'cancelled' },
      })
    }
  })
}

const handleSubscriptionExpired = async (
  payload: LemonSqueezyWebhookPayload,
  customerEmail: string | null,
  providerEventId: string
) => {
  const providerSubscriptionId =
    toOptionalString(payload.data?.attributes?.subscription_id) ??
    toOptionalString(payload.data?.id)

  if (!providerSubscriptionId) {
    logger.warn('webhook.subscription_expired_missing_subscription', { providerEventId })
    return
  }

  await prisma.$transaction(async (databaseClient) => {
    await expireSubscriptionPurchase(
      {
        providerEventId,
        providerOrderId: toOptionalString(payload.data?.attributes?.order_id),
        providerSubscriptionId,
        eventCreatedAt: extractEventCreatedAt(payload),
      },
      databaseClient
    )

    if (customerEmail) {
      await databaseClient.customer.updateMany({
        where: { email: customerEmail },
        data: {
          unlimitedUntil: null,
          subscriptionStatus: 'expired',
        },
      })
    }
  })
}

const handleOrderRefunded = async (
  payload: LemonSqueezyWebhookPayload,
  providerEventId: string
) => {
  const providerOrderId = toRequiredId(payload.data?.id)
  const refundEventCreatedAt = extractRefundEventCreatedAt(payload)
  const refundedAmountCents = normalizeMoneyToCents(payload.data?.attributes?.refunded_amount)
  const orderTotalCents = normalizeMoneyToCents(payload.data?.attributes?.total)

  const refundResult = await prisma.$transaction((databaseClient) =>
    refundPurchaseByProviderOrderId(
      {
        providerEventId,
        providerOrderId,
        refundedAmountCents,
        orderTotalCents,
        eventCreatedAt: refundEventCreatedAt,
      },
      databaseClient
    )
  )

  if (refundResult.outcome === 'purchase-not-found') {
    const isRecentUnknownRefund =
      refundEventCreatedAt === null ||
      Date.now() - refundEventCreatedAt.getTime() <= UNKNOWN_REFUND_RETRY_WINDOW_MS

    if (refundEventCreatedAt === null) {
      logger.warn('webhook.refund_order_missing_timestamp', {
        providerEventId,
        providerOrderId,
      })
    }

    if (isRecentUnknownRefund) {
      throw new Error(`retryable-refund-race:${providerOrderId}`)
    }

    logger.warn('webhook.refund_order_missing_stale', {
      providerEventId,
      providerOrderId,
      refundEventCreatedAt,
    })
    return
  }

  if (refundResult.outcome === 'partial-refund-manual-review') {
    logger.warn('webhook.partial_refund_manual_review', {
      providerEventId,
      providerOrderId,
      refundedAmountCents,
      orderTotalCents,
      purchaseId: refundResult.purchaseId,
    })
  }
}

const upsertCustomerIdentity = async (
  input: {
    email: string
    lemonSqueezyCustomerId?: string | null
    lemonSqueezySubscriptionId?: string | null
  },
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
): Promise<CustomerIdentityRecord> => {
  return databaseClient.customer.upsert({
    where: { email: input.email },
    update: {
      lemonSqueezyCustomerId: input.lemonSqueezyCustomerId ?? undefined,
      lemonSqueezySubscriptionId: input.lemonSqueezySubscriptionId ?? undefined,
    },
    create: {
      email: input.email,
      accessToken: generateAccessToken(),
      recoveryCode: generateRecoveryCode(),
      lemonSqueezyCustomerId: input.lemonSqueezyCustomerId ?? null,
      lemonSqueezySubscriptionId: input.lemonSqueezySubscriptionId ?? null,
    },
    select: {
      id: true,
      email: true,
      accessToken: true,
      recoveryCode: true,
      lemonSqueezyCustomerId: true,
      lemonSqueezySubscriptionId: true,
    },
  })
}

const updateReportPaid = async (
  input: UpdateReportPaidInput,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
) => {
  await databaseClient.report.update({
    where: { id: input.uuid },
    data: {
      paid: true,
      paymentOrderId: input.paymentOrderId ?? undefined,
      customerEmail: input.customerEmail ?? null,
      paidAt: input.paidAt ?? new Date(),
      customerId: input.customerId ?? undefined,
      purchaseId: input.purchaseId ?? undefined,
    },
  })
}

const sendReceiptEmail = async (input: {
  customer: CustomerIdentityRecord
  email: string
  plan: 'single' | '5pack' | 'unlimited'
  uuid: string | null
}) => {
  try {
    const claimToken = createClaimToken({
      accessToken: input.customer.accessToken,
      customerId: input.customer.id,
      expiresInMs: RECEIPT_CLAIM_TOKEN_TTL_MS,
    })
    const report = input.uuid ? await prisma.report.findUnique({ where: { id: input.uuid } }) : null
    const receiptEmail = buildPurchaseReceiptEmail({
      plan: input.plan,
      claimLinkExpiryLabel: `${RECEIPT_CLAIM_TOKEN_TTL_DAYS} days`,
      reportUrl: input.uuid ? `${BASE_URL}/report/${input.uuid}` : BASE_URL,
      magicLinkUrl: `${BASE_URL}/api/auth/claim?token=${claimToken}`,
      address: report?.address ?? 'your property',
      recoveryCode: input.customer.recoveryCode,
    })

    await sendEmail({
      to: input.email,
      subject: 'Your DealDoctor report is ready',
      html: receiptEmail.html,
      text: receiptEmail.text,
    })
  } catch (error) {
    logger.error('webhook.receipt_email_failed', { error, email: input.email })
  }
}

const queueFullReportGeneration = (uuid: string) => {
  generateFullReport(uuid).catch((error) =>
    logger.error('webhook.report_generation_failed', { uuid, error })
  )
}

const normalizeCheckoutPlan = (planCandidate: unknown): 'single' | 'five_pack' | 'unlimited' => {
  if (planCandidate === '5pack' || planCandidate === 'five_pack') {
    return 'five_pack'
  }
  if (planCandidate === 'unlimited') {
    return 'unlimited'
  }
  return 'single'
}

const toOptionalString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value.trim() || null
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

const toRequiredId = (value: unknown): string => {
  const id = toOptionalString(value)
  if (!id) {
    throw new Error('webhook-missing-provider-id')
  }
  return id
}

const normalizeMoneyToCents = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) ? Math.round(parsedValue) : null
  }

  return null
}

const parseDateCandidate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

const extractEventCreatedAt = (payload: LemonSqueezyWebhookPayload): Date | null => {
  return (
    parseDateCandidate(payload.data?.attributes?.created_at) ??
    parseDateCandidate(payload.data?.attributes?.updated_at) ??
    parseDateCandidate(payload.data?.attributes?.paid_at)
  )
}

const extractRefundEventCreatedAt = (payload: LemonSqueezyWebhookPayload): Date | null => {
  return parseDateCandidate(payload.data?.attributes?.refunded_at) ?? extractEventCreatedAt(payload)
}

const extractRenewalDate = (payload: LemonSqueezyWebhookPayload): Date | null => {
  return (
    parseDateCandidate(payload.data?.attributes?.renews_at) ??
    parseDateCandidate(payload.data?.attributes?.ends_at) ??
    parseDateCandidate(payload.data?.attributes?.billing_anchor)
  )
}
