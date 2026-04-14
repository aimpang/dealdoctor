import { NextRequest, NextResponse } from 'next/server'
import { rotateAccessTokenByEmail } from '@/lib/entitlements'
import { sendEmail, buildMagicLinkEmail } from '@/lib/email'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { getClientIp } from '@/lib/clientIp'
import { BASE_URL } from '@/lib/seo'

// Retrieve-my-access flow. User enters email; if we know them, rotate their
// access token and email the magic link. We don't leak whether the email is
// in our system (always return 200) — standard anti-enumeration.

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (await rateLimit(ip, 3, { bucket: 'magic-link' })) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { email } = await req.json().catch(() => ({ email: null }))
  if (typeof email !== 'string' || !email.includes('@') || email.length > 200) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  // Rotate token so any previously-stolen cookie stops working as soon as the
  // legitimate owner requests a new link.
  const customer = await rotateAccessTokenByEmail(email.toLowerCase().trim())

  if (customer) {
    const baseUrl = BASE_URL
    const magicLinkUrl = `${baseUrl}/api/auth/claim?token=${customer.accessToken}`

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
      entitlementDescription: entitlement,
      originalReportUrl,
    })
    await sendEmail({
      to: customer.email,
      subject: 'Restore your DealDoctor access',
      html,
      text,
    })
  }

  // Always return 200 so email enumeration doesn't work
  return NextResponse.json({
    ok: true,
    message: 'If that email is in our system, we just sent you a link.',
  })
}
