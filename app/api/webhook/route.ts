import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'
import { creditPurchase, revokeEntitlement } from '@/lib/entitlements'
import { sendEmail, buildPurchaseReceiptEmail } from '@/lib/email-service'
import { BASE_URL } from '@/lib/seo'
import { logger } from '@/lib/logger'
import {
  RECEIPT_CLAIM_TOKEN_TTL_DAYS,
  RECEIPT_CLAIM_TOKEN_TTL_MS,
  createClaimToken,
} from '@/lib/claim-token'

// LemonSqueezy webhook handler.
// Events we handle:
//   order_created                 — single / 5-pack one-time purchase OR initial subscription signup
//   subscription_created          — customer started a new subscription
//   subscription_payment_success  — renewal, extend unlimitedUntil
//   subscription_cancelled        — customer cancelled; access persists until expiry
//   subscription_expired          — subscription lapsed; revoke unlimited access
//   order_refunded                — full refund; revoke all entitlements
// Unknown events are acknowledged with 200 so LS doesn't retry forever.

export async function POST(req: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()

  // HMAC-SHA256 signature verification
  const signature = Buffer.from(req.headers.get('X-Signature') ?? '', 'hex')
  const hmac = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    'hex'
  )
  if (signature.length !== hmac.length || !crypto.timingSafeEqual(hmac, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const payload = JSON.parse(rawBody)
  const eventName = payload.meta?.event_name as string | undefined
  const customData = payload.meta?.custom_data ?? {}
  const email = payload.data?.attributes?.user_email as string | undefined

  // Idempotency guard. LemonSqueezy retries webhook delivery on non-2xx —
  // without this, a replayed `order_created` re-runs generateFullReport and
  // re-credits entitlements. We insert the event ID into WebhookEvent first;
  // the unique constraint rejects replays. Use LS's own event_id when
  // available, falling back to a stable hash of the meta so we're always
  // idempotent even if LS stops sending event_id.
  const providerEventId =
    (payload.meta?.event_id as string | undefined) ||
    (payload.meta?.webhook_id as string | undefined) ||
    // Last resort: synthesize an ID from (event, order-id-or-subscription-id, user_email)
    `${eventName}|${payload.data?.id ?? ''}|${email ?? ''}`

  try {
    await prisma.webhookEvent.create({
      data: {
        providerEventId,
        eventName: eventName ?? 'unknown',
      },
    })
  } catch (err: any) {
    // P2002 = unique constraint violation = we've already processed this
    // event. Return 200 so LemonSqueezy doesn't keep retrying.
    if (err?.code === 'P2002') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    // Other DB errors bubble up — we want to retry those.
    logger.error('webhook.dedup_insert_failed', { error: err })
    return NextResponse.json({ error: 'Dedup insert failed' }, { status: 500 })
  }

  try {
    switch (eventName) {
      case 'order_created':
        await handleOrderCreated(payload, customData, email)
        break
      case 'subscription_created':
        await handleSubscriptionEvent(payload, customData, email, 'active')
        break
      case 'subscription_payment_success':
        await handleSubscriptionEvent(payload, customData, email, 'active')
        break
      case 'subscription_cancelled':
        // Access persists until the current period ends; just flag the status.
        if (email) {
          await prisma.customer.updateMany({
            where: { email },
            data: { subscriptionStatus: 'cancelled' },
          })
        }
        break
      case 'subscription_expired':
        if (email) {
          const c = await prisma.customer.findUnique({ where: { email } })
          if (c) await revokeEntitlement(c.id)
        }
        break
      case 'order_refunded':
        if (email) {
          const c = await prisma.customer.findUnique({ where: { email } })
          if (c) await revokeEntitlement(c.id)
        }
        break
      default:
        // Acknowledge unhandled events so LS doesn't retry
        console.log('[webhook] unhandled event:', eventName)
    }
  } catch (err: any) {
    logger.error('webhook.processing_error', { error: err })
    await prisma.webhookEvent
      .deleteMany({ where: { providerEventId } })
      .catch((cleanupError) =>
        logger.error('webhook.dedup_release_failed', { providerEventId, error: cleanupError })
      )
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleOrderCreated(payload: any, customData: any, email: string | undefined) {
  const uuid = customData?.uuid as string | undefined
  const plan = (customData?.plan as 'single' | '5pack' | 'unlimited') || 'single'
  const paymentOrderId = String(payload.data?.id ?? '')

  if (!email) {
    // Can't associate without email — just mark the one report as paid
    if (uuid) {
      await updateReportPaid(uuid, paymentOrderId, null, email)
      queueFullReportGeneration(uuid)
    }
    return
  }

  const customer = await prisma.$transaction(async (transactionClient) => {
    const nextCustomer = await creditPurchase(
      {
        email,
        plan,
        lsCustomerId: String(payload.data?.attributes?.customer_id ?? ''),
      },
      transactionClient
    )

    if (uuid) {
      await updateReportPaid(uuid, paymentOrderId, nextCustomer.id, email, transactionClient)
    }

    return nextCustomer
  })

  if (uuid) {
    queueFullReportGeneration(uuid)
  }

  // Purchase receipt email with report link + magic link
  try {
    const baseUrl = BASE_URL
    const claimToken = createClaimToken({
      accessToken: customer.accessToken,
      customerId: customer.id,
      expiresInMs: RECEIPT_CLAIM_TOKEN_TTL_MS,
    })
    const report = uuid ? await prisma.report.findUnique({ where: { id: uuid } }) : null
    const { html, text } = buildPurchaseReceiptEmail({
      plan,
      claimLinkExpiryLabel: `${RECEIPT_CLAIM_TOKEN_TTL_DAYS} days`,
      reportUrl: uuid ? `${baseUrl}/report/${uuid}` : baseUrl,
      magicLinkUrl: `${baseUrl}/api/auth/claim?token=${claimToken}`,
      address: report?.address || 'your property',
      recoveryCode: (customer as any).recoveryCode,
    })
    await sendEmail({ to: email, subject: 'Your DealDoctor report is ready', html, text })
  } catch (err) {
    // Email failures are non-blocking — the entitlement is still credited.
    logger.error('webhook.receipt_email_failed', { error: err })
  }
}

async function handleSubscriptionEvent(
  payload: any,
  customData: any,
  email: string | undefined,
  status: string
) {
  if (!email) return
  const renewsAtStr = payload.data?.attributes?.renews_at as string | undefined
  const renewsAt = renewsAtStr ? new Date(renewsAtStr) : undefined
  const subscriptionId = String(payload.data?.id ?? '')
  const uuid = customData?.uuid as string | undefined

  await prisma.$transaction(async (transactionClient) => {
    const nextCustomer = await creditPurchase(
      {
        email,
        plan: 'unlimited',
        lsCustomerId: String(payload.data?.attributes?.customer_id ?? ''),
        lsSubscriptionId: subscriptionId,
        subscriptionStatus: status,
        renewsAt,
      },
      transactionClient
    )

    if (uuid) {
      await updateReportPaid(uuid, payload.data?.id, nextCustomer.id, email, transactionClient)
    }

    return nextCustomer
  })

  if (uuid) {
    queueFullReportGeneration(uuid)
  }
}

async function updateReportPaid(
  uuid: string,
  paymentOrderId: any,
  customerId: string | null,
  email: string | undefined,
  databaseClient: Prisma.TransactionClient | typeof prisma = prisma
) {
  await databaseClient.report.update({
    where: { id: uuid },
    data: {
      paid: true,
      paymentOrderId: String(paymentOrderId || ''),
      customerEmail: email || null,
      paidAt: new Date(),
      customerId: customerId || undefined,
    },
  })
  // Fire and forget — don't block webhook response on report generation
}

function queueFullReportGeneration(uuid: string) {
  generateFullReport(uuid).catch((err) =>
    logger.error('webhook.report_generation_failed', { uuid, error: err })
  )
}
