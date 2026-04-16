import { NextRequest, NextResponse } from 'next/server'
import { generateAccessToken } from '@/lib/entitlements'
import { sendEmail, buildMagicLinkEmail } from '@/lib/email-service'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/clientIp'
import { logger } from '@/lib/logger'
import { BASE_URL } from '@/lib/seo'
import {
  CLAIM_TOKEN_TTL_MINUTES,
  CLAIM_TOKEN_TTL_MS,
  createClaimToken,
} from '@/lib/claim-token'

// Retrieve-my-access flow. User enters email; if we know them, rotate their
// access token and email the magic link. We don't leak whether the email is
// in our system (always return 200) — standard anti-enumeration.

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (await rateLimit(ip, 5, { bucket: 'magic-link', failOpen: false })) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { email } = await req.json().catch(() => ({ email: null }))
  if (typeof email !== 'string' || !email.includes('@') || email.length > 200) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const customer = await prisma.customer.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      accessToken: true,
      reportsRemaining: true,
      unlimitedUntil: true,
    },
  })

  if (customer) {
    const baseUrl = BASE_URL
    const rotatedAccessToken = generateAccessToken()
    const claimToken = createClaimToken({
      accessToken: rotatedAccessToken,
      customerId: customer.id,
      expiresInMs: CLAIM_TOKEN_TTL_MS,
    })
    const magicLinkUrl = `${baseUrl}/api/auth/claim?token=${claimToken}`

    // Build a friendly description of what they'll restore
    let entitlement = 'Your previous purchase.'
    if (customer.unlimitedUntil && customer.unlimitedUntil > new Date()) {
      entitlement = `Pro Unlimited — active until ${customer.unlimitedUntil.toLocaleDateString()}.`
    } else if (customer.reportsRemaining > 0) {
      entitlement = `${customer.reportsRemaining} report${customer.reportsRemaining === 1 ? '' : 's'} remaining on your 5-pack.`
    } else {
      entitlement = 'Your past reports are accessible from your portfolio.'
    }

    // Try to include a link to their most recent report as a bonus
    const mostRecent = await prisma.report.findFirst({
      where: { customerId: customer.id, paid: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const originalReportUrl = mostRecent ? `${baseUrl}/report/${mostRecent.id}` : undefined

    const { html, text } = buildMagicLinkEmail({
      magicLinkUrl,
      linkExpiryLabel: `${CLAIM_TOKEN_TTL_MINUTES} minutes`,
      entitlementDescription: entitlement,
      originalReportUrl,
    })
    const result = await sendEmail({
      to: customer.email,
      subject: 'Restore your DealDoctor access',
      html,
      text,
    })
    if (result.sent) {
      await prisma.customer
        .update({
          where: { id: customer.id },
          data: { accessToken: rotatedAccessToken },
        })
        .catch((error) => {
          logger.error('magic_link.access_token_rotation_failed', {
            customerId: customer.id,
            error,
          })
        })
    } else {
      logger.error('magic_link.email_failed', {
        customerId: customer.id,
        error: result.error,
      })
    }
  }

  // Always return 200 so email enumeration doesn't work
  return NextResponse.json({
    ok: true,
    message: 'If that email is in our system, we just sent you a link.',
  })
}
