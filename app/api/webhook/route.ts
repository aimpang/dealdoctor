import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db'
import { generateFullReport } from '@/lib/reportGenerator'

export async function POST(req: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()

  // Verify HMAC-SHA256 signature
  const signature = Buffer.from(
    req.headers.get('X-Signature') ?? '',
    'hex'
  )
  const hmac = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    'hex'
  )

  if (signature.length !== hmac.length || !crypto.timingSafeEqual(hmac, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const payload = JSON.parse(rawBody)
  const eventName = payload.meta?.event_name

  if (eventName === 'order_created') {
    const customData = payload.meta?.custom_data
    const uuid = customData?.uuid
    const email = payload.data?.attributes?.user_email

    if (uuid) {
      // Mark as paid
      await prisma.report.update({
        where: { id: uuid },
        data: {
          paid: true,
          paymentOrderId: String(payload.data?.id || ''),
          customerEmail: email || null,
          paidAt: new Date()
        }
      })

      // Generate full report async
      generateFullReport(uuid).catch(err =>
        console.error('Report generation failed for', uuid, err)
      )
    }
  }

  return NextResponse.json({ received: true })
}
